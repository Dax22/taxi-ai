/** Shared lifecycle: explicit activation, immutable uncertain writes, no automatic sensor restart. */
export function createMonitoringController({ read, write, sensors, makeKey, onChange, viewerId, rideId, clock=Date.now }) {
  let epoch=0,revision=0,sensorEpoch=0,closed=false,cleanup=null,polling=false,heartbeatAt=0,pending=null;
  let state={data:null,busy:false,active:false,error:'',uncertain:false,sensorNote:'Monitoring is off.',receivedAt:0};
  const notify=patch=>{state={...state,...patch};onChange(state);};
  function pause(note='Sensors paused. Any saved alert countdown continues on the server.') {
    sensorEpoch++;cleanup?.();cleanup=null;notify({active:false,sensorNote:note});
  }
  const verify=data=>{
    if(viewerId && data?.viewerId!==viewerId || rideId && data?.rideId!==rideId){notify({data:null});throw new Error('Your account or trip changed. Reopen the safety screen.');}
    if(!data||!Array.isArray(data.alerts)||!Array.isArray(data.warnings)||!Number.isFinite(data.serverNow))throw new Error('Invalid safety monitoring response.');return data;};
  async function refresh() {
    if(closed||polling||state.busy)return; polling=true;const e=epoch,r=revision;
    try {
      const result=await read();if(closed||e!==epoch||r!==revision)return;const data=verify(result);
      notify({data,receivedAt:clock()});
      if(!data.canMonitor||!data.preferences.enabled)pause('Monitoring is off.');
      if(state.active&&clock()-heartbeatAt>=15_000){await write('heartbeat',{},makeKey());heartbeatAt=clock();}
    }catch(error){if(!closed&&e===epoch&&r===revision){pause('Connection lost. Sensors paused; saved alerts may still proceed.');notify({error:error.message});}}
    finally{polling=false;}
  }
  async function execute(action,data) {
    if(closed||state.busy||pending)return false;
    pending={action,data,key:makeKey()};return retry();
  }
  async function retry() {
    if(closed||state.busy||!pending)return false;
    const e=epoch,command=pending;revision++;notify({busy:true,error:''});
    try {
      const data=await write(command.action,command.data,command.key);
      if(closed||e!==epoch)return false;
      pending=null;
      if(command.action!=='zones')notify({data:verify(data),receivedAt:clock()});
      notify({uncertain:false});return true;
    }catch(error){if(!closed&&e===epoch){
      if(error.status && error.status<500)pending=null;
      pause('Sensors paused. Review your saved alerts before restarting.');notify({error:error.message,uncertain:Boolean(pending)});
    }return false;}finally{if(!closed&&e===epoch)notify({busy:false});}
  }
  async function signal(signal,position) {
    if(!state.active||state.busy||pending||state.data?.alerts.some(a=>['countdown','queued'].includes(a.status)))return;
    await execute('signal',{signal,...(position?{position}:{})});
  }
  async function start(options) {
    if(closed||state.busy||pending)return;
    if(!options.consent||(!options.contactIds.length&&!options.emergency)){notify({error:'Select an alert recipient and agree to sharing before enabling sensors.'});return;}
    if(!state.data?.canMonitor || state.data.alerts.some(a=>['countdown','queued'].includes(a.status))){notify({error:'Review any pending alert before starting monitoring.'});return;}
    const e=epoch,se=++sensorEpoch;revision++;notify({busy:true,error:''});
    try {
      const stop=await sensors.start(options,(s,p)=>void signal(s,p),note=>pause(note));
      if(closed||e!==epoch||se!==sensorEpoch){stop();if(!closed)notify({busy:false});return;}
      cleanup=stop;notify({busy:false});
      const ok=await execute('preferences',{...options,enabled:true,expectedVersion:state.data.version});
      if(ok&&se===sensorEpoch){heartbeatAt=clock();notify({active:true,sensorNote:'Foreground monitoring is on. Keep this safety screen open.'});}else pause();
    }catch(error){if(!closed&&e===epoch){pause('Sensors could not start.');notify({busy:false,error:error.message});}}
  }
  return {snapshot:()=>state,refresh,start,retry,pause,
    stop:async()=>{pause('Sensors stopped.');if(state.data)await execute('preferences',{...state.data.preferences,enabled:false,expectedVersion:state.data.version});},
    panic:()=>signal({kind:'manual',capturedAt:clock()},sensors.position?.()),
    cancel:a=>execute('cancel',{alertId:a.id,expectedVersion:a.version}),
    reportZone:d=>execute('zones',d),
    close(){epoch++;closed=true;cleanup?.();cleanup=null;pending=null;},
  };
}
