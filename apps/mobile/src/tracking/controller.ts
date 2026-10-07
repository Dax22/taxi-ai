import type { MobileClient } from '../api/client.ts';
import type { Position } from '../../../../packages/shared/src/mobile-journeys.mjs';
import type { LocationShare, Tracking } from './contracts.ts';
import { definiteFailure } from '../journeys/controller.ts';
import type { ControllerBackground, TrackingKind } from './background-contracts.ts';

type Api = Pick<MobileClient, 'tracking' | 'startTracking' | 'stopTracking' | 'trackingPosition'>;
type Command = { kind: 'start'; key: string } | { kind: 'stop'; shareId: string; key: string };
type Locate = (ask: boolean, isCurrent?: () => boolean) => Promise<Position>;
export interface TripLocationState {
  data: Tracking | null; busy: boolean; loading: boolean; stale: boolean;
  uncertain: boolean; error: string; sharing: boolean; background: boolean; now: number;
}
const FRESH_MS = 30_000, LEASE_MS = 60_000;
const message = (e: unknown) => e instanceof Error ? e.message : 'Location sharing could not connect. Try again.';

/** Sharing requires explicit local consent; a server lease alone can never start collection. */
export class TripLocationController {
  readonly id: string;
  readonly clientId: string;
  readonly kind: TrackingKind;
  private api: Api;
  private key: () => string;
  private locate: Locate;
  private clock: () => number;
  private wallClock: () => number;
  private background?: ControllerBackground;
  private preparing = false;
  private active = false;
  private disposed = false;
  private intent = false;
  private generation = 0;
  private running = false;
  private readRunning = false;
  private pending: Command | null = null;
  private lease: LocationShare | null = null;
  private cleanupWanted = false;
  private stopAny = false;
  private anchor = { server: 0, local: 0 };
  private contactedAt = 0;
  private listeners = new Set<() => void>();
  private state: TripLocationState = { data: null, busy: false, loading: false, stale: true,
    uncertain: false, error: '', sharing: false, background: false, now: 0 };

