import { $,element } from './dom.mjs';
import { readVehiclePhoto } from './vehicle-photo.mjs';
import { createVehicleCheckController } from '/shared/vehicle-check-controller.mjs';
import { CHECK_FIELDS,CHECK_GUIDANCE,CHECK_LABELS,PHOTO_CHECK_NOTICE } from '/shared/vehicle-checks.mjs';

export function createVehiclePhotoCheck({client,onReport,readPhoto=readVehiclePhoto,makeKey=()=>crypto.randomUUID()}) {
  let scope='',controller=null,unsubscribe=null,image=null,choosing=false,generation=0,lastResult='',fileError='';
  function clearPhoto() { image=null;$('vehicle-check-file').value='';$('vehicle-check-preview').width=0;$('vehicle-check-preview').height=0;$('vehicle-check-preview').hidden=true;$('vehicle-check-consent').checked=false; }
  function render() {
    $('vehicle-check-panel').hidden=!controller;if(!controller)return;
    const s=controller.snapshot(),latest=s.value?.checks[0],locked=s.pending||choosing||!s.value?.canCheck||s.value.checks.some(c=>c.outcome==='pending');
    $('vehicle-check-error').textContent=fileError||s.error;
    $('vehicle-check-status').textContent=s.pending?'Checking the photo…':s.value&&!s.value.enabled?'Photo checks are not enabled yet. Compare the physical vehicle yourself.':s.loading?'Loading photo checks…':'';
    $('vehicle-check-file').disabled=locked;$('vehicle-check-consent').disabled=locked;
    $('vehicle-check-submit').disabled=locked||!image||!$('vehicle-check-consent').checked;
    $('vehicle-check-refresh').disabled=s.pending||s.loading;
    $('vehicle-check-clear').disabled=!image||s.pending;
    for(const id of ['vehicle-check-submit','vehicle-check-refresh','vehicle-check-clear']) $(id).dataset.locked=String($(id).disabled);
    const key=JSON.stringify(latest);
    if(key!==lastResult){lastResult=key;$('vehicle-check-result').replaceChildren();
      if(latest){const box=$('vehicle-check-result');box.append(element('h4',CHECK_LABELS[latest.outcome]),
        element('p',`${new Date(latest.createdAt).toLocaleString()}${latest.current?'':' · Historical result; check the current pickup yourself.'}`,'small-note'),element('p',CHECK_GUIDANCE[latest.outcome]));
        const details=element('dl',undefined,'safety-details');for(const f of latest.fields)details.append(element('dt',CHECK_FIELDS[f.key]),
          element('dd',`Expected: ${f.expected} · Photo: ${f.observed} · ${f.status==='different'?'Differs':f.status==='match'?'Appears to match':'Not confirmed'}`));box.append(details);
      }
    }
    const report=$('vehicle-check-report');report.hidden=!latest||!['possible_match','possible_mismatch','inconclusive'].includes(latest.outcome);
    report.disabled=s.pending;report.dataset.locked=String(report.disabled);
    report.onclick=()=>{if(!controller.snapshot().pending&&latest)onReport(latest.rideId,latest.id);};
  }
  function reset(){generation++;unsubscribe?.();controller?.pause();unsubscribe=controller=null;scope='';choosing=false;lastResult='';fileError='';clearPhoto();$('vehicle-check-result').replaceChildren();$('vehicle-check-error').textContent='';$('vehicle-check-status').textContent='';render();}
  function context(user,ride){
    const next=user?.role==='customer'&&ride?.customer?.id===user.id&&ride.driver&&['booked','on_way','arrived'].includes(ride.status)?`${user.id}:${ride.id}`:'';
    if(next===scope)return;
    reset();if(!next)return;scope=next;
    controller=createVehicleCheckController({rideId:ride.id,makeKey,api:{load:id=>client.request(`/api/vehicle-checks/rides/${id}`),
      submit:(id,data,key)=>client.request(`/api/vehicle-checks/rides/${id}`,{method:'POST',data,key})}});
    unsubscribe=controller.subscribe(render);void controller.activate();render();
  }
  $('vehicle-check-disclosure').textContent=PHOTO_CHECK_NOTICE;
  $('vehicle-check-file').addEventListener('change',async()=>{
    if(!controller||controller.snapshot().pending||choosing)return;
    const file=$('vehicle-check-file').files?.[0],epoch=generation;fileError='';clearPhoto();if(!file){render();return;}
    choosing=true;render();
    try{const value=await readPhoto(file);if(epoch!==generation)return;image=value.image;
      const canvas=$('vehicle-check-preview');canvas.width=value.preview.width;canvas.height=value.preview.height;canvas.getContext('2d').drawImage(value.preview,0,0);canvas.hidden=false;
    }catch(error){if(epoch===generation)fileError=error.message;}
    finally{if(epoch===generation){choosing=false;render();}}
  });
  $('vehicle-check-consent').addEventListener('change',render);
  $('vehicle-check-clear').addEventListener('click',()=>{if(!controller?.snapshot().pending){clearPhoto();render();}});
  $('vehicle-check-form').addEventListener('submit',event=>{event.preventDefault();if(!controller||!image||!$('vehicle-check-consent').checked||$('vehicle-check-submit').disabled)return;
    const photo=image;clearPhoto();void controller.analyse(photo);render();});
  $('vehicle-check-refresh').addEventListener('click',()=>void controller?.load());
  return Object.freeze({context,reset,poll:()=>controller?.load(true)});
}
