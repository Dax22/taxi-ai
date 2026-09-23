import type { MobileClient } from '../api/client.ts';
import type { Journey, JourneyAction, JourneyData, Thread, Message } from '../../../../packages/shared/src/mobile-journeys.mjs';
type Api = Pick<MobileClient,'journey'|'journeyCommand'|'rateDriver'|'thread'|'sendMessage'|'readMessages'|'reportMessage'>;
type Command = { kind: 'journey'; action: JourneyAction; data: JourneyData; key: string } | { kind: 'message'; body: string; key: string } | { kind: 'rating'; stars: number };
export interface JourneyState { ride: Journey | null; thread: Thread | null; messages: Message[]; draft: string; amount: string; pin: string;
 ratingChoice: number; busy: boolean; loading: boolean; stale: boolean; uncertain: boolean; error: string; now: number }
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Could not connect. Try again.';
export function definiteFailure(e: unknown) { const v = e as { status?: number; code?: string }; return v && (typeof v.status === 'number' && v.status >= 400 && v.status < 500 || ['SESSION_CHANGED','UNAUTHENTICATED'].includes(v.code ?? '')); }
export class JourneyController {
  private api: Api; readonly id: string; private key: () => string; private clock: () => number;
  private active = false; private disposed = false; private generation = 0; private command: Command | null = null;
  private anchor = { server: 0, local: 0 }; private listeners = new Set<() => void>();
  private state: JourneyState = { ride: null, thread: null, messages: [], draft: '', amount: '', pin: '', ratingChoice: 0, busy: false, loading: false, stale: true, uncertain: false, error: '', now: 0 };
  constructor(api: Api,id: string,key: () => string,clock = () => performance.now()) { this.api=api; this.id=id; this.key=key; this.clock=clock; }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(v: Partial<JourneyState>) { if (this.disposed) return; this.state={...this.state,...v}; for (const fn of this.listeners) fn(); }
  private time(value: number) { this.anchor={server:value,local:this.clock()}; return value; }
  tick() { if (this.active) this.patch({ now: this.anchor.server+Math.max(0,this.clock()-this.anchor.local) }); }
  activate() { if (this.disposed) return; this.active=true; void this.refresh(); }
  pause() { this.active=false; this.generation++; this.patch({ stale:true,loading:false,pin:'' }); }
  dispose() { this.pause(); this.disposed=true; this.listeners.clear(); this.command=null; }
  edit(field: 'draft'|'amount'|'pin',value: string) { if (!this.state.busy && !this.command) this.patch({ [field]:value }); }
  chooseRating(stars: number) { if (!this.state.busy && !this.command && Number.isInteger(stars) && stars >= 1 && stars <= 5) this.patch({ ratingChoice: stars, error: '' }); }
  async rate() {
    const ride = this.state.ride;
    if (!this.active || this.command || this.state.busy || this.state.stale || !ride || ride.mode !== 'customer' || ride.status !== 'completed'
      || ride.delivery || ride.rating || !this.state.ratingChoice) return;
    this.command = { kind: 'rating', stars: this.state.ratingChoice }; await this.run();
  }
  async refresh() {
    if (!this.active || this.state.busy || this.state.loading) return;
    const generation=++this.generation; this.patch({loading:true});
    try {
      const result=await this.api.journey(this.id);
      if (!this.active || generation!==this.generation) return;
      const thread=result.ride.chatReady ? await this.api.thread(this.id,this.state.messages.at(-1)?.sequence ?? 0) : null;
      if (!this.active || generation!==this.generation) return;
      const messages=thread ? [...this.state.messages,...thread.messages.filter((m) => !this.state.messages.some((saved) => saved.id===m.id))] : [];
      this.patch({ ride:result.ride, thread, messages, stale:false, now:this.time(thread?.serverNow ?? result.serverNow), ...(this.command ? {} : { error:'' }) });
    } catch(e) { if (generation===this.generation && this.active) this.patch({stale:true,error:errorText(e)}); }
    finally { if (generation===this.generation) this.patch({loading:false}); }
  }
  async act(action: JourneyAction, shown?: Journey) {
    const ride=this.state.ride;
    if (!this.active || this.command || this.state.busy || this.state.stale || !ride || !ride.allowedActions.includes(action)) return;
    if (shown && (shown.id!==ride.id || shown.version!==ride.version)) { this.patch({error:'This journey changed. Review the latest details before confirming.'}); return; }
    const data: JourneyData={expectedVersion:ride.version};
    if (action==='propose') {
      if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(this.state.amount.trim())) { this.patch({error:'Enter a positive fare in naira, with at most two decimal places.'}); return; }
      const [whole,frac='']=this.state.amount.trim().split('.'); data.amountKobo=Number(whole)*100+Number(frac.padEnd(2,'0'));
      if (!Number.isSafeInteger(data.amountKobo) || data.amountKobo<=0) { this.patch({error:'Enter a positive fare.'}); return; }
    }
    if (action==='accept') { const now=this.anchor.server+Math.max(0,this.clock()-this.anchor.local);
      if (!ride.offer || ride.offer.fromYou || now>=ride.offer.expiresAt) { this.patch({error:'This offer is no longer available. Refresh to review the latest offer.'}); return; } data.offerId=ride.offer.id; }
    if (action==='start' || action==='complete' && ride.delivery) {
      if (!/^\d{6}$/.test(this.state.pin)) { this.patch({error:'Enter the six-digit code shared at handover.'}); return; }
      const until=action==='start' ? ride.pinBlockedUntil : ride.delivery?.pinBlockedUntil;
      if (until && this.state.now<until) { this.patch({error:'Verification is paused. Wait until the time shown before trying again.'}); return; }
      if (action==='start') data.pickupPin=this.state.pin; else data.deliveryPin=this.state.pin;
    }
    if (action==='cancel') data.reason='plans_changed';
    this.command={kind:'journey',action,data,key:this.key()}; await this.run();
  }
  async send() {
    if (!this.active || this.state.busy || this.command || this.state.stale || !this.state.thread?.canSend) return;
    const body=this.state.draft.trim();
    if (!body || body.length>2000) { this.patch({error:'Write a message of 1–2,000 characters.'}); return; }
    this.command={kind:'message',body,key:this.key()}; await this.run();
  }
  async retry() { if (this.active && this.command && !this.state.busy) await this.run(); }
  private async run() {
    const cmd=this.command; if (!cmd || this.disposed) return;
    this.generation++; this.patch({busy:true,loading:false,error:''}); let success=false;
    try {
      if (cmd.kind==='journey') {
        const result=await this.api.journeyCommand(this.id,cmd.action,cmd.data,cmd.key);
        this.patch({ride:result.ride,now:this.time(result.serverNow),pin:'',amount:cmd.action==='propose' ? '' : this.state.amount});
      } else if (cmd.kind === 'rating') {
        const result = await this.api.rateDriver(this.id,cmd.stars);
        this.patch({ ride:result.ride, now:this.time(result.serverNow) });
      } else { await this.api.sendMessage(this.id,cmd.body,cmd.key); this.patch({draft:''}); }
      this.command=null; success=true; this.patch({uncertain:false});
    } catch(e) {
      if (definiteFailure(e)) { this.command=null; this.patch({uncertain:false,stale:true,pin:'',error:errorText(e)}); }
      else this.patch({uncertain:true,stale:true,error:'Confirmation was interrupted. Retry the same action to find out whether it succeeded.'});
    } finally { this.patch({busy:false}); if (success && this.active) void this.refresh(); }
  }
  async markRead() {
    const through=this.state.messages.at(-1)?.sequence;
    if (!this.active || !through || this.state.stale || !this.state.thread || through<=this.state.thread.readThrough) return;
    const generation=this.generation;
    try { const result=await this.api.readMessages(this.id,through); if (generation===this.generation && this.state.thread) this.patch({thread:{...this.state.thread,readThrough:result.readThrough,unread:result.unread}}); }
    catch(e) { if (generation===this.generation) this.patch({error:errorText(e)}); }
  }
  async report(messageId: string,reason: string) {
    if (!this.active || this.state.busy || this.command || this.state.stale) return;
    this.patch({busy:true}); const generation=++this.generation;
    try { await this.api.reportMessage(this.id,messageId,reason);
      if (this.active && generation===this.generation && this.state.thread) this.patch({thread:{...this.state.thread,reportedMessageIds:[...this.state.thread.reportedMessageIds,messageId]}}); }
    catch(e) { if (generation===this.generation) this.patch({error:errorText(e)}); }
    finally { this.patch({busy:false}); }
  }
}
