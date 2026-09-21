import type { MobileClient } from '../api/client.ts';
import type { Contact, SafetyTrip } from './contracts.ts';
import { definiteFailure } from '../journeys/controller.ts';
type Api=Pick<MobileClient,'safetyContacts'|'safetyTrip'|'safetyCommand'>;
export interface SafetyState {contacts:Contact[];trip:SafetyTrip|null;busy:boolean;loading:boolean;stale:boolean;uncertain:boolean;error:string;notice:string;token:string|null}
export class SafetyController {
 private active=false;private disposed=false;private generation=0;private listeners=new Set<()=>void>();
 private pending:{path:string;data:Record<string,unknown>;key:string}|null=null;
 private state:SafetyState={contacts:[],trip:null,busy:false,loading:false,stale:true,uncertain:false,error:'',notice:'',token:null};
 private api:Api;readonly id:string;private key:()=>string;
 constructor(api:Api,id:string,key:()=>string){this.api=api;this.id=id;this.key=key;}
 snapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private patch(v:Partial<SafetyState>){if(this.disposed)return;this.state={...this.state,...v};for(const fn of this.listeners)fn();}
 activate(){if(this.disposed)return;this.active=true;void this.refresh();}
 pause(){this.active=false;this.generation++;this.patch({stale:true,loading:false,token:null});}
 dispose(){this.pause();this.disposed=true;this.pending=null;this.state={...this.state,contacts:[],trip:null,error:'',notice:''};this.listeners.clear();}
 async refresh(clearError=true){if(!this.active||this.state.busy||this.state.loading)return;const g=++this.generation;this.patch({loading:true});try{
  const [contacts,trip]=await Promise.all([this.api.safetyContacts(),this.api.safetyTrip(this.id)]);
  if(!this.active||g!==this.generation||this.disposed)return;
  if(trip.rideId!==this.id)throw new Error('Safety details belong to a different journey. Refresh and try again.');
  const same=this.state.trip?.share?.id===trip.share?.id;
  this.patch({contacts,trip,stale:false,...(clearError&&!this.pending?{error:''}:{}),...(!same||!trip.share?.active?{token:null}:{})});
 }catch(e){if(g===this.generation&&this.active)this.patch({stale:true,error:e instanceof Error?e.message:'Unable to load safety details.'});}
 finally{if(g===this.generation)this.patch({loading:false});}}
 async command(path:string,data:Record<string,unknown>){if(!this.active||this.disposed||this.pending||this.state.busy||this.state.stale)return;
 this.generation++;this.pending={path,data:structuredClone(data),key:this.key()};this.patch({loading:false});await this.run();}
 async retry(){if(this.active&&!this.state.busy&&this.pending)await this.run();}
 private async run(){const cmd=this.pending;if(!cmd)return;this.patch({busy:true,error:'',notice:''});let token:string|null=null,shareId:string|null=null;const started=this.generation;
 try{const r=await this.api.safetyCommand(cmd.path,cmd.data,cmd.key);if(this.disposed)return;this.pending=null;
 token=r.token??null;shareId=r.share?.id??null;this.patch({uncertain:false,token:null,notice:cmd.path.endsWith('/links')&&!token?'Link saved but its private URL is unavailable. Revoke or explicitly replace it.':'Saved. No emergency services or trusted contacts were contacted.'});
 }catch(e){if(this.disposed)return;const definite=definiteFailure(e);if(definite)this.pending=null;this.patch({uncertain:!definite,stale:true,error:e instanceof Error?e.message:'Connection failed. Retry the same action.'});}
 finally{this.patch({busy:false});}
 if(this.active&&!this.disposed){const beforeRefresh=this.generation;const uninterrupted=started===beforeRefresh;await this.refresh(false);if(token&&uninterrupted&&this.generation===beforeRefresh+1&&this.active&&!this.state.stale&&this.state.trip?.share?.active&&this.state.trip.share.id===shareId)this.patch({token});}
 }
}
