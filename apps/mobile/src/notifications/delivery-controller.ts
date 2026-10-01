import type { MobileClient } from '../api/client.ts';
import type { DeliveryUpdate, DeliveryUpdateKind, DeliveryUpdateTarget } from '../../../../packages/shared/src/delivery-updates.mjs';
type Api = Pick<MobileClient, 'account' | 'deliveryUpdate' | 'deliveryUpdates' | 'openDeliveryUpdate'>;
type Scope = { kind: DeliveryUpdateKind; targetId: string } | null;
export interface DeliveryState { update: DeliveryUpdate | null; updates: DeliveryUpdate[]; nextBefore: string | null; unread: number; loading: boolean; busy: boolean; error: string }
const empty = (): DeliveryState => ({ update: null, updates: [], nextBefore: null, unread: 0, loading: false, busy: false, error: '' });
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to refresh Kemmy’s delivery updates.';

/** Private notices and their navigation permissions expire on background, blur or account change. */
export class DeliveryUpdatesController {
  private api: Api; private scope: Scope; private accountId: string | undefined;
  private active = false; private epoch = 0; private request: AbortController | null = null;
  private state = empty(); private listeners = new Set<() => void>();
  constructor(api: Api, scope: Scope = null) { this.api = api; this.scope = scope; this.accountId = api.account()?.id; }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<DeliveryState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  private current(epoch: number) {
    if (!this.accountId || this.api.account()?.id !== this.accountId) { this.pause(); return false; }
    return this.active && this.epoch === epoch;
  }
  activate() { if (this.active || !this.accountId || this.api.account()?.id !== this.accountId) return; this.active = true; void this.refresh(); }
  pause() { this.active = false; this.epoch++; this.request?.abort(); this.request = null; this.patch(empty()); }
  async refresh(more = false) {
    if (!this.current(this.epoch) || this.state.loading || this.state.busy || more && !this.state.nextBefore) return;
    const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ loading: true, error: '' });
    try {
      if (this.scope) {
        const result = await this.api.deliveryUpdate(this.scope.kind, this.scope.targetId, signal);
        if (this.current(epoch)) this.patch({ update: result.update });
      } else {
        const result = await this.api.deliveryUpdates(more ? this.state.nextBefore : null, signal);
        if (this.current(epoch)) this.patch({ updates: more
          ? [...this.state.updates, ...result.updates.filter(item => !this.state.updates.some(old => old.id === item.id))] : result.updates,
        unread: result.unread, nextBefore: result.nextBefore });
      }
    } catch (error) { if (this.current(epoch)) this.patch({ ...empty(), error: message(error) }); }
    finally { if (this.current(epoch)) this.patch({ loading: false }); }
  }
  async open(id: string): Promise<DeliveryUpdateTarget['target'] | null> {
    if (!this.current(this.epoch) || this.state.busy) return null;
    this.request?.abort(); const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ busy: true, loading: false, error: '' });
    try {
      const result = await this.api.openDeliveryUpdate(id, signal);
      if (!this.current(epoch)) return null;
      const known = this.state.updates.find(update => update.id === id) ?? (this.state.update?.id === id ? this.state.update : null);
      if (known && (result.target.id !== known.targetId || (known.kind === 'food') !== (result.target.screen === 'food-order'))) throw new Error('The delivery target changed. Refresh your updates before opening it.');
      return result.target;
    } catch (error) { if (this.current(epoch)) this.patch({ error: message(error) }); return null; }
    finally { if (this.current(epoch)) this.patch({ busy: false }); }
  }
}
