import { isRequestOpen } from '../../../../packages/shared/src/mobile-booking.mjs';
import type { Booking, BookingPreview, BookingRide, BookingRideResult, Place, RequestData } from '../../../../packages/shared/src/mobile-booking.mjs';
import type { MobileClient } from '../api/client.ts';

type Api = Pick<MobileClient, 'booking' | 'bookingRide' | 'searchPlaces' | 'routePreview' | 'samplePreview' | 'requestRide' | 'cancelRide'>;
type Endpoint = 'pickup' | 'destination';
interface Search { query: string; selected: Place | null; results: Place[]; searching: boolean; searched: boolean; attribution: string }
type Command = { kind: 'request'; key: string; data: RequestData } | { kind: 'cancel'; key: string; id: string; version: number };
export interface BookingState {
  settings: Booking | null; mode: 'route' | 'sample' | null; consent: boolean; pickup: Search; destination: Search;
  pickupId: string; destinationId: string; preview: BookingPreview | null; lastRide: BookingRide | null;
  loading: boolean; busy: 'preview' | 'request' | 'cancel' | null; uncertain: 'request' | 'cancel' | null;
  error: string; stale: boolean; now: number;
}
const emptySearch = (): Search => ({ query: '', selected: null, results: [], searching: false, searched: false, attribution: '' });
const message = (e: unknown) => e instanceof Error ? e.message : 'Unable to connect. Try again.';
const code = (e: unknown): { code?: string; status?: number } => typeof e === 'object' && e !== null ? e : {};

