import type { Position } from './contracts.ts';
import type { BackgroundBinding, BackgroundConnection, BackgroundGrant, BackgroundLease, BackgroundNative, BackgroundTrackingApi, BackgroundVault } from './background-contracts.ts';
import { insideNigeria } from '../../../../packages/shared/src/locations.mjs';

const MAX_LEASE = 12 * 60 * 60_000, FRESH = 30_000, SHARE_LEASE = 60_000, INTERVAL = 10_000;
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const grantFields = ['token', 'expiresAt', 'kind', 'jobId', 'shareId', 'clientId', 'sequence'];
const leaseFields = new Set([...grantFields, 'version', 'savedAt', 'serverNow', 'lastSuccessAt', 'connection']);
function connection(value: any): value is BackgroundConnection {
  if (!(value && typeof value.origin === 'string' && value.origin.length <= 512
    && Object.keys(value).every(key => key === 'origin' || key === 'previewAccess')
    && (value.previewAccess === undefined || typeof value.previewAccess === 'string' && value.previewAccess.length <= 2048))) return false;
  try {
    const url = new URL(value.origin);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
function grant(value: any): boolean {
  return value && (value.kind === 'ride' || value.kind === 'food') && uuid(value.jobId) && uuid(value.shareId) && uuid(value.clientId)
    && typeof value.token === 'string' && value.token.length >= 24 && value.token.length <= 1024
    && integer(value.expiresAt) && integer(value.sequence);
}
export function readBackgroundLease(raw: string | null): BackgroundLease | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const v = JSON.parse(raw);
    return grant(v) && Object.keys(v).every(key => leaseFields.has(key)) && (v.connection === undefined || connection(v.connection))
      && v.version === 1 && integer(v.savedAt) && integer(v.serverNow) && integer(v.lastSuccessAt)
      && v.expiresAt > v.serverNow && v.expiresAt - v.serverNow <= MAX_LEASE ? v : null;
  } catch { return null; }
}
const matches = (a: BackgroundBinding, b: BackgroundBinding) => a.kind === b.kind && a.jobId === b.jobId && a.clientId === b.clientId;

