import type { MobileClient } from '../api/client.ts';
import type { SafetyCommand, SafetyContact, SafetyKind, TripSafety } from '../../../../packages/shared/src/mobile-safety.mjs';

type Api = Pick<MobileClient, 'origin' | 'safetyContacts' | 'tripSafety' | 'safetyCommand'>;
interface Pending { command: SafetyCommand; key: string }
export interface SafetyState {
  contacts: SafetyContact[]; trip: TripSafety | null; loading: boolean; busy: boolean; stale: boolean;
  uncertain: boolean; error: string; message: string; now: number; hasLink: boolean;
  name: string; phone: string; editing: SafetyContact | null; kind: SafetyKind; note: string;
  selected: Record<string, number>; minutes: number;
}
const initial = (): SafetyState => ({ contacts: [], trip: null, loading: false, busy: false, stale: true,
  uncertain: false, error: '', message: '', now: 0, hasLink: false, name: '', phone: '', editing: null,
  kind: 'need_help', note: '', selected: {}, minutes: 15 });
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Could not connect. Please try again.';
function definiteFailure(e: unknown) {
  const v = e as { status?: number; code?: string } | null;
  return !!v && (typeof v.status === 'number' && v.status >= 400 && v.status < 500
    || ['SESSION_CHANGED', 'UNAUTHENTICATED'].includes(v.code ?? ''));
}

