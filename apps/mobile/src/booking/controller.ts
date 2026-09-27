import { transportCategory, deliveryDetails, supportsParcelCategory } from '../../../../packages/shared/src/transport-categories.mjs';
import { matchSampleArea } from '../../../../packages/shared/src/demo-booking.mjs';
import { passengerDetails } from '../../../../packages/shared/src/guest-rides.mjs';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { isRequestOpen } from '../../../../packages/shared/src/mobile-booking.mjs';
import type { Booking, BookingPreview, BookingRide, BookingRideResult, Place, RequestData } from '../../../../packages/shared/src/mobile-booking.mjs';
import type { MobileClient } from '../api/client.ts';

type Api = Pick<MobileClient, 'booking' | 'bookingRide' | 'searchPlaces' | 'routePreview' | 'samplePreview' | 'requestRide' | 'cancelRide'>;
type Endpoint = 'pickup' | 'destination';
interface Search { query: string; selected: Place | null; results: Place[]; searching: boolean; searched: boolean; attribution: string }
type Command = { kind: 'request'; key: string; data: RequestData } | { kind: 'cancel'; key: string; id: string; version: number };
type LocatePickup = () => Promise<Place>;
export interface DeliveryDraft { description: string; weightKg: string; recipientName: string; pickupInstructions: string; dropoffInstructions: string }
export interface PassengerDraft { kind: 'self' | 'guest'; name: string; phone: string; consent: boolean }
const emptyPassenger = (): PassengerDraft => ({ kind: 'self', name: '', phone: '', consent: false });
const emptyDelivery = (): DeliveryDraft => ({ description: '', weightKg: '', recipientName: '', pickupInstructions: '', dropoffInstructions: '' });
export interface BookingState {
  category: VehicleCategoryId; service: 'ride' | 'courier'; delivery: DeliveryDraft; passenger: PassengerDraft;
  settings: Booking | null; mode: 'route' | 'sample' | null; consent: boolean; pickup: Search; destination: Search;
  pickupId: string; destinationId: string; sampleDestinationQuery: string; preview: BookingPreview | null; lastRide: BookingRide | null;
  loading: boolean; locatingPickup: boolean; busy: 'preview' | 'request' | 'cancel' | null; uncertain: 'request' | 'cancel' | null;
  error: string; stale: boolean; now: number;
}
const emptySearch = (): Search => ({ query: '', selected: null, results: [], searching: false, searched: false, attribution: '' });
const message = (e: unknown) => e instanceof Error ? e.message : 'Unable to connect. Try again.';
const code = (e: unknown): { code?: string; status?: number } => typeof e === 'object' && e !== null ? e : {};