/** One scoped publisher for foreground and headless callbacks. Failed sends never queue GPS for replay. */
export class BackgroundLocationManager {
  private vault: BackgroundVault;
  private native: BackgroundNative;
  private api: BackgroundTrackingApi;
  private clock: () => number;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private known: BackgroundLease | null = null;
  private disabled = false;
  constructor(options: { vault: BackgroundVault; native: BackgroundNative; api: BackgroundTrackingApi; clock?: () => number }) {
    this.vault = options.vault; this.native = options.native; this.api = options.api; this.clock = options.clock ?? Date.now;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }
  private valid(lease: BackgroundLease, now = this.clock()) {
    const elapsed = now - lease.savedAt;
    return elapsed >= 0 && elapsed < MAX_LEASE && lease.serverNow + elapsed < lease.expiresAt
      && now >= lease.lastSuccessAt && now - lease.lastSuccessAt < SHARE_LEASE;
  }
  private async clear(lease: BackgroundLease | null) {
    this.disabled = true;
    this.known = null;
    // Erase publication authority before waiting on OS or remote cleanup.
    try { await this.vault.clear(); }
    finally {
      await this.native.stop().catch(() => {});
      if (lease) await this.api.stop(lease.token, lease.connection).catch(() => {});
    }
  }
  async current(): Promise<BackgroundLease | null> {
    return this.serial(async () => {
      if (this.disabled) return null;
      let lease: BackgroundLease | null = this.known;
      try {
        lease = readBackgroundLease(await this.vault.read());
        if (!lease || !this.valid(lease) || !await this.native.permissions()) { await this.clear(lease); return null; }
        this.known = lease;
        return { ...lease };
      } catch { await this.clear(lease).catch(() => {}); return null; }
    });
  }
  async begin(result: { background: BackgroundGrant; serverNow: number; connection?: BackgroundConnection }, isCurrent: () => boolean = () => true) {
    const epoch = this.generation;
    return this.serial(async () => {
      const value = result.background, now = this.clock();
      if (!grant(value) || !integer(result.serverNow) || value.expiresAt <= result.serverNow || value.expiresAt - result.serverNow > MAX_LEASE)
        throw new Error('Background location authorization was invalid. Start sharing again.');
      if (result.connection && !connection(result.connection)) throw new Error('Background connection was invalid.');
      const lease: BackgroundLease = { token: value.token, expiresAt: value.expiresAt, kind: value.kind, jobId: value.jobId,
        shareId: value.shareId, clientId: value.clientId, sequence: value.sequence,
        version: 1, savedAt: now, serverNow: result.serverNow, lastSuccessAt: now,
        ...(result.connection ? { connection: { origin: result.connection.origin,
          ...(result.connection.previewAccess === undefined ? {} : { previewAccess: result.connection.previewAccess }) } } : {}) };
      const current = () => epoch === this.generation && isCurrent();
      if (!current()) { await this.api.stop(value.token, lease.connection).catch(() => {}); return; }
      try {
        const previous = readBackgroundLease(await this.vault.read());
        if (previous && previous.token !== lease.token) await this.clear(previous);
        if (!current()) { await this.api.stop(value.token, lease.connection).catch(() => {}); return; }
        if (!await this.native.permissions()) throw new Error('Allow background location to share during active work.');
        if (!current()) { await this.api.stop(value.token, lease.connection).catch(() => {}); return; }
        await this.vault.write(JSON.stringify(lease));
        if (!current()) { await this.clear(lease); return; }
        if (!this.valid(lease)) throw new Error('Background sharing authorization expired. Start sharing again.');
        this.known = lease;
        this.disabled = false;
        await this.native.start();
        if (!current() || !this.valid(lease)) await this.clear(lease);
      } catch (error) { await this.clear(lease); throw error; }
    });
  }
  /** Invalidates in-flight callbacks synchronously, including callbacks waiting on a network response. */
  stop(expected?: BackgroundBinding): Promise<void> {
    if (expected && this.known && !matches(expected, this.known)) return Promise.resolve();
    if (expected && !this.known) return this.serial(async () => {
      let lease: BackgroundLease | null = null;
      try { lease = readBackgroundLease(await this.vault.read()); }
      catch {
        // Ownership cannot be recovered from unreadable storage. Erase authority rather than leave a headless task running.
        this.generation++;
        await this.clear(null);
        return;
      }
      if (!lease || !matches(expected, lease)) return;
      this.generation++;
      await this.clear(lease);
    });
    this.generation++;
    this.disabled = true;
    const known = this.known;
    void this.native.stop().catch(() => {});
    return this.serial(async () => {
      let lease: BackgroundLease | null = known;
      try { lease = readBackgroundLease(await this.vault.read()) ?? known; } catch { /* Known capability still permits revocation if storage reads fail. */ }
      if (expected && lease && !matches(expected, lease)) return;
      await this.clear(lease);
    });
  }
  handle(positions: Position[]): Promise<void> {
    const epoch = this.generation;
    return this.serial(async () => {
      if (epoch !== this.generation || this.disabled) return;
      let lease: BackgroundLease | null = this.known;
      try {
        lease = readBackgroundLease(await this.vault.read());
        if (!lease || !this.valid(lease) || !await this.native.permissions()) { await this.clear(lease); return; }
        if (epoch !== this.generation) return;
        this.known = lease;
        const now = this.clock(), elapsed = now - lease.savedAt;
        const fix = positions.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && insideNigeria(p)
          && Number.isFinite(p.accuracy) && p.accuracy > 0 && p.accuracy <= 200 && integer(p.capturedAt)
          && now - p.capturedAt >= -5000 && now - p.capturedAt < FRESH).sort((a, b) => b.capturedAt - a.capturedAt)[0];
        if (!fix || now - lease.lastSuccessAt < INTERVAL) return;
        const result = await this.api.position(lease.token, lease.sequence + 1,
          { ...fix, capturedAt: Math.round(lease.serverNow + elapsed - Math.max(0, now - fix.capturedAt)) }, lease.connection);
        if (epoch !== this.generation) return;
        if (result.share.id !== lease.shareId || result.share.rideId !== lease.jobId || !result.share.active
          || !result.share.owned || result.share.sequence !== lease.sequence + 1 || !integer(result.serverNow)) {
          await this.clear(lease); return;
        }
        const accepted: BackgroundLease = { ...lease, sequence: result.share.sequence, lastSuccessAt: this.clock() };
        await this.vault.write(JSON.stringify(accepted));
        if (epoch !== this.generation) { await this.clear(accepted); return; }
        this.known = accepted;
      } catch { await this.clear(lease).catch(() => {}); }
    });
  }
}
