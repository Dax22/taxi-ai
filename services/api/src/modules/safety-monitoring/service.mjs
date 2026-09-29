import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { canUseTripSafety } from '../../../../../packages/shared/src/safety.mjs';
import { finite, signalQualifies, nearbyZones, routeWarnings, SAFETY_COUNTDOWN_MS } from '../../../../../packages/shared/src/safety-monitoring.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


/** Consent, countdown and dispatch are separate from the legacy SOS simulator. */
export function createSafetyMonitoringService({ repository: r, getAccount, getTrip, locationForTrip, routeForTrip,
  sessionOwner, nativeSessionOwner, provider, unitOfWork, tokens, audit, clock }) {
  let running = null, stopped = false;
  const settings = () => ({ delivery: provider.available ? 'configured' : 'unavailable', emergencyService: provider.emergencyService ?? null,
    countdownSeconds: SAFETY_COUNTDOWN_MS / 1000, experimental: true, foregroundOnly: true });
  const bindingFor = c => c.nativeSessionId ? `native:${c.nativeSessionId}` : tokens.digest(c.sessionToken ?? '');
  const bindingOwner = async b => b.startsWith('native:') ? (await nativeSessionOwner(b.slice(7))) : (await sessionOwner(b));
  async function context(c, active = false) {
    const user = (await getAccount(c.userId)); check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    requireRole(user, 'customer'); const ride = (await getTrip(user,c.rideId));
    if (active) check(canUseTripSafety(ride.status), 'SAFETY_UNAVAILABLE', 'Monitoring is available during a confirmed active trip.');
    return {user,ride};
  }
  const ownContact = async (id, owner) => { const c=(await r.contact(id)); check(c?.ownerId===owner && c.active,'INVALID_CONTACTS','Choose your own saved contacts.'); return c; };
  async function warnings(rideId) {
    const route = (await routeForTrip(rideId));
    const zones=(await r.approved(clock())), matches=[...nearbyZones(zones, [route?.pickup,route?.destination,(await locationForTrip(rideId))],clock()),...routeWarnings(zones,route?.coordinates,clock())];
    return [...new Map(matches.map(z=>[z.id,z])).values()]
      .map(({id,label,lat,lng,radiusM,expiresAt})=>({id,label,lat,lng,radiusM,expiresAt}));
  }
  async function view(c) {
    const {user,ride}=(await context(c)), s=(await r.session(user.id,c.rideId));
    const enabled=Boolean(s?.enabled && (await bindingOwner(s.binding))===user.id && canUseTripSafety(ride.status));
    return {viewerId:user.id,rideId:c.rideId,serverNow:clock(),settings:settings(),canMonitor:canUseTripSafety(ride.status),
      preferences:s ? {...JSON.parse(s.preferencesJson),enabled} : {enabled:false,crash:false,distress:false,contactIds:[],emergency:false,consent:false},
      version:s?.version ?? 0,monitoring:enabled && s.expiresAt>clock(),
      alerts:(await asyncMap((await r.alerts(user.id,c.rideId)), async a=>({id:a.id,kind:a.kind,status:a.status,createdAt:a.createdAt,dueAt:a.dueAt,version:a.version,
        deliveries:(await r.jobs(a.id)).map(j=>({id:j.id,name:JSON.parse(j.recipientJson).name,status:j.status,attempts:j.attempts}))}))),
      warnings:(await warnings(c.rideId)),coverage:(await routeForTrip(c.rideId))?'Warnings cover the saved route and last shared driver position. No warning does not mean a location is safe.':'No saved road route available. Only the last shared driver position can be checked; no warning does not mean a location is safe.'};
  }
  async function command(c, action, data, key) {
    check(data!==null && typeof data==='object' && !Array.isArray(data),'INVALID_BODY','Send a JSON object.');
    check(typeof key==='string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique command key is required.');
    const {user,ride}=(await context(c,action!=='cancel' && !(action==='preferences' && data.enabled===false)));
    const fingerprint=tokens.digest(JSON.stringify([c.rideId,action,data]));
    (await unitOfWork(async ()=>{
      const saved=(await r.command(user.id,key)); if(saved){check(saved.fingerprint===fingerprint,'KEY_REUSED','This key belongs to another action.');return;}
      const now=clock(), s=(await r.session(user.id,c.rideId)), prefs=s?JSON.parse(s.preferencesJson):null;
      if(action==='preferences') {
        fields(data,['enabled','crash','distress','contactIds','emergency','consent','expectedVersion']);
        check(data.expectedVersion===(s?.version??0),'STALE_VERSION','Refresh monitoring settings before changing them.');
        check(['enabled','crash','distress','emergency','consent'].every(k=>typeof data[k]==='boolean'),'INVALID_INPUT','Choose monitoring options.');
        check(Array.isArray(data.contactIds) && data.contactIds.length<=3 && new Set(data.contactIds).size===data.contactIds.length,'INVALID_CONTACTS','Choose up to three contacts.');
        for(const id of data.contactIds) (await ownContact(id,user.id));
        check(!data.enabled || data.consent,'INVALID_INPUT','Agree to share trip details for these alerts.');
        check(!data.emergency || Boolean(provider.available && provider.emergencyService),'INVALID_INPUT','An emergency-service connection is not configured.');
        check(!data.enabled || data.contactIds.length || data.emergency,'INVALID_CONTACTS','Select at least one alert recipient.');
        const binding=bindingFor(c); check((await bindingOwner(binding))===user.id,'UNAUTHENTICATED','Sign in again.');
        (await r.saveSession(user.id,c.rideId,binding,data,now));
        // Changing consent invalidates unsent alerts, including changed recipients.
        const a=(await r.activeAlert(user.id,c.rideId)); if(a){(await r.cancelJobs(a.id));(await r.transition(a.id,'cancelled'));}
      } else if(action==='signal') {
        fields(data,['signal','position'],['signal']);
        const signal=data.signal; check(signal && typeof signal==='object','INVALID_INPUT','Provide a signal.');
        fields(signal,signal.kind==='impact'?['kind','capturedAt','peakG','speedBefore','speedAfter','windowMs']:signal.kind==='distress'?['kind','capturedAt','levelDb','durationMs']:['kind','capturedAt']);
        check(signalQualifies(signal) && now-signal.capturedAt>=-5000 && now-signal.capturedAt<=15_000,'INVALID_INPUT','This signal is stale or does not meet the experimental threshold.');
        check(s?.enabled && s.expiresAt>now && s.binding===bindingFor(c) && (await bindingOwner(s.binding))===user.id,'SAFETY_UNAVAILABLE','Enable monitoring on this device first.');
        check(signal.kind==='manual' || signal.kind==='impact'&&prefs.crash || signal.kind==='distress'&&prefs.distress,'FORBIDDEN','This sensor was not enabled.');
        check(!(await r.activeAlert(user.id,c.rideId)),'INCIDENT_OPEN','An alert for this trip is already pending.');
        check((await r.recentCount(user.id,c.rideId,now))<5,'RATE_LIMITED','Alert limit reached. Contact help directly.');
        const contacts=(await asyncMap(prefs.contactIds, async id=>(await ownContact(id,user.id))));
        let position=(await locationForTrip(c.rideId));
        if(data.position!==undefined && data.position!==null) {
          const p=data.position; fields(p,['lat','lng','accuracy','capturedAt']);
          check(finite(p.lat,-90,90)&&finite(p.lng,-180,180)&&finite(p.accuracy,1,200)&&finite(p.capturedAt,now-30_000,now+5000),'INVALID_INPUT','Use a recent accurate location.');
          position={...p,source:'reporter_device',stale:false};
        }
        const customer=(await getAccount(ride.customerId)), passenger=ride.passenger?.kind==='guest'
          ? {kind:'guest',name:ride.passenger.name} : {kind:'account',id:customer.id,name:customer.name};
        const snapshot={rideId:c.rideId,passenger,driver:{id:ride.driver.id,name:ride.driver.name,vehicle:ride.driver.vehicle},
          reporter:{id:user.id,name:user.name},pickup:ride.pickup,destination:ride.destination,location:position,recordedAt:now};
        const id=tokens.id(); (await r.addAlert({id,ownerId:user.id,rideId:c.rideId,kind:signal.kind,signal,snapshot,now,dueAt:now+SAFETY_COUNTDOWN_MS}));
        for(const contact of contacts) (await r.addJob(tokens.id(),id,contact.id,{kind:'family',name:contact.name,phone:contact.phone,version:contact.version},now+SAFETY_COUNTDOWN_MS,provider.available));
        if(prefs.emergency) (await r.addJob(tokens.id(),id,null,{kind:'emergency',name:provider.emergencyService},now+SAFETY_COUNTDOWN_MS,provider.available));
      } else if(action==='cancel') {
        fields(data,['alertId','expectedVersion']); const a=(await r.alert(data.alertId));
        check(a?.ownerId===user.id && a.rideId===c.rideId,'NOT_FOUND','Alert not found.');
        check(a.version===data.expectedVersion,'STALE_VERSION','Refresh this alert before cancelling.');
        check(['countdown','queued'].includes(a.status),'INCIDENT_CLOSED','This alert can no longer be cancelled.');
        (await r.cancelJobs(a.id)); (await r.transition(a.id,'cancelled'));
      } else check(false,'NOT_FOUND','Monitoring action not found.');
      (await audit.record(user.id,`safety.monitor.${action}`,c.rideId,now));(await r.saveCommand(user.id,key,fingerprint));
    }));
    return (await view(c));
  }
  async function heartbeat(c) {
    const {user}=(await context(c,true)), s=(await r.session(user.id,c.rideId));
    check(s?.enabled && s.binding===bindingFor(c) && (await bindingOwner(s.binding))===user.id,'SAFETY_UNAVAILABLE','Enable monitoring on this device first.');
    (await r.heartbeat(user.id,c.rideId,clock()));return {viewerId:user.id,serverNow:clock()};
  }
  async function consentValid(a) {
    const s=(await r.session(a.ownerId,a.rideId));
    if(!s?.enabled || (await bindingOwner(s.binding))!==a.ownerId)return false;
    try{return canUseTripSafety((await getTrip((await getAccount(a.ownerId)),a.rideId)).status);}catch{return false;}
  }
  async function recipientValid(job,a) {
    if(!(await consentValid(a)))return false;
    const recipient=JSON.parse(job.recipientJson);
    if(!job.contactId)return recipient.name===provider.emergencyService;
    const contact=(await r.contact(job.contactId));
    return contact?.active && contact.ownerId===a.ownerId && contact.phone===recipient.phone && contact.version===recipient.version;
  }
  async function deliver() {
    (await unitOfWork(async ()=>{
      const now=clock();
      for(const a of (await r.due(now))) {
        // Never replay old emergencies after extended downtime.
        if(now-a.dueAt>120_000 || !(await consentValid(a))){(await r.cancelJobs(a.id));(await r.transition(a.id,'expired'));}
        else (await r.transition(a.id,'queued'));
      }
    }));
    for(const job of (await r.pending(clock()))) {
      if(stopped)break;
      const a=(await r.alert(job.alertId));
      if(a.status==='countdown')continue;
      if(a.status!=='queued' || !(await recipientValid(job,a)) || clock()-a.dueAt>120_000) {(await r.jobState(job.id,'cancelled',clock(),null,job.attempts));continue;}
      if(!provider.available){(await r.jobState(job.id,'unavailable',clock(),null,job.attempts));continue;}
      if(job.attempts>=3){(await r.jobState(job.id,'failed',clock(),null,job.attempts));continue;}
      if(!(await unitOfWork(async ()=>(await r.claim(job.id,clock(),job.attempts)))))continue;
      try {
        const snapshot=JSON.parse(a.snapshotJson);
        if(snapshot.location)snapshot.location.stale=clock()-snapshot.location.capturedAt>30_000;
        const result=await provider.send({idempotencyKey:job.id,recipient:JSON.parse(job.recipientJson),alert:{id:a.id,kind:a.kind,unverified:true,...snapshot}});
        // Acceptance is not delivery or emergency dispatch.
        (await r.jobState(job.id,'accepted',clock(),result.reference,job.attempts+1));
      } catch {
        (await r.jobState(job.id,job.attempts+1>=3?'failed':'queued',clock()+10_000*(job.attempts+1),null,job.attempts+1));
      }
    }
    (await unitOfWork(async ()=>(await r.finishAlerts())));
  }
  function deliverPending(){if(stopped)return Promise.resolve();if(running)return running;running=deliver().finally(()=>{running=null;});return running;}
  async function zones(userId) {const user=(await getAccount(userId));requireRole(user,'admin');return {viewerId:user.id,zones:(await r.zones()),serverNow:clock()};}
  async function reportZone(c,data,key) {
    const {user}=(await context(c,true));fields(data,['label','lat','lng','radiusM','note']);
    const d={...data,label:label(data.label,'Location name',2,80),note:label(data.note,'Reason',5,300)};
    check(finite(d.lat,-90,90)&&finite(d.lng,-180,180)&&Number.isInteger(d.radiusM)&&finite(d.radiusM,50,2000),'INVALID_INPUT','Choose a valid point and radius from 50–2000 metres.');
    check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','Use a unique command key.');
    (await unitOfWork(async ()=>{const fingerprint=tokens.digest(JSON.stringify(['zone',c.rideId,d])),old=(await r.command(user.id,key));
      if(old){check(old.fingerprint===fingerprint,'KEY_REUSED','This key belongs to another action.');return;}
      check((await r.zoneCount(user.id,clock()))<5,'RATE_LIMITED','Up to five location reports per day.');
      const id=tokens.id();(await r.addZone(id,user.id,d,clock()));(await r.saveCommand(user.id,key,fingerprint));(await audit.record(user.id,'safety.zone.reported',id,clock()));}));
    return {viewerId:user.id,status:'pending',serverNow:clock()};
  }
  async function reviewZone(userId,id,data) {
    const user=(await getAccount(userId));requireRole(user,'admin');fields(data,['status','note','expiresAt','expectedVersion']);
    check(['approved','rejected','withdrawn'].includes(data.status),'INVALID_INPUT','Choose an approval decision.');
    const d={...data,note:label(data.note,'Review reason',5,300)};
    check(Number.isSafeInteger(d.expiresAt)&&finite(d.expiresAt,clock()+60_000,clock()+7*86400_000),'INVALID_INPUT','Set an expiry within seven days.');
    (await unitOfWork(async ()=>{const z=(await r.zone(id));check(z,'NOT_FOUND','Location report not found.');check(z.version===data.expectedVersion,'STALE_VERSION','Refresh this report.');
      (await r.reviewZone(id,user.id,d));(await audit.record(user.id,`safety.zone.${d.status}`,id,clock()));}));return (await zones(userId));
  }
  return {view,command,heartbeat,deliverPending,zones,reportZone,reviewZone,stop:async()=>{stopped=true;await running;}};
}
