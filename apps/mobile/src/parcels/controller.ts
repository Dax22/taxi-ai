import { readParcelResponse, readReceivedParcelsResponse } from '../../../../packages/shared/src/parcels.mjs';
import type { ParcelSnapshot } from '../../../../packages/shared/src/parcels.mjs';
import { envelope } from '../../../../packages/shared/src/mobile-contracts.mjs';
import type { MobileClient } from '../api/client.ts';
import { parcelInvitationToken } from './invitation.ts';

type Api = Pick<MobileClient, 'parcels' | 'origin'>;
export interface ParcelState {
  parcels: ParcelSnapshot[]; selected: ParcelSnapshot | null; selectedId: string | null; invitation: string;
  loading: boolean; busy: boolean; uncertain: boolean; stale: boolean; now: number; error: string; notice: string;
}
const empty = (): ParcelState => ({ parcels: [], selected: null, selectedId: null, invitation: '', loading: false,
  busy: false, uncertain: false, stale: true, now: 0, error: '', notice: '' });
const message = (e: unknown) => e instanceof Error ? e.message : 'Unable to load your parcels.';

/** Permission-bearing tracking snapshots are memory-only and erased when the screen becomes inactive. */
export class ParcelsController {
  private api: Api; private key: () => string; private clock: () => number;
  private state = empty(); private listeners = new Set<() => void>();
  private active = false; private disposed = false; private epoch = 0; private request: AbortController | null = null;
  private command: { token: string; key: string } | null = null;
  private anchor = { server: 0, local: 0 };
  constructor(api: Api, key: () => string, clock = () => performance.now()) { this.api = api; this.key = key; this.clock = clock; }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(update: Partial<ParcelState>) { if (!this.disposed) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); } }
  activate() { if (this.disposed || this.active) return; this.active = true; void this.refresh(); }
  pause() { this.active = false; this.epoch++; this.request?.abort(); this.command = null; this.patch(empty()); }
  dispose() { this.pause(); this.disposed = true; this.listeners.clear(); }
  tick() {
    if (!this.active) return;
    const elapsed = Math.max(0, this.clock() - this.anchor.local), now = this.anchor.server + elapsed;
    this.patch({ now, ...(elapsed > 30_000 ? { parcels: [], selected: null, stale: true } : {}) });
  }
  editInvitation(invitation: string) { if (this.active && !this.command && !this.state.busy) this.patch({ invitation: invitation.slice(0, 2048), error: '', notice: '' }); }
  select(id: string) {
    if (!this.active || this.state.busy || this.command) return;
    this.epoch++; this.request?.abort(); this.patch({ selectedId: id, selected: null, loading: false }); void this.refresh();
  }
  async refresh() {
    if (!this.active || this.disposed || this.state.busy || this.state.loading) return;
    const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ loading: true });
    try {
      const list = readReceivedParcelsResponse(await this.api.parcels('/parcels/received', undefined, undefined, signal));
      if (!this.active || epoch !== this.epoch) return;
      const id = list.parcels.some(p => p.rideId === this.state.selectedId) ? this.state.selectedId : null;
      const detail = id ? readParcelResponse(await this.api.parcels(`/parcels/received/${id}`, undefined, undefined, signal), id) : null;
      if (!this.active || epoch !== this.epoch) return;
      const now = envelope(detail ?? list).serverNow;
      this.anchor = { server: now, local: this.clock() };
      this.patch({ parcels: list.parcels, selectedId: id, selected: detail?.parcel ?? null, stale: false, now, ...(this.command ? {} : { error: '' }) });
    } catch (e) { if (this.active && epoch === this.epoch) this.patch({ parcels: [], selected: null, stale: true, error: message(e) }); }
    finally { if (epoch === this.epoch) this.patch({ loading: false }); }
  }
  async accept() {
    if (!this.active || this.disposed || this.state.busy || this.command) return;
    try { this.command = { token: parcelInvitationToken(this.state.invitation, this.api.origin), key: this.key() }; }
    catch (e) { this.patch({ error: message(e) }); return; }
    await this.run();
  }
  async retry() { if (this.active && this.command && !this.state.busy) await this.run(); }
  private async run() {
    const command = this.command; if (!command) return;
    this.request?.abort(); const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ busy: true, loading: false, error: '', notice: '', selected: null });
    try {
      const response = readParcelResponse(await this.api.parcels('/parcels/accept', { token: command.token }, command.key, signal));
      if (!this.active || epoch !== this.epoch) return;
      const now = envelope(response).serverNow;
      this.command = null; this.anchor = { server: now, local: this.clock() };
      this.patch({ selected: response.parcel, selectedId: response.parcel.rideId, invitation: '', uncertain: false, stale: false,
        parcels: [response.parcel, ...this.state.parcels.filter(p => p.rideId !== response.parcel.rideId)], now,
        notice: 'This parcel is now linked to your account.' });
    } catch (e) {
      if (!this.active || epoch !== this.epoch) return;
      const failure = e as { status?: number; code?: string };
      const definite = failure.status && failure.status >= 400 && failure.status < 500 || ['SESSION_CHANGED', 'UNAUTHENTICATED'].includes(failure.code ?? '');
      if (definite) this.command = null;
      this.patch({ selected: null, parcels: [], stale: true, uncertain: !definite, error: definite ? message(e) : 'Confirmation was interrupted. Retry the same invitation or refresh to check your parcels.' });
    } finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
}
