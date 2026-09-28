import type { MobileClient } from '../api/client.ts';
import type { FamilyAction, FamilyResponse, FamilyTripResponse } from '../../../../packages/shared/src/family.mjs';
import { definiteFailure } from '../journeys/controller.ts';

type Api = Pick<MobileClient, 'familyDashboard' | 'familyTrip' | 'familyCommand'>;
type Command = { action: FamilyAction; data: Record<string, unknown>; key: string };
export interface FamilyState {
  family: FamilyResponse['family'] | null;
  trip: FamilyTripResponse['trip'] | null;
  selectedId: string | null;
  busy: boolean; loading: boolean; stale: boolean; uncertain: boolean;
  error: string; notice: string; now: number;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not connect. Try again.';

/** Private views stay in memory. Permission refresh failures and backgrounding remove them. */
export class FamilyController {
  private active = false;
  private disposed = false;
  private generation = 0;
  private pending: Command | null = null;
  private read: AbortController | null = null;
  private write: AbortController | null = null;
  private anchor = { server: 0, local: 0 };
  private listeners = new Set<() => void>();
  private state: FamilyState = { family: null, trip: null, selectedId: null, busy: false, loading: false,
    stale: true, uncertain: false, error: '', notice: '', now: 0 };
  private api: Api; private key: () => string; private clock: () => number;
  constructor(api: Api, key: () => string, clock = () => performance.now()) {
    this.api = api; this.key = key; this.clock = clock;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<FamilyState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  activate() { if (this.disposed || this.active) return; this.active = true; void this.refresh(); }
  pause() {
    this.active = false; this.generation++; this.read?.abort(); this.write?.abort();
    this.patch({ family: null, trip: null, loading: false, stale: true, notice: '', uncertain: Boolean(this.pending) });
  }
  dispose() {
    this.pause(); this.pending = null; this.state = { ...this.state, selectedId: null, busy: false, uncertain: false, error: '' };
    this.disposed = true; this.listeners.clear();
  }
  tick() {
    if (!this.active) return;
    const elapsed = Math.max(0, this.clock() - this.anchor.local);
    // Stop displaying an old permission-bearing view if updates have stopped arriving.
    this.patch({ now: this.anchor.server + elapsed, ...(elapsed > 60_000 && this.state.family ? {
      family: null, trip: null, stale: true, error: 'Updates are unavailable. Refresh to check sharing access again.',
    } : {}) });
  }
  selectTrip(id: string | null) {
    if (!this.active || this.state.busy) return;
    this.generation++; this.read?.abort();
    this.patch({ selectedId: id, trip: null, loading: false });
    void this.refresh();
  }
  async refresh(clearError = true) {
    if (!this.active || this.disposed || this.state.busy || this.state.loading) return;
    const generation = ++this.generation, signal = (this.read = new AbortController()).signal;
    this.patch({ loading: true });
    try {
      const response = await this.api.familyDashboard(signal);
      if (!this.active || this.disposed || generation !== this.generation) return;
      const selectedId = response.family.trips.some(trip => trip.shareId === this.state.selectedId) ? this.state.selectedId : null;
      const detail = selectedId ? await this.api.familyTrip(selectedId, signal) : null;
      if (!this.active || this.disposed || generation !== this.generation) return;
      if (detail && detail.trip.shareId !== selectedId) throw new Error('These details belong to a different shared trip.');
      const serverNow = detail?.serverNow ?? response.serverNow;
      this.anchor = { server: serverNow, local: this.clock() };
      this.patch({ family: response.family, trip: detail?.trip ?? null, selectedId, now: serverNow, stale: false,
        ...(clearError && !this.pending ? { error: '' } : {}) });
    } catch (error) {
      if (this.active && generation === this.generation) this.patch({ family: null, trip: null, stale: true, error: message(error) });
    } finally { if (generation === this.generation) this.patch({ loading: false }); }
  }
  async command(action: FamilyAction, data: Record<string, unknown>) {
    if (!this.active || this.disposed || this.pending || this.state.busy || this.state.stale) return false;
    this.generation++; this.read?.abort(); this.patch({ loading: false });
    this.pending = { action, data: structuredClone(data), key: this.key() };
    return this.run();
  }
  async retry() { return this.active && !this.state.busy && this.pending ? this.run() : false; }
  private async run() {
    const command = this.pending;
    if (!command) return false;
    const generation = this.generation, signal = (this.write = new AbortController()).signal;
    this.patch({ busy: true, error: '', notice: '' });
    let success = false;
    try {
      await this.api.familyCommand(command.action, command.data, command.key, signal);
      if (this.disposed) return false;
      this.pending = null; success = true;
      this.patch({ uncertain: false, ...(this.active && generation === this.generation ? {
        notice: command.action === 'respond' && command.data.response === 'help'
          ? 'Help request saved in the Family Safety inbox of approved contacts viewing this trip. Emergency services have not been contacted.'
          : 'Saved. Review the updated Family Safety details below.',
      } : {}) });
    } catch (error) {
      if (this.disposed) return false;
      const definite = definiteFailure(error);
      if (definite) this.pending = null;
      this.patch({ uncertain: !definite, family: null, trip: null, stale: true,
        ...(this.active ? { error: message(error) } : {}) });
    } finally { if (!this.disposed) this.patch({ busy: false }); }
    if (this.active && !this.disposed) await this.refresh(false);
    return success;
  }
}
