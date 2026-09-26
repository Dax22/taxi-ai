import { readParcelInvitationResponse } from '../../../../packages/shared/src/parcels.mjs';
import type { ParcelInvitationResponse } from '../../../../packages/shared/src/parcels.mjs';
import { envelope } from '../../../../packages/shared/src/mobile-contracts.mjs';
import type { MobileClient } from '../api/client.ts';

type Invitation = ParcelInvitationResponse['invitation'];
type Api = Pick<MobileClient, 'parcels'>;
interface State { value: Invitation | null; token: string; loading: boolean; busy: boolean; uncertain: boolean; stale: boolean; error: string }
const empty = (): State => ({ value: null, token: '', loading: false, busy: false, uncertain: false, stale: true, error: '' });
export class ParcelLinkController {
  private api: Api; private key: () => string; private rideId: string; private clock: () => number;
  private state = empty(); private listeners = new Set<() => void>(); private active = false; private disposed = false;
  private epoch = 0; private request: AbortController | null = null;
  private command: { action: 'link' | 'revoke'; data: Record<string, unknown>; key: string } | null = null;
  private anchor = { server: 0, local: 0 };
  constructor(api: Api, rideId: string, key: () => string, clock = () => performance.now()) { this.api = api; this.rideId = rideId; this.key = key; this.clock = clock; }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(update: Partial<State>) { if (!this.disposed) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); } }
  activate() { if (this.disposed || this.active) return; this.active = true; void this.refresh(); }
  pause() { this.active = false; this.epoch++; this.request?.abort(); this.command = null; this.patch(empty()); }
  dispose() { this.pause(); this.disposed = true; this.listeners.clear(); }
  tick() {
    if (!this.active) return;
    const elapsed = Math.max(0, this.clock() - this.anchor.local);
    if (elapsed > 30_000) this.patch({ value: null, token: '', stale: true });
    else if (this.state.value?.link && this.anchor.server + elapsed >= this.state.value.link.expiresAt) this.patch({ token: '' });
  }
  async refresh() {
    if (!this.active || this.disposed || this.state.busy || this.state.loading) return;
    const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ loading: true });
    try {
      const response = readParcelInvitationResponse(await this.api.parcels(`/parcels/${this.rideId}/invitation`, undefined, undefined, signal), this.rideId);
      if (!this.active || epoch !== this.epoch) return;
      const previous = this.state.value?.link, next = response.invitation.link;
      this.anchor = { server: envelope(response).serverNow, local: this.clock() };
      this.patch({ value: response.invitation, stale: false, token: next?.active && !next.claimed && next.id === previous?.id && next.version === previous.version ? this.state.token : '', ...(this.command ? {} : { error: '' }) });
    } catch (e) { if (this.active && epoch === this.epoch) this.patch({ value: null, token: '', stale: true, error: e instanceof Error ? e.message : 'Could not refresh the parcel invitation.' }); }
    finally { if (epoch === this.epoch) this.patch({ loading: false }); }
  }
  async create(expectedLinkId: string | null) {
    if (!this.available() || !this.state.value?.canCreate || (this.state.value.link?.id ?? null) !== expectedLinkId) return;
    this.command = { action: 'link', data: { expectedLinkId }, key: this.key() }; await this.run();
  }
  async revoke(linkId: string, expectedVersion: number) {
    const link = this.state.value?.link;
    if (!this.available() || !link?.active || link.id !== linkId || link.version !== expectedVersion) return;
    this.command = { action: 'revoke', data: { linkId, expectedVersion }, key: this.key() }; await this.run();
  }
  private available() { return this.active && !this.disposed && !this.state.busy && !this.state.loading && !this.state.stale && !this.command; }
  async retry() { if (this.active && this.command && !this.state.busy) await this.run(); }
  private async run() {
    const command = this.command; if (!command) return;
    this.request?.abort(); const epoch = ++this.epoch, signal = (this.request = new AbortController()).signal;
    this.patch({ busy: true, loading: false, token: '', error: '' });
    try {
      const response = readParcelInvitationResponse(await this.api.parcels(`/parcels/${this.rideId}/${command.action}`, command.data, command.key, signal), this.rideId);
      if (!this.active || epoch !== this.epoch) return;
      this.anchor = { server: envelope(response).serverNow, local: this.clock() }; this.command = null;
      this.patch({ value: response.invitation, token: response.token ?? '', uncertain: false, stale: false });
    } catch (e) {
      if (!this.active || epoch !== this.epoch) return;
      const failure = e as { status?: number; code?: string };
      const definite = failure.status && failure.status >= 400 && failure.status < 500 || ['SESSION_CHANGED', 'UNAUTHENTICATED'].includes(failure.code ?? '');
      if (definite) this.command = null;
      this.patch({ value: null, token: '', stale: true, uncertain: !definite, error: definite && e instanceof Error ? e.message : 'Confirmation was interrupted. Retry the same action before creating another invitation.' });
    } finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
}