/** Ephemeral workflow. Commands retain their exact key/payload until the server gives a definite answer. */
export class BookingController {
  private api: Api;
  private key: () => string;
  private clock: () => number;
  private listeners = new Set<() => void>();
  private active = false;
  private disposed = false;
  private reads = 0;
  private searches = { pickup: 0, destination: 0 };
  private command: Command | null = null;
  private anchor = { server: 0, local: 0 };
  private state: BookingState = { settings: null, mode: null, consent: false, pickup: emptySearch(), destination: emptySearch(),
    pickupId: '', destinationId: '', preview: null, lastRide: null, loading: false, busy: null, uncertain: null, error: '', stale: true, now: 0 };
  constructor(api: Api, key: () => string, clock: () => number = () => performance.now()) { this.api = api; this.key = key; this.clock = clock; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<BookingState>) { if (this.disposed) return; this.state = { ...this.state, ...value }; for (const fn of this.listeners) fn(); }
  private serverTime(value: number) { this.anchor = { server: value, local: this.clock() }; return value; }
  private now() { return this.anchor.server + Math.max(0, this.clock() - this.anchor.local); }
  tick() { if (this.active && this.state.settings) this.patch({ now: this.now() }); }
  activate() { if (this.disposed) return; this.active = true; void this.refresh(); }
  pause() {
    this.active = false; ++this.reads; ++this.searches.pickup; ++this.searches.destination;
    this.patch({ stale: true, loading: false, pickup: { ...this.state.pickup, searching: false }, destination: { ...this.state.destination, searching: false } });
  }
  dispose() { this.pause(); this.disposed = true; this.listeners.clear(); }
  async refresh() {
    if (!this.active || this.disposed || this.state.busy || this.state.loading) return;
    const read = ++this.reads; this.patch({ loading: true });
    try {
      const settings = await this.api.booking();
      if (!this.active || read !== this.reads) return;
      let lastRide = this.state.lastRide ?? settings.current[0] ?? null;
      if (lastRide) {
        const current = settings.current.find((r) => r.id === lastRide!.id);
        if (current) lastRide = current;
        else if (isRequestOpen(lastRide.status)) lastRide = (await this.api.bookingRide(lastRide.id)).ride;
      }
      if (!this.active || read !== this.reads) return;
      const mode = this.state.mode === 'route' && settings.online.enabled ? 'route'
        : this.state.mode === 'sample' && settings.allowSample ? 'sample' : settings.online.enabled ? 'route' : settings.allowSample ? 'sample' : null;
      this.patch({ settings, lastRide, mode, stale: false, now: this.serverTime(settings.serverNow), error: this.command ? this.state.error : '',
        ...(settings.current.length || settings.blockedBy || mode !== this.state.mode ? { preview: null } : {}) });
    } catch (e) { if (this.active && read === this.reads) this.patch({ stale: true, error: `Could not refresh your request. ${message(e)}` }); }
    finally { if (read === this.reads) this.patch({ loading: false }); }
  }
  private locked() { return !!this.state.busy || !!this.command; }
  private canPlan() { return this.active && !!this.state.settings && !this.state.stale && !this.state.settings.current.length && !this.state.settings.blockedBy; }
  chooseMode(mode: 'route' | 'sample') {
    if (this.locked() || (mode === 'route' ? !this.state.settings?.online.enabled : !this.state.settings?.allowSample)) return;
    ++this.searches.pickup; ++this.searches.destination;
    this.patch({ mode, preview: null, error: '', pickup: emptySearch(), destination: emptySearch() });
  }
  consent() { this.patch({ consent: true }); }
  edit(endpoint: Endpoint, query: string) {
    if (this.locked()) return;
    ++this.searches[endpoint]; this.patch({ [endpoint]: { ...emptySearch(), query }, preview: null, error: '' });
  }
  select(endpoint: Endpoint, place: Place) {
    if (this.locked()) return;
    ++this.searches[endpoint]; this.patch({ [endpoint]: { ...emptySearch(), query: place.name, selected: place }, preview: null, error: '' });
  }
  sample(endpoint: Endpoint, id: string) {
    if (this.locked()) return;
    this.patch({ [endpoint === 'pickup' ? 'pickupId' : 'destinationId']: id, preview: null, error: '' });
  }
  async search(endpoint: Endpoint) {
    if (!this.canPlan() || this.locked() || this.state.mode !== 'route' || !this.state.consent) return;
    const query = this.state[endpoint].query.trim();
    if (query.length < 3 || query.length > 160) { this.patch({ error: 'Enter an Abuja address or landmark, between 3 and 160 characters.' }); return; }
    const read = ++this.searches[endpoint]; this.patch({ [endpoint]: { ...this.state[endpoint], results: [], searching: true }, error: '' });
    try {
      const result = await this.api.searchPlaces(query);
      if (this.active && read === this.searches[endpoint]) this.patch({ [endpoint]: { ...this.state[endpoint], results: result.places, searching: false, searched: true, attribution: result.attribution } });
    } catch (e) { if (this.active && read === this.searches[endpoint]) this.patch({ error: message(e), [endpoint]: { ...this.state[endpoint], searching: false } }); }
  }
  async preview() {
    if (!this.canPlan() || this.locked()) return;
    const { mode, consent, pickup, destination, pickupId, destinationId } = this.state;
    if (mode === 'route' && (!consent || !pickup.selected || !destination.selected)) { this.patch({ error: 'Search and select both addresses before previewing the route.' }); return; }
    if (mode === 'sample' && (!pickupId || !destinationId || pickupId === destinationId)) { this.patch({ error: 'Choose two different sample areas.' }); return; }
    if (!mode) return;
    ++this.reads; this.patch({ busy: 'preview', loading: false, error: '', preview: null });
    try {
      const result = mode === 'route' ? await this.api.routePreview(pickup.selected!, destination.selected!, this.key()) : await this.api.samplePreview(pickupId, destinationId);
      this.patch({ preview: result.preview, now: this.serverTime(result.serverNow) });
    } catch (e) { this.patch({ error: message(e) }); }
    finally { this.patch({ busy: null }); if (this.state.stale && this.active) void this.refresh(); }
  }
  async submit() {
    if (!this.canPlan() || this.locked() || !this.state.preview) return;
    const preview = this.state.preview;
    if (preview.expiresAt !== null && this.now() >= preview.expiresAt) { this.patch({ error: 'This route preview has expired. Preview the route again.', preview: null }); return; }
    this.command = { kind: 'request', key: this.key(), data: { ...preview.request } }; await this.runCommand();
  }
  async cancel(ride: BookingRide) {
    if (!this.active || this.locked() || this.state.stale || !ride.canCancel) return;
    this.command = { kind: 'cancel', key: this.key(), id: ride.id, version: ride.version }; await this.runCommand();
  }
  async retry() { if (this.active && this.command && !this.state.busy) await this.runCommand(); }
  private async runCommand() {
    const command = this.command; if (!command || this.state.busy) return;
    let completed = false;
    ++this.reads; this.patch({ busy: command.kind, loading: false, error: '' });
    try {
      const result: BookingRideResult = command.kind === 'request' ? await this.api.requestRide(command.data, command.key)
        : await this.api.cancelRide(command.id, command.version, command.key);
      const current = this.state.settings!.current.filter((r) => r.id !== result.ride.id);
      if (isRequestOpen(result.ride.status)) current.unshift(result.ride);
      this.command = null;
      completed = true;
      this.patch({ settings: { ...this.state.settings!, current }, lastRide: result.ride, preview: null, uncertain: null, now: this.serverTime(result.serverNow) });
    } catch (e) {
      const failure = code(e), definite = typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500;
      if (definite || ['SESSION_CHANGED','UNAUTHENTICATED'].includes(failure.code ?? '')) {
        this.command = null; this.patch({ uncertain: null, stale: true, error: message(e) });
      } else this.patch({ uncertain: command.kind, stale: true, error: 'Confirmation was interrupted. Refresh to check your journeys, or retry the same action safely.' });
    } finally {
      this.patch({ busy: null });
      if (completed && this.active) void this.refresh();
      // Keep an actionable error visible after a definite rejection until a deliberate refresh or next poll.
    }
  }
}