/** Ephemeral workflow. Commands retain their exact key/payload until the server gives a definite answer. */
export class BookingController {
  private api: Api;
  private key: () => string;
  private locatePickup: LocatePickup;
  private clock: () => number;
  private listeners = new Set<() => void>();
  private active = false;
  private disposed = false;
  private reads = 0;
  private searches = { pickup: 0, destination: 0 };
  private command: Command | null = null;
  private anchor = { server: 0, local: 0 };
  private state: BookingState = { category: 'standard', service: 'ride', delivery: emptyDelivery(), passenger: emptyPassenger(), settings: null, mode: null, consent: false, pickup: emptySearch(), destination: emptySearch(),
    pickupId: '', destinationId: '', sampleDestinationQuery: '', preview: null, lastRide: null, loading: false, locatingPickup: false, busy: null, uncertain: null, error: '', stale: true, now: 0 };
  constructor(api: Api, key: () => string, clock: () => number = () => performance.now(),
    locatePickup: LocatePickup = async () => { throw new Error('Current location is unavailable on this device.'); }) {
    this.api = api; this.key = key; this.clock = clock; this.locatePickup = locatePickup;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<BookingState>) { if (this.disposed) return; this.state = { ...this.state, ...value }; for (const fn of this.listeners) fn(); }
  private serverTime(value: number) { this.anchor = { server: value, local: this.clock() }; return value; }
  private now() { return this.anchor.server + Math.max(0, this.clock() - this.anchor.local); }
  tick() { if (this.active && this.state.settings) this.patch({ now: this.now() }); }
  activate() { if (this.disposed) return; this.active = true; void this.refresh(); }
  pause() {
    this.active = false; ++this.reads; ++this.searches.pickup; ++this.searches.destination;
    this.patch({ stale: true, loading: false, locatingPickup: false, pickup: { ...this.state.pickup, searching: false }, destination: { ...this.state.destination, searching: false } });
  }
  dispose() { this.pause(); this.command = null; this.patch({ passenger: emptyPassenger(), delivery: emptyDelivery(), preview: null, settings: null, lastRide: null, busy: null, uncertain: null }); this.disposed = true; this.listeners.clear(); }
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
      const areaIds = new Set(settings.areas.map((area) => area.id));
      const pickupId = areaIds.has(this.state.pickupId) ? this.state.pickupId : settings.areas[0]?.id ?? '';
      const destinationId = areaIds.has(this.state.destinationId) && this.state.destinationId !== pickupId
        ? this.state.destinationId : '';
      this.patch({ settings, lastRide, mode, stale: false, now: this.serverTime(settings.serverNow), error: this.command ? this.state.error : '',
        pickupId, destinationId,
        ...(settings.current.length || settings.blockedBy || mode !== this.state.mode ? { preview: null } : {}) });
    } catch (e) { if (this.active && read === this.reads) this.patch({ stale: true, error: `Could not refresh your request. ${message(e)}` }); }
    finally { if (read === this.reads) this.patch({ loading: false }); }
  }
  private locked() { return !!this.state.busy || !!this.command; }
  private canPlan() { return this.active && !!this.state.settings && !this.state.stale && !this.state.settings.current.length && !this.state.settings.blockedBy; }
  chooseCategory(category: VehicleCategoryId) {
    if (this.locked() || !transportCategory(category) || category === this.state.category || this.state.service === 'courier' && !supportsParcelCategory(category)) return;
    const preservePassenger = this.state.service === 'ride'
      && transportCategory(this.state.category)?.service === 'ride' && transportCategory(category)?.service === 'ride';
    this.patch({ category, passenger: preservePassenger ? this.state.passenger : emptyPassenger(), delivery: emptyDelivery(), preview: null, error: '' });
  }
  chooseService(service: 'ride' | 'courier') {
    if (this.locked() || service === this.state.service) return;
    this.patch({ service, category: service === 'courier' && !supportsParcelCategory(this.state.category) ? 'standard' : this.state.category,
      passenger: emptyPassenger(), delivery: emptyDelivery(), preview: null, error: '' });
  }
  choosePassenger(kind: PassengerDraft['kind']) {
    if (this.locked() || this.state.service === 'courier' || transportCategory(this.state.category)?.service !== 'ride' || kind === this.state.passenger.kind) return;
    this.patch({ passenger: { ...emptyPassenger(), kind }, error: '' });
  }
  editPassenger(field: 'name' | 'phone', value: string) {
    if (this.locked() || this.state.service === 'courier' || this.state.passenger.kind !== 'guest' || transportCategory(this.state.category)?.service !== 'ride') return;
    this.patch({ passenger: { ...this.state.passenger, [field]: value, consent: false }, error: '' });
  }
  consentPassenger(consent: boolean) {
    if (this.locked() || this.state.service === 'courier' || this.state.passenger.kind !== 'guest' || transportCategory(this.state.category)?.service !== 'ride') return;
    this.patch({ passenger: { ...this.state.passenger, consent }, error: '' });
  }
  editDelivery(field: keyof DeliveryDraft, value: string) {
    if (this.locked()) return;
    this.patch({ delivery: { ...this.state.delivery, [field]: value }, error: '' });
  }
  chooseMode(mode: 'route' | 'sample') {
    if (this.locked() || (mode === 'route' ? !this.state.settings?.online.enabled : !this.state.settings?.allowSample)) return;
    ++this.searches.pickup; ++this.searches.destination;
    this.patch({ mode, locatingPickup: false, preview: null, error: '', pickup: emptySearch(), destination: emptySearch() });
  }
  consent() { this.patch({ consent: true }); }
  edit(endpoint: Endpoint, query: string) {
    if (this.locked()) return;
    ++this.searches[endpoint]; this.patch({ ...(endpoint === 'pickup' ? { locatingPickup: false } : {}), [endpoint]: { ...emptySearch(), query }, preview: null, error: '' });
  }
  select(endpoint: Endpoint, place: Place) {
    if (this.locked()) return;
    ++this.searches[endpoint]; this.patch({ ...(endpoint === 'pickup' ? { locatingPickup: false } : {}), [endpoint]: { ...emptySearch(), query: place.name, selected: place }, preview: null, error: '' });
  }
  sample(endpoint: Endpoint, id: string) {
    if (this.locked()) return;
    if (endpoint === 'destination') {
      const area = this.state.settings?.areas.find((item) => item.id === id && item.id !== this.state.pickupId);
      this.patch({ destinationId: area?.id ?? '', sampleDestinationQuery: area?.name ?? '', preview: null, error: '' });
    } else this.patch({ pickupId: id, preview: null, error: '' });
  }
  editSampleDestination(query: string) {
    if (this.locked()) return;
    const area = matchSampleArea(this.state.settings?.areas ?? [], query);
    this.patch({ sampleDestinationQuery: query, destinationId: area?.id !== this.state.pickupId ? area?.id ?? '' : '', preview: null, error: '' });
  }
  async search(endpoint: Endpoint): Promise<Place[]> {
    if (!this.canPlan() || this.locked() || this.state.mode !== 'route' || !this.state.consent) return [];
    const query = this.state[endpoint].query.trim();
    if (query.length < 3 || query.length > 160) { this.patch({ error: 'Enter a Nigerian address or landmark, between 3 and 160 characters.' }); return []; }
    const read = ++this.searches[endpoint]; this.patch({ ...(endpoint === 'pickup' ? { locatingPickup: false } : {}), [endpoint]: { ...this.state[endpoint], results: [], searching: true }, error: '' });
    try {
      const result = await this.api.searchPlaces(query);
      if (this.active && read === this.searches[endpoint]) {
        this.patch({ [endpoint]: { ...this.state[endpoint], results: result.places, searching: false, searched: true, attribution: result.attribution } });
        return result.places;
      }
      return [];
    } catch (e) {
      if (this.active && read === this.searches[endpoint]) this.patch({ error: message(e), [endpoint]: { ...this.state[endpoint], searching: false } });
      return [];
    }
  }
  async findRides() {
    const places = await this.search('destination');
    if (places.length === 1) await this.chooseRideDestination(places[0]);
  }
  async chooseRideDestination(place: Place) {
    this.select('destination', place);
    if (!this.state.pickup.selected) await this.useCurrentPickup();
    if (this.state.pickup.selected && this.state.destination.selected) await this.preview();
  }
  async chooseRidePickup(place: Place) {
    this.select('pickup', place);
    if (this.state.pickup.selected && this.state.destination.selected) await this.preview();
  }
  async useRidePickup() {
    await this.useCurrentPickup();
    if (this.state.pickup.selected && this.state.destination.selected) await this.preview();
  }
  async useCurrentPickup() {
    if (!this.canPlan() || this.locked() || this.state.mode !== 'route' || !this.state.consent || this.state.locatingPickup) return;
    const read = ++this.searches.pickup;
    this.patch({ locatingPickup: true, error: '', preview: null, pickup: emptySearch() });
    try {
      const place = await this.locatePickup();
      if (this.active && read === this.searches.pickup) this.patch({ pickup: { ...emptySearch(), query: place.name, selected: place }, preview: null });
    } catch (e) { if (this.active && read === this.searches.pickup) this.patch({ error: message(e) }); }
    finally { if (read === this.searches.pickup) this.patch({ locatingPickup: false }); }
  }
  async preview() {
    if (!this.canPlan() || this.locked()) return;
    const { mode, consent, pickup, destination, pickupId, destinationId, category } = this.state;
    if (mode === 'route' && (!consent || !pickup.selected || !destination.selected)) { this.patch({ error: 'Choose a pickup using current location or address search, and select a destination before previewing the route.' }); return; }
    if (mode === 'sample' && (!pickupId || !destinationId || pickupId === destinationId)) { this.patch({ error: 'Type a destination from the listed sample Abuja areas, different from your pickup.' }); return; }
    if (!mode) return;
    ++this.reads; this.patch({ busy: 'preview', loading: false, error: '', preview: null });
    try {
      const result = mode === 'route' ? await this.api.routePreview(pickup.selected!, destination.selected!, this.key(), category) : await this.api.samplePreview(pickupId, destinationId, category);
      this.patch({ preview: result.preview, now: this.serverTime(result.serverNow) });
    } catch (e) { this.patch({ error: message(e) }); }
    finally { this.patch({ busy: null }); if (this.state.stale && this.active) void this.refresh(); }
  }
  async submit() {
    if (!this.canPlan() || this.locked() || !this.state.preview) return;
    const preview = this.state.preview;
    if (preview.expiresAt !== null && this.now() >= preview.expiresAt) { this.patch({ error: 'This route preview has expired. Preview the route again.', preview: null }); return; }
    let delivery, passenger;
    try { delivery = deliveryDetails(this.state.category, this.state.service === 'courier' || transportCategory(this.state.category)?.service === 'delivery'
      ? { ...this.state.delivery, weightKg: Number(this.state.delivery.weightKg) } : undefined);
      if (!delivery) passenger = passengerDetails(this.state.passenger.kind === 'self' ? { kind: 'self' } : this.state.passenger, this.state.category);
    }
    catch (e) { this.patch({ error: message(e) }); return; }
    if ((preview.vehicleCategory ?? 'standard') !== this.state.category) { this.patch({ preview: null, error: 'Preview this category again.' }); return; }
    this.command = { kind: 'request', key: this.key(), data: { ...preview.request, vehicleCategory: this.state.category, ...(delivery ? { delivery } : {}), ...(passenger ? { passenger } : {}) } }; await this.runCommand();
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
      if (this.disposed) return;
      const current = this.state.settings!.current.filter((r) => r.id !== result.ride.id);
      if (isRequestOpen(result.ride.status)) current.unshift(result.ride);
      this.command = null;
      completed = true;
      this.patch({ settings: { ...this.state.settings!, current }, lastRide: result.ride, preview: null, delivery: emptyDelivery(), passenger: emptyPassenger(), uncertain: null, now: this.serverTime(result.serverNow) });
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
