import { envelope, parseAccount, parseSignIn, parseActivity, parseDevices, parseApplication } from '../../../../packages/shared/src/mobile-contracts.mjs';
import type { Account, Credentials, Mode, SignIn } from '../../../../packages/shared/src/mobile-contracts.mjs';

export interface Vault { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface SavedSession { origin: string; refreshToken: string; sessionId: string; previewAccess: string }
export class ApiError extends Error {
  code: string; status: number;
  constructor(message: string, code = 'NETWORK', status = 0) { super(message); this.code = code; this.status = status; }
}
export function apiOrigin(value: string, development = false): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
    !(u.protocol === 'https:' || (development && u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) {
    throw new Error('Configure one HTTPS API origin. Local simulators may use localhost in development.');
  }
  return u.origin;
}
export function previewHeader(name: string, key: string): string {
  if (!name && !key) return '';
  if (!/^[a-z0-9_-]{3,40}$/.test(name) || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Enter the preview name and 64-character access key supplied to you.');
  return `Basic ${btoa(`${name}:${key}`)}`;
}
const changed = () => new ApiError('Your account changed. Try again.', 'SESSION_CHANGED');

/** Refresh credentials live only in the injected secure vault; access stays in memory. */
export class MobileClient {
  readonly origin: string;
  private vault: Vault;
  private fetchImpl: typeof fetch;
  private credentials: Credentials | null = null;
  private saved: SavedSession | null = null;
  private user: Account | null = null;
  private epoch = 0;
  private refreshPromise: Promise<void> | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private listeners = new Set<(user: Account | null) => void>();
  constructor({ origin, vault, fetchImpl = fetch, development = false }: { origin: string; vault: Vault; fetchImpl?: typeof fetch; development?: boolean }) {
    this.origin = apiOrigin(origin, development); this.vault = vault; this.fetchImpl = fetchImpl;
  }
  subscribe(listener: (user: Account | null) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  account() { return this.user; }
  private publish(user: Account | null) { this.user = user; for (const listener of this.listeners) listener(user); }
  private store(run: () => Promise<void>) {
    const job = this.storageQueue.catch(() => {}).then(run); this.storageQueue = job; return job;
  }
  private async forget(epoch: number) {
    if (epoch !== this.epoch) return;
    ++this.epoch; this.credentials = null; this.saved = null; this.publish(null);
    await this.store(() => this.vault.clear());
  }
  private async send(path: string, { data, token, preview = this.saved?.previewAccess ?? '', key }: { data?: unknown; token?: string; preview?: string; key?: string } = {}) {
    if (!/^\/[a-z0-9/?=&_-]+$/i.test(path)) throw new Error('Invalid mobile API path.');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetchImpl(`${this.origin}/api/mobile/v1${path}`, { method: data === undefined ? 'GET' : 'POST',
        credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(preview ? { 'X-Taxi-Ai-Preview-Access': preview } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const body = await response.json();
      if (!response.ok) throw new ApiError(body?.error?.message ?? 'Taxi Ai could not complete this request.', body?.error?.code ?? 'REQUEST_FAILED', response.status);
      return envelope(body);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Connection interrupted. Check your connection and try again.');
    } finally { clearTimeout(timeout); }
  }
  private async adopt(result: SignIn, epoch: number, preview: string) {
    if (epoch !== this.epoch) {
      await this.send('/auth/logout', { data: { refreshToken: result.credentials.refreshToken }, preview }).catch(() => {}); throw changed();
    }
    const saved: SavedSession = { origin: this.origin, refreshToken: result.credentials.refreshToken, sessionId: result.credentials.sessionId, previewAccess: preview };
    try { await this.store(async () => { if (epoch === this.epoch) await this.vault.write(JSON.stringify(saved)); }); }
    catch {
      await this.send('/auth/logout', { data: { refreshToken: saved.refreshToken }, preview }).catch(() => {});
      await this.forget(epoch).catch(() => {});
      throw new ApiError('Secure storage is unavailable. Unlock this phone and sign in again.', 'SECURE_STORAGE');
    }
    if (epoch !== this.epoch) {
      await this.send('/auth/logout', { data: { refreshToken: saved.refreshToken }, preview }).catch(() => {}); throw changed();
    }
    this.saved = saved; this.credentials = result.credentials; this.publish(result.user);
  }
  async login(email: string, password: string, deviceName: string, preview = '') {
    const epoch = ++this.epoch;
    this.credentials = null; this.saved = null; this.publish(null);
    await this.store(() => this.vault.clear());
    const result = parseSignIn(await this.send('/auth/login', { data: { email, password, deviceName }, preview }));
    await this.adopt(result, epoch, preview);
  }
  async restore() {
    const epoch = this.epoch, raw = await this.vault.read();
    if (epoch !== this.epoch) throw changed();
    if (!raw) return;
    let value;
    try { value = JSON.parse(raw); } catch { await this.store(() => this.vault.clear()); return; }
    if (value?.origin !== this.origin || !/^[a-f0-9]{64}$/.test(value?.refreshToken ?? '') || typeof value?.sessionId !== 'string'
      || typeof value?.previewAccess !== 'string') { await this.store(() => this.vault.clear()); return; }
    this.saved = value; await this.refresh();
  }
  private async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const saved = this.saved, epoch = this.epoch;
    if (!saved) throw new ApiError('Sign in again.', 'UNAUTHENTICATED', 401);
    const run = async () => {
      try {
        const result = parseSignIn(await this.send('/auth/refresh', { data: { refreshToken: saved.refreshToken }, preview: saved.previewAccess }));
        await this.adopt(result, epoch, saved.previewAccess);
      } catch (error) {
        if (epoch === this.epoch && error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
          await this.forget(epoch);
        }
        throw error;
      }
    };
    this.refreshPromise = run();
    try { await this.refreshPromise; } finally { this.refreshPromise = null; }
  }
  private async request(path: string, data?: unknown, key?: string) {
    const epoch = this.epoch;
    if (!this.credentials) await this.refresh();
    if (epoch !== this.epoch) throw changed();
    const token = this.credentials!.accessToken;
    let result;
    try { result = await this.send(path, { data, token, key }); }
    catch (error) {
      if (epoch !== this.epoch) throw changed();
      if (!(error instanceof ApiError) || error.code !== 'UNAUTHENTICATED') throw error;
      if (this.credentials?.accessToken === token) await this.refresh();
      if (epoch !== this.epoch || !this.credentials) throw changed();
      try { result = await this.send(path, { data, token: this.credentials.accessToken, key }); }
      catch (retryError) {
        if (retryError instanceof ApiError && retryError.code === 'UNAUTHENTICATED') await this.forget(epoch);
        throw retryError;
      }
    }
    if (epoch !== this.epoch) throw changed(); return result;
  }
  async session() { const epoch = this.epoch, body = await this.request('/session'); if (epoch !== this.epoch) throw changed(); const user = parseAccount(body.user); this.publish(user); return user; }
  async activity(mode: Mode, before?: string | null) { return parseActivity(await this.request(`/activity?mode=${mode}${before ? `&before=${encodeURIComponent(before)}` : ''}`)); }
  async application() { return parseApplication(await this.request('/driver/application')); }
  async devices() { return parseDevices(await this.request('/devices')); }
  async revoke(id: string) { return this.request(`/devices/${id}/revoke`, {}); }
  async addDriver(vehicle: { model: string; plate: string }, key: string) {
    const epoch = this.epoch, body = await this.request('/account/driver-profile', { vehicle }, key); if (epoch !== this.epoch) throw changed(); const user = parseAccount(body.user); this.publish(user); return user;
  }
  async logout(): Promise<string | null> {
    const saved = this.saved; ++this.epoch; this.credentials = null; this.saved = null; this.publish(null);
    let warning: string | null = null;
    // Delete local credentials even if the network is unavailable.
    try { await this.store(() => this.vault.clear()); }
    catch { warning = 'This phone could not clear secure storage. Revoke this device from your web account.'; }
    if (saved) try { await this.send('/auth/logout', { data: { refreshToken: saved.refreshToken }, preview: saved.previewAccess }); }
    catch { warning = 'Signed out here. Server confirmation failed; revoke this device from your web account.'; }
    return warning;
  }
}
