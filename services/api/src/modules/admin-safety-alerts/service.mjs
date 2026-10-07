import { check } from '../../shared/errors.mjs';
import { ALERT_LABELS, ACTIVE_TRIPS, alertId, filters, position, signal, reviewInput, nextReview } from './domain.mjs';

const text = value => typeof value === 'string' ? value.slice(0, 240) : null;
const parse = raw => { try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const person = value => value ? { id: text(value.id), name: text(value.name), kind: text(value.kind) } : null;
const vehicle = value => Object.fromEntries(['make','model','modelName','colour','plate','category','year'].filter(k => typeof value?.[k] === 'string' || Number.isSafeInteger(value?.[k])).map(k => [k, value[k]]));
/** Safety permission gates every operation; no dashboard action contacts an emergency service. */
export function createAdminSafetyAlertsService({ repository: r, requirePermission, getAccount, getTrip, getPassenger,
  locationForTrip, mapSettings, providerReadiness, unitOfWork, tokens, audit, clock }) {
  const authorize = userId => requirePermission(userId, 'cases.safety');
  function summary(a) {
    const s = parse(a.snapshotJson);
    return { id: a.id, rideId: a.rideId, kind: a.kind, label: ALERT_LABELS[a.kind] ?? 'Unverified safety signal',
      transportStatus: a.status, createdAt: a.createdAt, dueAt: a.dueAt, isTest: typeof s.isTest === 'boolean' ? s.isTest : null,
      experimental: a.kind !== 'manual', verifiedIncident: false, passenger: person(s.passenger), customer: person(s.customer),
      driver: person(s.driver), review: { state: a.reviewState, version: a.reviewVersion, assigneeId: a.assigneeId ?? null, updatedAt: a.reviewedAt ?? null } };
  }
  async function list(userId, query) {
    return unitOfWork(async () => {
      await authorize(userId); const f = filters(query), rows = await r.list(f), page = rows.slice(0, 20);
      await audit.record(userId, 'admin.safety_alerts_listed', 'safety-alerts', clock());
      return { viewerId: userId, asOf: clock(), items: page.map(summary), nextBefore: rows.length > 20 ? `${page.at(-1).createdAt}:${page.at(-1).id}` : null,
        filters: { kind: f.kind, state: f.state }, notice: 'Experimental signals require human assessment. Notification processing finished does not mean the incident is resolved or that emergency services were dispatched.' };
    });
  }
  async function details(userId, id, includeLive) {
    await authorize(userId); const a = await r.find(alertId(id)); check(a, 'NOT_FOUND', 'Safety alert not found.');
    const s = parse(a.snapshotJson), trip = await getTrip(a.rideId), storedGuest = await getPassenger(a.rideId);
    // Legacy snapshots did not identify the booking account. Use the saved trip, never assume the reporter was the passenger.
    const customerId = s.customer?.id ?? trip?.customerId ?? null;
    const customer = customerId ? await getAccount(customerId) : null, driver = s.driver?.id ? await getAccount(s.driver.id) : null;
    const contact = account => ({ email: text(account?.email), phone: null, source: 'current_account_profile' });
    const passenger = { ...person(s.passenger), contact: s.passenger?.kind === 'account' ? contact(customer) : null, phone: s.passenger?.kind === 'guest' && storedGuest?.kind === 'guest' ? text(storedGuest.phone) : null,
      contactSource: s.passenger?.kind === 'guest' ? 'saved_guest_booking' : 'booking_customer_contact' };
    const active = ACTIVE_TRIPS.includes(trip?.status);
    const latest = includeLive && active ? position(await locationForTrip(a.rideId), clock()) : null;
    const events = await r.events(a.id);
    await audit.record(userId, includeLive ? 'admin.safety_alert_location_viewed' : 'admin.safety_alert_viewed', a.id, clock());
    return { viewerId: userId, asOf: clock(), alert: summary(a),
      passenger, customer: { ...person(s.customer ?? customer), id: customerId, contact: contact(customer) },
      driver: { ...person(s.driver), contact: contact(driver), vehicle: vehicle(s.driver?.vehicle) }, reporter: person(s.reporter),
      pickup: text(s.pickup), destination: text(s.destination), signal: signal(parse(a.signalJson), a.kind),
      incidentPosition: position(s.location, clock()), incidentRecordedAt: Number.isSafeInteger(s.recordedAt) ? s.recordedAt : a.createdAt,
      currentTripStatus: trip?.status ?? null, currentPosition: latest, canRequestCurrentPosition: active,
      currentPositionRequested: includeLive, map: mapSettings(), readiness: providerReadiness(),
      deliveries: (await r.jobs(a.id)).map(j => ({ id: j.id, status: j.status, attempts: j.attempts, deliveredToPerson: false })),
      events: events.map(e => ({ id: e.id, actorId: e.actorId, action: e.action, note: e.note, version: e.version, createdAt: e.createdAt })),
      notice: 'The incident location is a saved phone-reported snapshot, not a live marker. Current driver location is separately requested, trip-limited and subject to sharing consent. Contacts are shown only when recorded; no phone number is inferred. Staff actions do not send messages or dispatch emergency services.' };
  }
  async function get(userId, id, query = {}) {
    check(Object.keys(query).every(k => k === 'live') && (query.live === undefined || query.live === '1'), 'INVALID_FIELDS', 'Use the incident link or its current-location link.');
    return unitOfWork(() => details(userId, id, query.live === '1'));
  }
  async function command({ userId, id, data, key }) {
    const input = reviewInput(data, key); alertId(id);
    const fingerprint = tokens.digest(JSON.stringify([id, input.action, input.expectedVersion, input.note]));
    return unitOfWork(async () => {
      await authorize(userId);
      const a = await r.find(id); check(a, 'NOT_FOUND', 'Safety alert not found.');
      const previous = await r.command(userId, key);
      if (previous) {
        check(previous.alertId === id && previous.fingerprint === fingerprint, 'KEY_REUSED', 'This action key belongs to a different review.');
        return { ...await details(userId, id, false), replayed: true };
      }
      check(a.reviewVersion === input.expectedVersion, 'STALE_VERSION', 'Another staff action changed this alert. Refresh it.');
      check((await r.events(id)).length < 200, 'INVALID_INPUT', 'This alert needs a linked support case; its review history is full.');
      const state = nextReview(a.reviewState, input.action), now = clock();
      const assigneeId = input.action === 'acknowledge' ? userId : input.action === 'reopen' ? null : a.assigneeId ?? null;
      check(await r.save({ id, state, assigneeId, expectedVersion: input.expectedVersion, now }), 'STALE_VERSION', 'Refresh before reviewing this alert.');
      await r.append({ id: tokens.id(), alertId: id, actorId: userId, ...input, version: input.expectedVersion + 1, now, key, fingerprint });
      await audit.record(userId, `admin.safety_alert_${input.action}`, id, now);
      return { ...await details(userId, id, false), replayed: false };
    });
  }
  return Object.freeze({ list, get, command });
}
