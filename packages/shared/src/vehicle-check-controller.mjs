import { readVehicleCheck, readVehicleChecks, VEHICLE_PHOTO_CONSENT } from './vehicle-checks.mjs';

/** One private screen's state. Photos and retry payloads are never persisted. */
export function createVehicleCheckController({ rideId,api,makeKey }) {
  let state = { value:null,loading:false,pending:false,error:'' }, active = false, generation = 0;
  const listeners = new Set();
  const set = patch => { state = { ...state,...patch }; for (const listener of listeners) listener(); };
  const current = epoch => active && epoch === generation;
  async function load(keepError = false) {
    if (!active || state.pending || state.loading) return;
    const epoch = generation; set({ loading:true,...(keepError ? {} : {error:''}) });
    try { const value = readVehicleChecks(await api.load(rideId),rideId); if (current(epoch)) set({value}); }
    catch (e) { if (current(epoch)) set({value:null,error:e.message || 'Could not load vehicle checks.'}); }
    finally { if (current(epoch)) set({loading:false}); }
  }
  async function analyse(image) {
    if (!active || state.pending || state.loading || !state.value?.canCheck || state.value.checks.some(c=>c.outcome==='pending')) return false;
    const epoch = generation; set({pending:true,error:''});
    try {
      const result = await api.submit(rideId,{image,consentVersion:VEHICLE_PHOTO_CONSENT},makeKey());
      const check = readVehicleCheck(result.check,rideId);
      if (current(epoch)) set({value:{...state.value,checks:[check,...state.value.checks.filter(c=>c.id!==check.id)].slice(0,5)}});
      return current(epoch);
    } catch (e) { if (current(epoch)) set({value:null,error:e.message || 'Check the saved result before sending another photo.'}); return false; }
    finally { if (current(epoch)) { set({pending:false}); await load(true); } }
  }
  return Object.freeze({ snapshot:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    load,analyse,activate(){active=true;return load();},
    pause(){active=false;generation++;set({value:null,loading:false,pending:false,error:''});} });
}