/** Account-scoped, in-memory commands. No timers send mutations and no secret enters persisted storage. */
export class SafetyController {
  private api: Api; readonly rideId: string | null; private key: () => string; private clock: () => number;
  private active = false; private disposed = false; private generation = 0;
  private pending: Pending | null = null;
  private secret: { token: string; shareId: string; expiresAt: number } | null = null;
  private anchor = { server: 0, local: 0 }; private state = initial(); private listeners = new Set<() => void>();
  constructor(api: Api, rideId: string | null, key: () => string, clock = () => performance.now()) {
    this.api = api; this.rideId = rideId; this.key = key; this.clock = clock;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<SafetyState>) { if (!this.disposed) { this.state = { ...this.state, ...value }; for (const fn of this.listeners) fn(); } }
  private now() { return this.anchor.server + Math.max(0, this.clock() - this.anchor.local); }
  private time(server: number) { this.anchor = { server, local: this.clock() }; return server; }
  private clearSecret() { this.secret = null; this.patch({ hasLink: false }); }
  tick() {
    if (!this.active || this.disposed) return;
    const now = this.now(); this.patch({ now });
    if (this.secret && now >= this.secret.expiresAt) this.clearSecret();
  }
  activate() { if (!this.disposed) { this.active = true; void this.refresh(); } }
  pause() {
    this.active = false; ++this.generation; this.secret = null;
    // An uncertain command keeps its original private payload only for explicit retry.
    this.patch({ contacts: [], trip: null, loading: false, stale: true, hasLink: false,
      name: '', phone: '', editing: null, note: '', selected: {}, error: '', message: '' });
  }
  dispose() { this.pause(); this.pending = null; this.state = initial(); this.disposed = true; this.listeners.clear(); }
  private editable() { return this.active && !this.disposed && !this.state.busy && !this.pending; }
  edit(field: 'name' | 'phone' | 'note', value: string) { if (this.editable()) this.patch({ [field]: value }); }
  chooseKind(kind: SafetyKind) { if (this.editable()) this.patch({ kind }); }
  chooseMinutes(minutes: number) { if (this.editable() && [15, 30, 60].includes(minutes)) this.patch({ minutes }); }
  editContact(contact: SafetyContact | null) {
    if (this.editable()) this.patch({ editing: contact ? { ...contact } : null, name: contact?.name ?? '', phone: contact?.phone ?? '' });
  }
  toggle(contact: SafetyContact) {
    if (!this.editable() || this.state.stale) return;
    const selected = { ...this.state.selected };
    if (Object.hasOwn(selected, contact.id)) delete selected[contact.id]; else selected[contact.id] = contact.version;
    this.patch({ selected });
  }
  contactCommand(): SafetyCommand {
    const { name, phone, editing } = this.state, data = { name: name.trim(), phone: phone.trim() };
    return editing ? { action: 'contact.edit', id: editing.id, data: { ...data, expectedVersion: editing.version } }
      : { action: 'contact.add', data };
  }
  reportCommand(): SafetyCommand | null {
    if (!this.rideId || !this.state.trip?.canRaise) return null;
    return { action: 'incident.create', id: this.rideId, data: { kind: this.state.kind, note: this.state.note,
      contactIds: Object.keys(this.state.selected), contactVersions: { ...this.state.selected } } };
  }
  linkCommand(): SafetyCommand | null {
    if (!this.rideId || !this.state.trip?.canRaise) return null;
    return { action: 'link.create', id: this.rideId, data: { minutes: this.state.minutes, expectedShareId: this.state.trip.share?.id ?? null } };
  }
  async refresh() {
    if (!this.active || this.disposed || this.state.loading || this.state.busy) return;
    const generation = ++this.generation; this.patch({ loading: true });
    try {
      const contacts = await this.api.safetyContacts();
      if (!this.active || generation !== this.generation || this.disposed) return;
      const trip = this.rideId ? await this.api.tripSafety(this.rideId) : null;
      if (!this.active || generation !== this.generation || this.disposed) return;
      if (trip && (trip.rideId !== this.rideId || trip.viewerId !== contacts.viewerId)) throw new Error('Safety context changed. Reopen this journey.');
      const now = this.time(trip?.serverNow ?? contacts.serverNow);
      if (this.secret && (!trip?.share?.active || trip.share.id !== this.secret.shareId || now >= this.secret.expiresAt)) this.clearSecret();
      const selected = Object.fromEntries(Object.entries(this.state.selected).filter(([id, version]) => contacts.contacts.some((c) => c.id === id && c.version === version)));
      this.patch({ contacts: contacts.contacts, trip, selected, stale: false, now, ...(this.pending ? {} : { error: '' }) });
    } catch (e) {
      if (this.active && generation === this.generation && !this.disposed) {
        this.clearSecret(); this.patch({ contacts: [], trip: null, selected: {}, stale: true, error: errorText(e) });
      }
    } finally { if (generation === this.generation) this.patch({ loading: false }); }
  }
  async submit(command: SafetyCommand | null) {
    if (!command || !this.editable() || this.state.stale) return;
    if ((command.action === 'incident.create' || command.action === 'link.create') && command.id !== this.rideId) return;
    // Capture the confirmed command, including the displayed contact versions, before I/O.
    this.pending = { command: JSON.parse(JSON.stringify(command)) as SafetyCommand, key: this.key() };
    await this.run();
  }
  async retry() { if (this.active && !this.disposed && this.pending && !this.state.busy) await this.run(); }
  private async run() {
    const pending = this.pending; if (!pending || this.disposed) return;
    const generation = ++this.generation; this.clearSecret(); this.patch({ busy: true, loading: false, error: '', message: '' });
    let success = false;
    try {
      const result = await this.api.safetyCommand(pending.command, pending.key);
      if (this.disposed || this.pending !== pending) return;
      this.pending = null; success = true; this.patch({ uncertain: false });
      if (!this.active || generation !== this.generation) return;
      if (result.token && result.share?.active && result.share.rideId === this.rideId && result.serverNow < result.share.expiresAt) {
        this.secret = { token: result.token, shareId: result.share.id, expiresAt: result.share.expiresAt }; this.patch({ hasLink: true });
      }
      const action = pending.command.action;
      const message = action === 'incident.create' ? 'Test incident saved. No alerts were sent and no emergency response was requested.'
        : action === 'link.create' ? result.token ? 'Private link created. Sharing it is a separate action.' : 'The link was saved, but its secret cannot be recovered. Review and replace it to share a new link.'
        : action === 'link.revoke' ? 'Trip link revoked on the server. Previously copied information cannot be recalled.' : 'Trusted contact change saved.';
      this.patch({ now: this.time(result.serverNow), name: '', phone: '', editing: null, note: '', selected: {}, message });
    } catch (e) {
      if (this.disposed || this.pending !== pending) return;
      if (definiteFailure(e)) { this.pending = null; this.patch({ uncertain: false, stale: true }); }
      else this.patch({ uncertain: true, stale: true });
      if (this.active && generation === this.generation) this.patch({ error: definiteFailure(e) ? errorText(e)
        : 'Confirmation was interrupted. Retry the same action to check its saved outcome. This does not send emergency help.' });
    } finally {
      this.patch({ busy: false });
      if (success && this.active && !this.disposed) void this.refresh();
    }
  }
  async shareLink(send: (url: string) => Promise<void>) {
    if (!this.editable() || this.state.stale || !this.secret || !this.rideId) return;
    const saved = this.secret, generation = ++this.generation;
    this.patch({ busy: true, loading: false, error: '' });
    try {
      const trip = await this.api.tripSafety(this.rideId);
      if (!this.active || this.disposed || generation !== this.generation || this.secret !== saved) return;
      if (trip.rideId !== this.rideId || !trip.share?.active || trip.share.id !== saved.shareId || trip.serverNow >= saved.expiresAt) {
        this.clearSecret(); this.patch({ stale: true, error: 'This link ended or changed. Refresh before sharing.' }); return;
      }
      const url = `${this.api.origin}/trip-share#${saved.token}`;
      this.clearSecret(); // Consume before handing it to the explicitly requested OS share dialog.
      this.patch({ trip, now: this.time(trip.serverNow), message: 'Share dialog requested. This does not confirm delivery or emergency response.' });
      await send(url);
    } catch {
      if (this.active && generation === this.generation && !this.disposed) {
        this.clearSecret(); this.patch({ stale: true, error: 'Could not validate or open sharing. Refresh, then explicitly replace the link to try again.' });
      }
    } finally { this.patch({ busy: false }); }
  }
}