  constructor(api: Api, id: string, key: () => string, locate: Locate,
    clock = () => performance.now(), wallClock = () => Date.now(),
    options: { kind?: TrackingKind; background?: ControllerBackground; clientId?: string } = {}) {
    this.api = api; this.id = id; this.key = key; this.clientId = key();
    this.clientId = options.clientId ?? this.clientId; this.kind = options.kind ?? 'ride'; this.background = options.background;
    this.locate = locate; this.clock = clock; this.wallClock = wallClock;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<TripLocationState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  private time(value: number) {
    this.contactedAt = this.clock();
    this.anchor = { server: value, local: this.contactedAt };
    return value;
  }
  private now() { return this.anchor.server + Math.max(0, this.clock() - this.anchor.local); }
  private current(generation: number) {
    return (this.active || this.preparing || this.state.background) && !this.disposed && this.intent && generation === this.generation;
  }
  private show(share: LocationShare, serverNow: number) {
    if (!this.active || this.disposed || !this.state.data) return;
    this.patch({ data: { ...this.state.data, share, serverNow }, now: this.time(serverNow), stale: false });
  }
  activate() {
    if (this.disposed) return;
    this.active = true;
    void this.refresh();
  }
  pause() {
    this.active = false;
    this.halt();
    this.patch({ stale: true, loading: false });
    void this.cleanup();
  }
  /** An OS permission sheet or an explicitly enabled background task may outlive visible UI. */
  suspend() {
    if (!this.preparing && !this.state.background) { this.pause(); return; }
    this.active = false;
    this.patch({ stale: true, loading: false });
  }
  dispose() {
    this.pause();
    this.disposed = true;
    this.state = { ...this.state, data: null, busy: false, loading: false, sharing: false, background: false, error: '', uncertain: false };
    this.listeners.clear();
  }
  private halt() {
    this.intent = false;
    this.preparing = false;
    this.generation++;
    this.cleanupWanted = true;
    void this.background?.stop().catch(() => {});
    this.patch({ sharing: false, background: false });
  }
  tick() {
    if (!this.active || this.disposed || !this.state.data) return;
    const now = this.now(), share = this.state.data.share;
    const expired = Boolean(share?.active && now >= (share.updatedAt ?? share.startedAt) + LEASE_MS);
    const stale = !share?.position || now >= share.position.capturedAt + FRESH_MS;
    this.patch({ now, stale: this.state.stale || this.clock() - this.contactedAt >= FRESH_MS,
      ...(share ? { data: { ...this.state.data, share: { ...share, stale: share.stale || stale, active: share.active && !expired } } } : {}) });
    if (expired && this.intent && !this.state.background) { this.halt(); void this.cleanup(); }
  }
  async refresh() {
    if (!this.active || this.disposed || this.running || this.readRunning) return;
    const generation = this.generation;
    this.readRunning = true;
    this.patch({ loading: true });
    try {
      const data = await this.api.tracking(this.id, this.clientId);
      if (!this.active || this.disposed || generation !== this.generation) return;
      if (data.rideId !== this.id || data.share && data.share.rideId !== this.id) throw new Error('Location belongs to a different journey.');
      const lost = this.intent && (!data.canShare || !data.share?.active || !data.share.owned || data.share.id !== this.lease?.id);
      this.lease = data.share;
      this.patch({ data, stale: false, now: this.time(data.serverNow), ...(this.pending || this.state.error ? {} : { error: '' }) });
      if (lost) {
        this.halt();
        this.patch({ error: 'Trip location sharing ended. Start again only if this journey is still eligible.' });
      }
      if (!this.intent && data.share?.active && data.share.owned) this.cleanupWanted = true;
    } catch (e) {
      if (this.active && !this.disposed && generation === this.generation) this.patch({ stale: true, error: message(e) });
    } finally {
      this.readRunning = false;
      if (this.active && !this.disposed) this.patch({ loading: false });
      await this.cleanup();
    }
  }
  async start() {
    if (!this.active || this.disposed || this.running || this.readRunning || this.pending || this.state.stale ||
      !this.state.data?.canShare || this.state.data.share?.active) return;
    const generation = ++this.generation;
    this.intent = true;
    this.preparing = Boolean(this.background);
    this.cleanupWanted = false;
    this.stopAny = false;
    this.running = true;
    this.patch({ busy: true, error: '' });
    let fix: Position | undefined;
    try {
      if (this.background) await this.background.prepare(() => this.current(generation));
      if (!this.current(generation)) return;
      fix = await this.locate(true, () => this.current(generation));
      if (!this.current(generation)) return;
      this.pending = { kind: 'start', key: this.key() };
    } catch (e) {
      if (this.current(generation)) { this.halt(); this.patch({ error: message(e) }); }
    } finally {
      this.running = false;
      this.patch({ busy: false });
    }
    if (this.pending?.kind === 'start' && this.current(generation)) await this.run(fix, generation);
    else await this.cleanup();
    this.preparing = false;
  }
  async stop() {
    if (this.disposed) return;
    this.halt();
    this.stopAny = true;
    await this.cleanup();
  }
  /** Reconcile the exact interrupted command; an uncertain start never silently resumes GPS. */
  async retry() {
    if (!this.active || this.disposed || this.running || this.readRunning || !this.pending) return;
    this.halt();
    await this.run();
  }
  private async cleanup() {
    if (!this.cleanupWanted || this.running || this.readRunning || this.pending) return;
    const lease = this.lease;
    this.cleanupWanted = false;
    if (!lease?.active || !lease.owned && !this.stopAny) return;
    this.pending = { kind: 'stop', shareId: lease.id, key: this.key() };
    this.stopAny = false;
    await this.run();
  }
  private normalized(fix: Position) {
    const age = this.wallClock() - fix.capturedAt;
    if (!Number.isFinite(age) || age < -5000 || age >= FRESH_MS) throw new Error('This location is too old. Start sharing again for a fresh fix.');
    return { ...fix, capturedAt: Math.round(this.now() - Math.max(0, age)) };
  }
  private async publish(fix: Position, generation: number) {
    const lease = this.lease;
    if (!this.current(generation) || !lease?.active || !lease.owned) return;
    try {
      const result = await this.api.trackingPosition(lease.id, this.clientId, lease.sequence + 1, this.normalized(fix));
      if (result.share.id !== lease.id || result.share.rideId !== this.id) throw new Error('Location confirmation belongs to a different journey.');
      this.lease = result.share;
      if (!this.current(generation)) { this.cleanupWanted = true; return; }
      this.show(result.share, result.serverNow);
      if (!result.share.active || !result.share.owned) {
        this.halt();
        this.patch({ error: 'Trip location sharing ended. Review this journey before starting again.' });
      } else this.patch({ sharing: true, uncertain: false, error: '' });
    } catch (e) {
      if (this.current(generation)) {
        this.halt();
        this.patch({ stale: true, error: `${message(e)} Location collection has stopped.` });
      } else this.cleanupWanted = true;
    }
  }
  private async run(fix?: Position, generation = this.generation) {
    const command = this.pending;
    if (!command || this.running || this.readRunning) return;
    this.running = true;
    this.patch({ busy: true, error: command.kind === 'start' ? '' : this.state.error });
    try {
      const result = command.kind === 'start'
        ? await this.api.startTracking(this.id, this.clientId, command.key)
        : await this.api.stopTracking(command.shareId, this.clientId, command.key);
      if (result.share.rideId !== this.id || command.kind === 'stop' && result.share.id !== command.shareId) throw new Error('Location confirmation belongs to a different journey.');
      this.pending = null;
      this.lease = result.share;
      this.patch({ uncertain: false });
      if (this.active && !this.disposed && generation === this.generation) this.show(result.share, result.serverNow);
      if (command.kind === 'start') {
        if (fix && this.current(generation) && result.share.active && result.share.owned) {
          await this.publish(fix, generation);
          if (this.background && this.current(generation) && this.state.sharing && this.lease) {
            await this.background.start(this.lease, this.now(), () => this.current(generation));
            if (this.current(generation)) this.patch({ background: true });
            else await this.background.stop();
          }
        }
        else {
          this.intent = false;
          this.cleanupWanted = true;
          this.patch({ sharing: false });
        }
      }
    } catch (e) {
      const definite = definiteFailure(e);
      if (definite) this.pending = null;
      this.intent = false;
      this.preparing = false;
      void this.background?.stop().catch(() => {});
      this.cleanupWanted = command.kind === 'start';
      const uncertain = this.pending !== null && !definite;
      this.patch({ sharing: false, background: false, stale: true, uncertain,
        error: uncertain ? 'Location confirmation was interrupted. Collection has stopped. Retry to resolve the same action.' : message(e) });
    } finally {
      this.running = false;
      this.patch({ busy: false });
      await this.cleanup();
    }
  }
  async heartbeat() {
    if (this.state.background && this.active && this.background && !this.disposed) {
      const generation = this.generation;
      try {
        const active = await this.background.active();
        if (!this.current(generation)) return;
        if (!active) { this.halt(); this.patch({ error: 'Work location sharing ended. Review permissions and start again.' }); await this.cleanup(); }
        else {
          const recovering = await this.background.recovering?.();
          if (!this.current(generation)) return;
          this.patch({ error: recovering ? 'Connection interrupted. Retrying with fresh GPS while your sharing permission remains valid.' : '' });
          await this.refresh();
        }
      } catch { if (this.current(generation)) { this.halt(); await this.cleanup(); } }
      return;
    }
    const lease = this.lease;
    if (!this.active || this.disposed || !this.intent || !lease?.active || !lease.owned ||
      this.running || this.readRunning || this.pending) return;
    this.tick();
    if (!this.intent || this.running || this.pending) return;
    const generation = this.generation;
    this.running = true;
    this.patch({ busy: true });
    try {
      const fix = await this.locate(false, () => this.current(generation));
      if (this.current(generation)) await this.publish(fix, generation);
    } catch (e) {
      if (this.current(generation)) {
        this.halt();
        this.patch({ stale: true, error: `${message(e)} Location collection has stopped.` });
      }
    } finally {
      this.running = false;
      this.patch({ busy: false });
      await this.cleanup();
    }
  }
}
