import { check } from '../../shared/errors.mjs';
import { exportRequest, ref, parse, pick, iso, wat, csv, asMoney, timelineRow } from './domain.mjs';

const MAX_EVENTS = 500;
const FILE_LIMIT = 10 * 1024 * 1024;
const LIMITS = {maxDriverDocuments:8,maxChatRows:MAX_EVENTS,maxTimelineRows:3000};
const time = value => ({utc:iso(value),nigeria:wat(value)});
function limited(rows,label) {
  check(rows.length<=MAX_EVENTS,'EXPORT_TOO_LARGE',`The ${label} exceeds ${MAX_EVENTS} entries. Request a scoped manual evidence review.`);
  return rows;
}
const point = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  ? pick(value,['name','lat','lng']) : value?.name?{name:value.name,coordinatesAvailable:false}:null;
function plannedRoute(value) {
  const route=parse(value);
  if(!route)return {recorded:false,notice:'No saved booking route is available.'};
  const coordinates=Array.isArray(route.coordinates)&&route.coordinates.length<=1300&&route.coordinates.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))
    ? route.coordinates : null;
  return {recorded:true,kind:'booking_preview_not_actual_driver_track',pickup:point(route.pickup),destination:point(route.destination),
    distanceMeters:route.distanceMeters??null,durationSeconds:route.durationSeconds??null,source:route.source??null,
    distanceKind:route.distanceKind??null,trafficAware:route.trafficAware===true,plannedPolylineLngLat:coordinates,
    polylineNotice:coordinates?'Coordinates are the planned quote geometry, NOT historical GPS fixes from the actual journey.':'Planned route geometry is unavailable or was outside the export limit.'};
}
const user=(id,name,email)=>id?{id,name:name??null,email:email??null,kind:'account_at_export_time'}:null;
const timeFields=(row,names)=>Object.fromEntries(names.map(name=>[name,time(row[name])]));
function safeNarrative(value) {return String(value??'').slice(0,1600);}

