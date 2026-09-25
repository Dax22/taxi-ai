import type { MobileClient } from '../api/client.ts';
import type { Work, Availability, OnlineData, Position, AvailableJob, Journey } from '../../../../packages/shared/src/mobile-journeys.mjs';
import { definiteFailure } from '../journeys/controller.ts';
type Api=Pick<MobileClient,'work'|'online'|'offline'|'heartbeat'|'journeyCommand'|'declineOffer'>;
type Command={kind:'online';data:OnlineData;key:string}|{kind:'offline';id:string;key:string}|{kind:'claim';job:AvailableJob;key:string}|{kind:'decline';offerId:string;key:string};
export interface WorkState { work:Work|null; availability:Availability|null; busy:boolean; loading:boolean; stale:boolean; uncertain:boolean; error:string; now:number; journey:Journey|null }
export class WorkController {
  private api:Api; private key:()=>string; private locate:(ask:boolean)=>Promise<Position>; readonly clientId:string;
  private active=false; private disposed=false; private reads=0; private command:Command|null=null; private intent=false;
  private listeners=new Set<()=>void>(); private anchor={server:0,local:0}; private clock:()=>number;
  private state:WorkState={work:null,availability:null,busy:false,loading:false,stale:true,uncertain:false,error:'',now:0,journey:null};
  constructor(api:Api,key:()=>string,locate:(ask:boolean)=>Promise<Position>,clock=()=>performance.now()) { this.api=api;this.key=key;this.clientId=key();this.locate=locate;this.clock=clock; }
  snapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private patch(v:Partial<WorkState>){if(this.disposed)return;this.state={...this.state,...v};for(const fn of this.listeners)fn();}
  private time(n:number){this.anchor={server:n,local:this.clock()};return n;}
  private now(){return this.anchor.server+Math.max(0,this.clock()-this.anchor.local);}
  tick(){if(this.active)this.patch({now:this.now()});}
  activate(){if(this.disposed)return;this.active=true;void this.refresh();}
  pause(){this.active=false;this.intent=false;this.reads++;this.patch({stale:true,loading:false});if(this.state.availability?.owned&&!this.command&&!this.state.busy)void this.offline(true);}
  dispose(){this.pause();this.disposed=true;this.listeners.clear();}
  async refresh(){
    if(!this.active||this.disposed||this.state.busy||this.state.loading)return;
    const read=++this.reads;this.patch({loading:true});
    try{const work=await this.api.work(this.clientId);if(this.active&&read===this.reads)this.patch({work,availability:work.availability,stale:false,now:this.time(work.serverNow),...(this.command?{}:{error:''})});}
    catch(e){if(this.active&&read===this.reads)this.patch({stale:true,error:e instanceof Error?e.message:'Unable to refresh work.'});}
    finally{if(read===this.reads)this.patch({loading:false});}
  }
  async online(areaId?:string){
    if(!this.active||this.disposed||this.command||this.state.busy||this.state.stale||!this.state.work||this.state.availability?.online)return;
    this.patch({busy:true,error:''});const read=++this.reads;
    try{
      const data:OnlineData=areaId?{mode:'sample',areaId}:{mode:'gps',position:await this.locate(true)};
      if(!this.active||read!==this.reads||this.disposed){this.patch({error:'Choose Go online again when the app is open and location permission is ready.'});return;}
      this.intent=true;this.command={kind:'online',data,key:this.key()};
    }catch(e){this.patch({error:e instanceof Error?e.message:'Location is unavailable.'});}
    finally{this.patch({busy:false});}
    if(this.command)await this.run();
  }
  async offline(background=false):Promise<boolean>{
    this.intent=false;
    if(this.disposed||this.command||this.state.busy||(!this.active&&!background))return false;
    if(!this.state.availability?.online)return !this.state.stale;
    this.command={kind:'offline',id:this.state.availability.id,key:this.key()};await this.run();
    return !this.command&&!this.state.availability?.online;
  }
  async claim(job:AvailableJob){
    if(!this.canRespond(job))return;
    this.command={kind:'claim',job:{...job,...(job.offer?{offer:{...job.offer}}:{})},key:this.key()};await this.run();
  }
  private canRespond(job:AvailableJob){
    return this.active&&!this.disposed&&!this.command&&!this.state.busy&&!this.state.stale
      &&Boolean(this.state.availability?.online&&this.state.availability.expiresAt&&this.now()<this.state.availability.expiresAt)
      &&!this.state.work?.current.length&&!this.state.work?.activeElsewhere.length
      &&this.now()<Math.min(job.expiresAt,job.offer?.expiresAt??job.expiresAt)
      &&Boolean(this.state.work?.available.some((r)=>r.id===job.id&&r.version===job.version&&r.offer?.id===job.offer?.id));
  }
  async decline(job:AvailableJob){
    if(!job.offer||!this.canRespond(job))return;
    this.command={kind:'decline',offerId:job.offer.id,key:this.key()};await this.run();
  }
  async retry(){if(this.active&&this.command&&!this.state.busy)await this.run();}
  clearJourney(){this.patch({journey:null});}
  async heartbeat(){
    const lease=this.state.availability;
    if(!this.active||!this.intent||!lease?.online||!lease.owned||this.command||this.state.busy||this.disposed)return;
    const read=++this.reads;this.patch({busy:true,loading:false});
    try{
      const position=lease.mode==='gps'?await this.locate(false):undefined;
      if(!this.active||read!==this.reads||this.disposed)return;
      const result=await this.api.heartbeat(this.clientId,lease.id,lease.sequence+1,position);
      if(this.active&&read===this.reads)this.patch({availability:result.availability,now:this.time(result.serverNow)});
    }catch(e){this.intent=false;this.patch({stale:true,error:e instanceof Error?e.message:'Availability could not be renewed. Go online again after reconnecting.'});}
    finally{this.patch({busy:false});if(!this.intent&&this.state.availability?.owned&&!this.disposed)await this.offline(true);}
  }
  private async run(){
    const cmd=this.command;if(!cmd||this.disposed)return;
    this.reads++;this.patch({busy:true,loading:false,error:''});let success=false;
    try{
      if(cmd.kind==='claim'){
        const result=await this.api.journeyCommand(cmd.job.id,'claim',{expectedVersion:cmd.job.version,...(cmd.job.offer?{offerId:cmd.job.offer.id}:{})},cmd.key);
        this.intent=false;this.patch({journey:result.ride,availability:null,now:this.time(result.serverNow)});
      }else if(cmd.kind==='decline'){
        const result=await this.api.declineOffer(cmd.offerId,cmd.key);
        this.patch({now:this.time(result.serverNow),work:this.state.work?{...this.state.work,available:this.state.work.available.filter((job)=>job.offer?.id!==cmd.offerId)}:null});
      }else{
        const result=cmd.kind==='online'?await this.api.online(this.clientId,cmd.data,cmd.key):await this.api.offline(this.clientId,cmd.id,cmd.key);
        this.patch({availability:result.availability,now:this.time(result.serverNow)});
      }
      this.command=null;success=true;this.patch({uncertain:false,stale:!this.active});
    }catch(e){
      if(definiteFailure(e)){this.command=null;this.patch({uncertain:false,stale:true,error:e instanceof Error?e.message:'Review your work status and try again.'});}
      else this.patch({uncertain:true,stale:true,error:'Your work action was interrupted. Retry the same action before continuing.'});
    }finally{
      this.patch({busy:false});
      if(success&&(!this.active||!this.intent&&cmd.kind!=='decline')&&this.state.availability?.owned&&!this.disposed)await this.offline(true);
      else if(success&&this.active)void this.refresh();
    }
  }
}
