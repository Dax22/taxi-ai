import { element } from './dom.mjs';
import { createMonitoringController } from '/shared/safety-monitoring-controller.mjs';
import { SAFETY_SIGNAL_LABELS } from '/shared/safety-monitoring.mjs';
import { createSafetySensors } from './safety-sensors.mjs';

export function createSafetyMonitoring({client,root=document.getElementById('safety-monitoring-panel')}) {
  let key='',controller=null,timer=null,epoch=0;
  const button=(text,action)=>{const b=element('button',text,'button button-outline button-small');b.type='button';b.onclick=action;return b;};
  function field(form,title,type='text',value='') {const label=element('label',title),input=element('input');input.type=type;input.value=value;label.append(input);form.append(label);return input;}
  function checkbox(form,title){const label=element('label',undefined,'safety-check'),input=element('input');input.type='checkbox';label.append(input,element('span',title));form.append(label);return input;}
  function reset(){epoch++;key='';controller?.close();controller=null;clearInterval(timer);timer=null;root?.replaceChildren();if(root)root.hidden=true;}
  async function context(user,ride) {
    const next=user?.role==='admin'?`${user.id}:admin`:user&&ride?`${user.id}:${ride.id}`:'';
    if(next===key)return;reset();key=next;if(!root||!next)return;root.hidden=false;const e=epoch;
    if(user.role==='admin'){await admin(user,e);return;}
    root.append(element('h2','Safety monitoring · experimental'),element('p','Possible crash and loud-distress checks run only while this safety screen is visible. Sound level cannot identify a scream or prove panic. A phone drop, music or shouting can trigger a false alarm.','small-note'));
    const status=element('p',undefined,'small-note');status.setAttribute('role','status');
    const error=element('p',undefined,'error-text');error.setAttribute('role','alert');
    const form=element('div',undefined,'stack-form'),crash=checkbox(form,'Enable possible-crash checks (motion and speed)'),distress=checkbox(form,'Enable loud-distress checks (microphone)'),emergency=checkbox(form,'Also alert the configured emergency-service partner');
    const contacts=element('fieldset');contacts.append(element('legend','Family / trusted contacts to alert'));form.append(contacts);
    const consent=checkbox(form,'I agree to share passenger name/ID, driver name/ID, vehicle details and available trip location with the selected recipients when an alert countdown expires.');
    root.append(element('p','A detected event starts a 30-second countdown. Once saved, the countdown can continue if this page closes. Cancelling cannot recall a message already handed to a provider. Browser audio is processed in memory and is never uploaded.','small-note'));
    const actions=element('div',undefined,'review-actions'),alerts=element('div'),warnings=element('div');
    const selected=[];
    const start=button('Start monitoring',()=>void controller.start({crash:crash.checked,distress:distress.checked,emergency:emergency.checked,contactIds:selected.filter(x=>x.input.checked).map(x=>x.id),consent:consent.checked}));
    const stop=button('Stop monitoring and cancel unsent alerts',()=>void controller.stop());
    const panic=button('Start panic alert countdown',()=>void controller.panic());
    const retry=button('Retry the same action',()=>void controller.retry());
    actions.append(start,stop,panic,retry);root.append(status,error,form,actions,alerts,warnings);
    const report=element('form',undefined,'stack-form');report.append(element('h3','Flag a location for review'));
    const name=field(report,'Location name'),lat=field(report,'Latitude','number'),lng=field(report,'Longitude','number'),note=field(report,'What concern did you observe?');lat.step=lng.step='any';name.maxLength=80;note.maxLength=300;
    const reportNotice=element('p',undefined,'small-note');
    const flag=button('Submit location for review',async()=>{const ok=await controller.reportZone({label:name.value,lat:Number(lat.value),lng:Number(lng.value),radiusM:300,note:note.value});if(ok&&e===epoch)reportNotice.textContent='Saved for administrator review. It is not a public warning yet.';});
    report.onsubmit=event=>event.preventDefault();report.append(element('p','Only reviewed reports are shown to other users. Warnings expire and do not establish that an area is safe or unsafe.','small-note'),flag,reportNotice);root.append(report);
    controller=createMonitoringController({viewerId:user.id,rideId:ride.id,read:()=>client.request(`/api/safety-monitoring/rides/${ride.id}`),
      write:(action,data,k)=>client.request(`/api/safety-monitoring/rides/${ride.id}/${action}`,{method:'POST',data,key:k}),
      sensors:createSafetySensors(),makeKey:()=>crypto.randomUUID(),onChange:s=>{
        if(e!==epoch)return;
        const d=s.data,remaining=a=>Math.max(0,Math.ceil((a.dueAt-(d.serverNow+Date.now()-s.receivedAt))/1000));
        status.textContent=`${s.sensorNote} ${d?.settings.delivery==='configured'?'Delivery gateway configured. Provider acceptance does not mean help has been dispatched.':'External alerts unavailable: no delivery gateway is configured.'}`;
        error.textContent=s.error;retry.hidden=!s.uncertain;retry.disabled=s.busy;
        start.disabled=!d?.canMonitor||s.busy||s.active||s.uncertain||Boolean(d?.alerts.some(a=>['countdown','queued'].includes(a.status)));
        stop.disabled=!d||s.busy||s.uncertain;panic.disabled=!s.active||s.busy||s.uncertain;flag.disabled=!d?.canMonitor||s.busy||s.uncertain;
        for(const input of form.querySelectorAll('input'))input.disabled=s.busy||s.active;
        emergency.disabled=s.busy||s.active||!d?.settings.emergencyService;
        alerts.replaceChildren();
        for(const a of d?.alerts??[]){const row=element('article',undefined,'safety-record');row.append(element('h3',SAFETY_SIGNAL_LABELS[a.kind]),element('p',a.status==='countdown'?`Alert countdown: ${remaining(a)} seconds`:a.status));
          if(['countdown','queued'].includes(a.status)){const cancel=button('I am safe — cancel unsent alert',()=>void controller.cancel(a));cancel.disabled=s.busy||s.uncertain;row.append(cancel);}
          for(const j of a.deliveries)row.append(element('p',`${j.name}: ${j.status==='accepted'?'Accepted by gateway; delivery and response unconfirmed':j.status}`,'small-note'));alerts.append(row);}
        warnings.replaceChildren(element('h3','Reviewed location warnings'),element('p',d?.coverage??'Loading warnings…','small-note'));
        for(const z of d?.warnings??[])warnings.append(element('p',`${z.label} · within ${z.radiusM} m · expires ${new Date(z.expiresAt).toLocaleString()}`));
      }});
    try{const result=await client.request('/api/safety/contacts');if(e!==epoch)return;if(result.viewerId!==user.id)throw new Error('Your account changed.');
      for(const c of result.contacts){const input=checkbox(contacts,`${c.name} · ${c.phone}`);selected.push({id:c.id,input});}
      if(!selected.length)contacts.append(element('p','Save trusted contacts above, then refresh this page.'));
    }catch(cause){if(e===epoch)error.textContent=cause.message;}
    if(e!==epoch)return;
    await controller.refresh();if(e!==epoch)return;timer=setInterval(()=>{if(!document.hidden)void controller?.refresh();},3000);
  }
  async function admin(user,e) {
    root.append(element('h2','Location warning review'));
    const status=element('p');status.setAttribute('role','status');const list=element('div');root.append(status,list);
    async function load(){try{const result=await client.request('/api/admin/safety-zones');if(e!==epoch)return;if(result.viewerId!==user.id)throw new Error('Your account changed.');
      list.replaceChildren();
      if(!result.zones.length)list.append(element('p','No location reports to review.'));
      for(const z of result.zones){const row=element('article',undefined,'safety-record');row.append(element('h3',z.label),element('p',`${z.lat}, ${z.lng} · ${z.radiusM} m · ${z.status}`),element('p',z.note));
        const reason=field(row,'Review evidence / reason');reason.maxLength=300;
        for(const [decision,title] of [['approved','Approve for 24 hours'],['rejected','Reject'],['withdrawn','Withdraw warning']])row.append(button(title,async()=>{
          try{await client.command(`/api/admin/safety-zones/${z.id}`,{status:decision,note:reason.value,expiresAt:result.serverNow+86400_000,expectedVersion:z.version});if(e===epoch)await load();}
          catch(err){if(e===epoch)status.textContent=err.message;}
        }));list.append(row);}
    }catch(err){if(e===epoch)status.textContent=err.message;}}
    root.append(button('Refresh location reports',()=>void load()));await load();
  }
  return {context,reset};
}