export function createAdminInvestigationsService({ repository, requirePermission, audit, unitOfWork, tokens, clock, archiveCodec }) {
  const { zip: evidenceZip, sha256 } = archiveCodec;
  async function preview(userId,kind,id) {
    await requirePermission(userId,'investigations.read');
    ref(kind,id);const row=kind==='food'?await repository.food(id):await repository.ride(id);
    check(row && (kind==='food'||Boolean(row.parcelDetailsJson)===(kind==='courier')),'NOT_FOUND','The selected transaction was not found.');
    const docs=row.workerId?await repository.documents(row.workerId):[];
    return {viewerId:userId,record:{service:kind,id,status:row.tripStatus??row.orderStatus??row.requestStatus,createdAt:Number(row.createdAt),
      customerName:row.customerName,workerName:row.workerName??null,driverDocumentsAvailable:docs.length},
      history:await repository.prior(kind,id),notice:'Exports are limited to one recorded transaction and require a documented, reviewed legal authority. Preview does not access document contents or current GPS.'};
  }
  async function create(userId,data) {
    const input=exportRequest(data);
    return unitOfWork(async()=>{
      await requirePermission(userId,'investigations.read');await requirePermission(userId,'investigations.export');
      if(input.includeDocuments)await requirePermission(userId,'compliance.read');
      const now=clock(),exportId=tokens.id();
      const row=input.kind==='food'?await repository.food(input.id):await repository.ride(input.id);
      check(row && (input.kind==='food'||Boolean(row.parcelDetailsJson)===(input.kind==='courier')),'NOT_FOUND','The selected transaction was not found.');
      check(input.kind!=='food'||!input.includeMessages,'INVALID_INPUT','Food orders do not have the ride chat history.');
      const service=input.kind,driverId=row.workerId??null;
      const snapshot=service==='food'?parse(row.snapshotJson)||{}:null;
      const application=driverId?await repository.driver(driverId):null;
      const details=parse(application?.detailsJson)||{},verification=parse(application?.verificationJson)||{};
      const documentRows=driverId?await repository.documents(driverId):[];
      const documents=documentRows.map(doc=>({id:doc.id,kind:doc.kind,originalName:doc.name,mimeType:doc.mimeType,
        bytes:Number(doc.sizeBytes),sha256:doc.sha256,expiresOn:doc.expiresOn??null,uploadedAtUtc:iso(doc.createdAt),originalFileIncluded:false}));
      const driver=driverId?{
        account:user(driverId,row.workerName,row.workerEmail),
        applicationAtExport:application?{
          accountCreatedAtUtc:iso(application.accountCreatedAt),driverStatus:application.driverStatus,applicationStatus:application.applicationStatus,
          applicationVersion:Number(application.applicationVersion??0),submittedAtUtc:iso(application.submittedAt),reviewedAtUtc:iso(application.applicationReviewedAt),
          reviewedReason:application.reviewReason??null,verification:pick(verification,['method','reference','verifiedAt']),
          identity:pick(details,['legalName','phone','licenceNumber']),
          currentlyRegisteredVehicle:pick(details.vehicle,['category','make','model','year','colour','color','plate','payloadKg']),
          legacyVehicle:pick(application,['vehicleModel','vehiclePlate']),
        }:null,
        applicationEvents:application?limited(await repository.applicationEvents(driverId),'driver application history').map(e=>({...pick(e,['action','version','actorId','reason']),createdAtUtc:iso(e.createdAt)})):[],
        documents,
        warning:'Driver application details and documents are CURRENT at export time and may differ from those at trip time; the booked vehicle snapshot is separate.',
      }:null;
      const trip={schemaVersion:1,service,id:row.id,
        exportedAtUtc:iso(now),caseReference:input.caseReference,
        customer:user(row.customerId,row.customerName,row.customerEmail),
        driverOrCourier:driverId?user(driverId,row.workerName,row.workerEmail):null,
        status:row.tripStatus??row.orderStatus??row.requestStatus,
        bookingOrOrder:service==='food'?{
          orderCreatedAtUtc:iso(row.createdAt),orderUpdatedAtUtc:iso(row.updatedAt),orderStatus:row.orderStatus,
          storeId:row.storeId,store:pick(parse(row.storeDetailsJson),['name','sellerType','cuisine','areaId']),
          restaurant:pick(snapshot.restaurant,(parse(row.storeDetailsJson)?.sellerType==='private_kitchen' ? ['name','areaId','sellerType'] : ['name','areaId','address','sellerType'])),
          destination:{...pick(snapshot.address,['line','areaId','town','lat','lng']),recordedMapPoint:point(snapshot.address?.point)},
          recipient:pick(snapshot.recipient,['kind','name','phone']),
          items:Array.isArray(snapshot.lines)?snapshot.lines.slice(0,100).map(line=>pick(line,['name','itemId','quantity','priceKobo','unitPriceKobo','totalKobo'])):[],
          totals:pick(snapshot.totals,['subtotalKobo','deliveryFeeKobo','totalKobo','currency']),
          payment:pick(snapshot.payment,['method','status','targetId']),
        }:{
          requestedAt:time(row.createdAt),matchedAt:time(row.matchedAt),lastUpdatedAt:time(row.updatedAt),
          status:row.requestStatus,tripStatus:row.tripStatus??null,closedReason:row.closedReason??null,
          vehicleCategory:row.vehicleCategory,vehicleAtAssignment:pick(parse(row.driverSnapshotJson),['id','name','vehicle']),
          suggestedFare:asMoney(row.suggestedFareKobo),agreedFare:asMoney(row.agreedFareKobo),
          times:timeFields(row,['bookedAt','departedAt','arrivedAt','startedAt','completedAt']),
          plannedRoute:plannedRoute(row.routeJson),
          parcel:service==='courier'?pick(parse(row.parcelDetailsJson),['description','weightKg','quantity','recipientName','recipientPhone']):null,
        },
        payment:service==='food'?{providerReference:row.checkoutReference??null,providerStatus:row.checkoutStatus??null,providerPaidAtUtc:iso(row.checkoutPaidAt),
            total:asMoney(snapshot.totals?.totalKobo)}:
          {legacyMode:row.paymentMode??null,legacyStatus:row.paymentStatus??null,legacyReference:row.paymentReference??null,
            legacyPaidAtUtc:iso(row.paidAt),providerReference:row.checkoutReference??null,providerStatus:row.checkoutStatus??null,providerPaidAtUtc:iso(row.checkoutPaidAt)},
        paymentWarning:'Amounts and fare agreements are not proof of successful payment. Provider status/reference and paid timestamp, when recorded, are shown separately.',
        locationHistoryWarning:'Taxi Ai does not keep a historical GPS breadcrumb trail here. Planned booking geometry is NOT evidence of where a driver actually travelled. Closed active-sharing positions are deleted by the application.',
      };
      const timeline=[];
      if(service==='food'){
        const events=parse(row.eventsJson);
        if(Array.isArray(events)){
          check(events.length<=MAX_EVENTS,'EXPORT_TOO_LARGE','Food event history is too large for this export.');
          for(const ev of events)timeline.push(timelineRow('food_stage',safeNarrative(ev.status),ev.at,null,safeNarrative(ev.reason)));
        }
      }else{
        for(const ev of limited(await repository.rideEvents(row.id),'ride history'))timeline.push(timelineRow('trip_stage',ev.type,ev.createdAt,ev.actorId,ev.reason));
        const offers=limited(await repository.dispatch(row.id),'dispatch offers');
        trip.dispatch={totalOffers:offers.length,accepted:offers.filter(v=>v.status==='accepted').length,
          declined:offers.filter(v=>v.status==='declined').length,expired:offers.filter(v=>v.status==='expired').length};
        for(const offer of offers){
          // Other unmatched drivers do not belong in a single-driver evidence disclosure.
          timeline.push(timelineRow('dispatch',offer.status,offer.closedAt??offer.createdAt,offer.driverId===driverId?driverId:null,
            `ETA source ${offer.etaSource}; offer ${offer.id}; invited driver ${offer.driverId===driverId?'assigned':'other not disclosed'}`));
        }
        const fares=limited(await repository.fareEvents(row.id),'fare events');
        trip.fareNegotiation=fares.map(event=>({version:Number(event.version),action:event.type,...pick(parse(event.payload),['amountKobo','proposedBy','offerId','expiresAt']),
          recordedTimestampAvailable:false}));
        for(const call of limited(await repository.calls(row.id),'call metadata'))timeline.push(timelineRow('call',call.status,call.endedAt??call.createdAt,call.callerId,
          `Call ${call.id}; connectedAt ${iso(call.connectedAt)??'not recorded'}; reason ${safeNarrative(call.reason)}`));
        for(const incident of limited(await repository.safety(row.id),'safety incident history'))timeline.push(timelineRow('safety',incident.kind,incident.createdAt,incident.reporterId,
          `${incident.status}: ${safeNarrative(incident.note)}`));
        if(service==='courier'){
          const proof=await repository.handover(row.id);
          trip.parcelHandover=proof?{verifiedAtUtc:iso(proof.verifiedAt),method:proof.method,locationRecorded:Boolean(proof.positionRecorded)}:null;
          if(proof)timeline.push(timelineRow('handover','verified',proof.verifiedAt,null,proof.method));
        }
      }
      const sharing=service==='food'?await repository.foodLocation(row.id):await repository.rideLocation(row.id);
      trip.locationShareSessions=limited(sharing,'location-share sessions').map(s=>({startedAtUtc:iso(s.startedAt),lastSeenAtUtc:iso(s.lastSeenAt),stoppedAtUtc:iso(s.stoppedAt),updates:Number(s.sequence),activeAtExport:Boolean(s.active),exactPositionIncluded:false}));
      for(const session of sharing)timeline.push(timelineRow('location_share','started',session.startedAt,null,'Driver/courier live-sharing session started'));
      for(const session of sharing)if(session.stoppedAt)timeline.push(timelineRow('location_share','stopped',session.stoppedAt,null,'Position removed from saved share'));
      const entries=[],add=(name,body)=>entries.push({name,body:Buffer.isBuffer(body)?body:Buffer.from(String(body),'utf8')});
      const caseInfo={exportId,createdAtUtc:iso(now),createdAtNigeria:wat(now),service,transactionId:row.id,
        caseReference:input.caseReference,requestingAuthority:input.requestingAuthority,authorityReference:input.authorityReference,
        legalBasis:input.legalBasis,recordedPurpose:input.purpose,preparedByStaffId:userId,
        sensitiveDocumentsRequested:input.includeDocuments,sensitiveChatRequested:input.includeMessages,
        notice:'Requesting authority and legal basis are declarations entered by staff, not independently verified by Taxi Ai.'};
      const plan=trip.bookingOrOrder.plannedRoute??null;
      const locations=[];
      for(const [kind,p] of [['planned_pickup',plan?.pickup],['planned_destination',plan?.destination]])if(p){
        locations.push([kind,'booking_preview_not_actual_gps',iso(row.createdAt),p.name??'',p.lat??'',p.lng??'',
          'Route quote supplied by rider or routing provider; NOT the observed path travelled.']);
      }
      if(service==='food'){
        const address=trip.bookingOrOrder.destination,pt=address?.recordedMapPoint;
        if(pt)locations.push(['order_delivery_destination','order_snapshot_not_actual_gps',iso(row.createdAt),pt.name??address.line??'',pt.lat??'',pt.lng??'',
          'Customer delivery destination from saved order; NOT courier movement history.']);
      }
      for(const share of trip.locationShareSessions){
        locations.push(['share_started','sharing_metadata_no_coordinates',share.startedAtUtc,'','','',
          'Location sharing began; coordinates are not retained here.']);
        if(share.stoppedAtUtc)locations.push(['share_stopped','sharing_metadata_no_coordinates',share.stoppedAtUtc,'','','',
          'Location sharing ended and live GPS value was cleared.']);
      }
      add('locations.csv',csv(['record_type','location_evidence_type','time_utc','location_name','latitude','longitude','limitations'],locations));
      const fare=service==='food'?trip.payment.total:trip.bookingOrOrder.agreedFare;
      const money=value=>value?`NGN ${value.formattedNgn} (${value.amountKobo} kobo)`:'Not recorded';
      const summaryText=[
        'TAXI AI — CASE INVESTIGATION SUMMARY (RECORDS AT TIME OF EXPORT)',
        `Case: ${input.caseReference}`,`Export ID: ${exportId}`,`Prepared UTC: ${iso(now)}`,
        `Agency/team entered by staff: ${input.requestingAuthority}`,`Reference: ${input.authorityReference}`,
        `Legal basis declared by staff: ${input.legalBasis}`,'',
        `SERVICE: ${service.toUpperCase()}`,`TRANSACTION: ${row.id}`,`CURRENT STATUS: ${trip.status}`,
        `CUSTOMER: ${row.customerName??'Unknown'}`,`CUSTOMER EMAIL: ${row.customerEmail??'Not recorded'}`,
        `DRIVER / COURIER: ${row.workerName??'Unassigned'}`,`DRIVER EMAIL: ${row.workerEmail??'Not recorded'}`,
        `DRIVER ACCOUNT: ${driverId??'Unassigned'}`,
        `BOOKING CREATED UTC: ${iso(row.createdAt)}`,
        `MATCHED UTC: ${iso(row.matchedAt)??'Not recorded'}`,
        `BOOKED UTC: ${iso(row.bookedAt)??'Not recorded'}`,
        `DEPARTED UTC: ${iso(row.departedAt)??'Not recorded'}`,
        `ARRIVED AT PICKUP UTC: ${iso(row.arrivedAt)??'Not recorded'}`,
        `STARTED UTC: ${iso(row.startedAt)??'Not recorded'}`,
        `COMPLETED UTC: ${iso(row.completedAt)??'Not recorded'}`,
        `FARE / ORDER AMOUNT: ${money(fare)}`,
        `SUGGESTED FARE: ${money(trip.bookingOrOrder.suggestedFare)}`,
        `PAYMENT STATUS: ${trip.payment.providerStatus??trip.payment.legacyStatus??'Not recorded'}`,
        `PAYMENT REFERENCE: ${trip.payment.providerReference??trip.payment.legacyReference??'Not recorded'}`,
        `PLANNED PICKUP: ${plan?.pickup?.name??'Not recorded'}`,
        `PLANNED DESTINATION: ${plan?.destination?.name??trip.bookingOrOrder.destination?.line??'Not recorded'}`,
        `PLANNED PICKUP GPS: ${plan?.pickup?.lat??'N/A'}, ${plan?.pickup?.lng??'N/A'}`,
        `PLANNED DESTINATION GPS: ${plan?.destination?.lat??'N/A'}, ${plan?.destination?.lng??'N/A'}`,
        `DRIVER LEGAL NAME (CURRENT): ${driver?.applicationAtExport?.identity?.legalName??'Not recorded'}`,
        `DRIVER PHONE (CURRENT): ${driver?.applicationAtExport?.identity?.phone??'Not recorded'}`,
        `LICENCE NUMBER (CURRENT): ${driver?.applicationAtExport?.identity?.licenceNumber??'Not recorded'}`,
        `ASSIGNED VEHICLE SNAPSHOT: ${JSON.stringify(trip.bookingOrOrder.vehicleAtAssignment??{})}`,
        `CURRENT APPLICATION STATUS: ${driver?.applicationAtExport?.applicationStatus??'Not available'}`,
        `AVAILABLE DRIVER DOCUMENT REFERENCES: ${driver?.documents?.length??0}`,
        `DRIVER ORIGINAL DOCUMENT IMAGES ATTACHED: ${input.includeDocuments?'Requested; see manifest and driver.json':'No'}`,
        `CHAT MESSAGES ATTACHED: ${input.includeMessages?'Requested; see chat.csv':'No'}`,'',
        'IMPORTANT: A planned route/coordinate is not evidence of the actual path the vehicle drove.',
        'Actual driver GPS breadcrumb history is not retained by Taxi Ai in this release.',
        'All times above are UTC. timeline.csv also includes Nigeria time (WAT).',
        'Driver details/documents may be newer than the journey and represent the state at export time.',
        'The staff-declared legal basis has not been independently verified by the software.',
        'Use the manifest to compare SHA-256 of every file and the audited receipt for ZIP SHA-256.',
      ].join('\n')+'\n';
      add('summary.txt',summaryText);
      add('case.json',JSON.stringify(caseInfo,null,2)+'\n');
      add('trip.json',JSON.stringify(trip,null,2)+'\n');
      if(driver)add('driver.json',JSON.stringify(driver,null,2)+'\n');
      let includedDocuments=0;
      if(driver&&input.includeDocuments){
        check(documents.length<=LIMITS.maxDriverDocuments,'EXPORT_TOO_LARGE','Too many current driver documents for one evidence package.');
        let total=0;
        for(const doc of documents){
          const stored=await repository.document(doc.id);
          check(stored&&['image/jpeg','image/png'].includes(stored.mimeType),'EVIDENCE_UNAVAILABLE','Driver document could not be read consistently.');
          const content=Buffer.from(stored.content);total+=content.length;
          check(total<=FILE_LIMIT&&content.length===Number(stored.sizeBytes),'EVIDENCE_UNAVAILABLE','Driver document size is inconsistent.');
          check(sha256(content)===stored.sha256,'EVIDENCE_INTEGRITY','A driver document did not match its stored digest. Export was refused.');
          const path=`driver_documents/${doc.kind}-${doc.id}.${stored.mimeType==='image/png'?'png':'jpg'}`;
          add(path,content);doc.originalFileIncluded=true;doc.archivePath=path;includedDocuments++;
        }
        // Replace the driver metadata file after the file-path manifest is known.
        const index=entries.findIndex(e=>e.name==='driver.json');
        if(index!==-1)entries[index].body=Buffer.from(JSON.stringify(driver,null,2)+'\n');
      }
      const lines=timeline.sort((a,b)=>(a.recordedAtUtc??'').localeCompare(b.recordedAtUtc??''));
      check(lines.length<=LIMITS.maxTimelineRows,'EXPORT_TOO_LARGE','The timeline exceeds the evidence package limit.');
      add('timeline.csv',csv(['category','action','recorded_at_utc','recorded_at_nigeria','actor_id','note'],
        lines.map(v=>[v.category,v.action,v.recordedAtUtc,v.recordedAtWat,v.actorId,v.note])));
      let includedMessages=0;
      if(input.includeMessages){
        const messages=limited(await repository.messages(row.id),'chat history');includedMessages=messages.length;
        add('chat.csv',csv(['sequence','sent_at_utc','sent_at_nigeria','sender_account_id','message'],
          messages.map(m=>[m.sequence,iso(m.createdAt),wat(m.createdAt),m.senderId,m.body])));
      }
      add('README.txt',[
        'TAXI AI — CASE-SCOPED INVESTIGATION EVIDENCE EXPORT',`Export ID: ${exportId}`,
        `Case reference: ${input.caseReference}`,`Transaction: ${service} / ${row.id}`,`Exported UTC: ${iso(now)}`,
        'Only recorded facts are included; original source data has not been edited by this export.',
        'Route coordinates in trip.json are PLANNED booking preview geometry, not a historical track.',
        'Taxi Ai clears live-shared driver/courier GPS positions on sharing end. This export contains no reconstructed travelled path.',
        'Driver application fields and document files are as stored AT EXPORT TIME, not necessarily at the time of the trip.',
        'Call records are signaling metadata, not recordings. Pickup and delivery PINs are deliberately omitted.',
        'Payment records reflect provider/transaction states, not evidence of a bank transfer unless separately verified.',
        'manifest.json lists the SHA-256 for each content file; archive SHA-256 is recorded in the audited admin export receipt.',
        'A hash enables later byte comparison; it does not establish that an original claim is true or constitute a digital signature.',
        'Do not redistribute more personal information than the verified legal request authorizes.',
        'Transfer via an approved encrypted channel, preserve a separate secure copy of the archive hash, and record each recipient and handover.',
        `Case basis entered by staff: ${input.legalBasis}`,`Prepared for: ${input.requestingAuthority}`,`Documents attached: ${includedDocuments}`,
        `Ride chat rows attached: ${includedMessages}`,
      ].join('\n')+'\n');
      const manifest={schemaVersion:1,exportId,createdAtUtc:iso(now),caseReference:input.caseReference,service,transactionId:row.id,
        files:entries.map(e=>({path:e.name,sizeBytes:e.body.length,sha256:sha256(e.body)})),
        limitations:['No continuous historical GPS location trail exists in this feature.','Driver documents represent current stored files.','No biometric templates, passwords, payment-card details, PIN values, push tokens or call audio are included.']};
      const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
      add('manifest.json',manifestBytes);
      const zip=evidenceZip(entries),archiveSha256=sha256(zip),manifestSha256=sha256(manifestBytes);
      await repository.record({id:exportId,actorId:userId,kind:service,transactionId:row.id,driverId,caseReference:input.caseReference,
        requestingAuthority:input.requestingAuthority,authorityReference:input.authorityReference,legalBasis:input.legalBasis,purpose:input.purpose,
        includeDocuments:input.includeDocuments,includeMessages:input.includeMessages,archiveSha256,manifestSha256,archiveBytes:zip.length,createdAt:now});
      await audit.record(userId,'admin.investigation.export',row.id,now);
      const filename=`taxi-ai-evidence-${service}-${row.id.slice(0,8)}-${exportId}.zip`;
      return {content:zip,filename,sha256:archiveSha256,exportId,createdAt:now};
    });
  }
  return Object.freeze({preview,create});
}
