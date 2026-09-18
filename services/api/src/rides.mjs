import { randomUUID } from 'node:crypto';
import { FareNegotiation, FareError } from '../../../packages/shared/src/fare-negotiation.mjs';
import { createDemoQuote } from '../../../packages/shared/src/demo-booking.mjs';
import { check, fields, emailAddress } from './errors.mjs';
import { transaction } from './database.mjs';
import { digest, userView } from './auth.mjs';

function audit(db, actorId, kind, subjectId, now) {
  db.prepare('INSERT INTO audit_events (actor_id, kind, subject_id, created_at) VALUES (?, ?, ?, ?)')
    .run(actorId, kind, subjectId, now);
}

function requireRole(user, role) {
  check(user?.role === role, 403, 'FORBIDDEN', `A ${role} account is required.`);
  if (role === 'driver') {
    check(user.driver?.status === 'approved', 403, 'DRIVER_NOT_APPROVED', 'Administrator approval is required first.');
  }
}

function rideRecord(db, id) {
  const record = db.prepare('SELECT * FROM rides WHERE id = ?').get(id);
  check(record, 404, 'NOT_FOUND', 'Ride request not found.');
  return record;
}

function participant(record, user) {
  // Return the same response for an unknown ride and a ride owned by someone else.
  check(record.customer_id === user.id || record.driver_id === user.id,
    404, 'NOT_FOUND', 'Ride request not found.');
}

function requireVersion(record, version) {
  check(Number.isSafeInteger(version) && version >= 0, 400, 'INVALID_VERSION', 'A valid request version is required.');
  check(record.version === version, 409, 'STALE_VERSION', 'This request changed. Review the latest details and try again.');
}

function negotiationFor(db, record) {
  if (!record.driver_id) return null;
  const negotiation = new FareNegotiation({ id: record.id, customerId: record.customer_id,
    driverId: record.driver_id, suggestedFareKobo: record.suggested_fare_kobo, now: record.matched_at });
  // Restore from server-written commands, never a client-provided snapshot.
  for (const event of db.prepare('SELECT version, type, payload FROM fare_events WHERE ride_id = ? ORDER BY version').all(record.id)) {
    if (event.version !== negotiation.snapshot().version + 1) throw new Error('Invalid fare event sequence');
    negotiation[event.type](JSON.parse(event.payload));
  }
  return negotiation;
}

function peer(db, id, driver = false) {
  if (!id) return null;
  const user = userView(db, id);
  return { id: user.id, name: user.name, ...(driver ? { vehicle: user.driver.vehicle } : {}) };
}

function view(db, record) {
  const quote = createDemoQuote(record.pickup_id, record.destination_id);
  return { id: record.id, status: record.status, version: record.version,
    pickup: quote.pickup, destination: quote.destination, suggestedFareKobo: record.suggested_fare_kobo,
    currency: 'NGN', isDemo: true, createdAt: record.created_at, updatedAt: record.updated_at,
    customer: peer(db, record.customer_id), driver: peer(db, record.driver_id, true),
    negotiation: negotiationFor(db, record)?.snapshot() ?? null };
}

export function getRide(db, user, id) {
  const record = rideRecord(db, id);
  participant(record, user);
  return view(db, record);
}

export function listRides(db, user) {
  const records = db.prepare(`SELECT * FROM rides WHERE customer_id = ? OR driver_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 50`).all(user.id, user.id);
  const available = user.role === 'driver' && user.driver.status === 'approved'
    ? db.prepare("SELECT * FROM rides WHERE status = 'requested' ORDER BY created_at, id LIMIT 50").all() : [];
  return { rides: records.map((record) => view(db, record)), available: available.map((record) => {
    const quote = createDemoQuote(record.pickup_id, record.destination_id);
    return { id: record.id, version: record.version, pickup: quote.pickup, destination: quote.destination,
      suggestedFareKobo: record.suggested_fare_kobo, currency: 'NGN', isDemo: true, createdAt: record.created_at };
  }) };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

// Every mutation and its idempotency record commit together. No async work inside
// the transaction: concurrent processes must acquire SQLite's write lock first.
export function mutateRide(db, { userId, key, action, id = null, data, now }) {
  check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
    400, 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
  const fingerprint = digest(canonical({ action, id, data }));
  try {
    return transaction(db, () => {
      const user = userView(db, userId);
      check(user, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
      const previous = db.prepare('SELECT fingerprint, ride_id FROM idempotency WHERE actor_id = ? AND key = ?').get(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 409, 'KEY_REUSED', 'This request key was already used for another action.');
        return { ride: getRide(db, user, previous.ride_id), replayed: true };
      }
      const rideId = action === 'create' ? createRide(db, user, data, now)
        : action === 'claim' ? claimRide(db, user, id, data, now)
          : changeFare(db, user, id, action, data, now);
      db.prepare('INSERT INTO idempotency (actor_id, key, fingerprint, ride_id) VALUES (?, ?, ?, ?)')
        .run(userId, key, fingerprint, rideId);
      return { ride: getRide(db, user, rideId), replayed: false };
    });
  } catch (error) {
    if (error instanceof FareError) {
      // Domain failures leave both the event log and request untouched.
      error.status = error.code === 'FORBIDDEN' ? 403
        : ['INVALID_AMOUNT', 'INVALID_TIME', 'INVALID_EXPIRY'].includes(error.code) ? 400 : 409;
    }
    throw error;
  }
}

function createRide(db, user, data, now) {
  requireRole(user, 'customer');
  fields(data, ['pickupId', 'destinationId']);
  let quote;
  try { quote = createDemoQuote(data.pickupId, data.destinationId); }
  catch (error) { check(false, 400, 'INVALID_ROUTE', error.message); }
  check(!db.prepare("SELECT id FROM rides WHERE customer_id = ? AND status IN ('requested', 'negotiating')").get(user.id),
    409, 'OPEN_REQUEST_EXISTS', 'You already have an open request. Finish or cancel it first.');
  const id = randomUUID();
  db.prepare(`INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, user.id, quote.pickup.id, quote.destination.id, quote.suggestedFareKobo, now, now);
  audit(db, user.id, 'ride.requested', id, now);
  return id;
}

function claimRide(db, user, id, data, now) {
  requireRole(user, 'driver');
  fields(data, ['expectedVersion']);
  const record = rideRecord(db, id);
  check(record.status === 'requested', 409, 'REQUEST_UNAVAILABLE', 'Another driver took this request, or it is no longer open.');
  requireVersion(record, data.expectedVersion);
  check(!db.prepare("SELECT id FROM rides WHERE driver_id = ? AND status = 'negotiating'").get(user.id),
    409, 'DRIVER_BUSY', 'Finish or cancel your current negotiation first.');
  const result = db.prepare(`UPDATE rides SET driver_id = ?, matched_at = ?, updated_at = ?, status = 'negotiating',
    version = version + 1 WHERE id = ? AND version = ? AND status = 'requested'`).run(user.id, now, now, id, record.version);
  check(result.changes === 1, 409, 'STALE_VERSION', 'This request has changed. Refresh and try again.');
  audit(db, user.id, 'ride.claimed', id, now);
  return id;
}

function changeFare(db, user, id, action, data, now) {
  check(['propose', 'accept', 'cancel'].includes(action), 404, 'NOT_FOUND', 'Action not found.');
  fields(data, action === 'propose' ? ['expectedVersion', 'amountKobo']
    : action === 'accept' ? ['expectedVersion', 'offerId'] : ['expectedVersion']);
  const record = rideRecord(db, id);
  participant(record, user);
  if (user.role === 'driver') requireRole(user, 'driver');
  requireVersion(record, data.expectedVersion);
  check(['requested', 'negotiating'].includes(record.status), 409, 'REQUEST_CLOSED', 'This request has already ended.');
  let status;
  if (record.status === 'requested') {
    check(action === 'cancel', 409, 'NO_DRIVER', 'Wait for a driver before negotiating a fare.');
    status = 'cancelled';
  } else {
    const negotiation = negotiationFor(db, record);
    const current = negotiation.snapshot();
    check(action !== 'propose' || current.offers.length < 100,
      409, 'OFFER_LIMIT', 'This request has reached its offer limit. Accept the current offer or cancel.');
    const payload = { actorId: user.id, expectedVersion: current.version, now };
    if (action === 'propose') Object.assign(payload, { amountKobo: data.amountKobo, channel: 'in_app', validForMs: 120_000 });
    if (action === 'accept') payload.offerId = data.offerId;
    const next = negotiation[action](payload);
    status = next.status === 'open' ? 'negotiating' : next.status;
    db.prepare('INSERT INTO fare_events (ride_id, version, type, payload) VALUES (?, ?, ?, ?)')
      .run(id, next.version, action, JSON.stringify(payload));
  }
  const result = db.prepare('UPDATE rides SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
    .run(status, now, id, record.version);
  check(result.changes === 1, 409, 'STALE_VERSION', 'This request has changed. Refresh and try again.');
  audit(db, user.id, `fare.${action}`, id, now);
  return id;
}

export function listDrivers(db, user) {
  requireRole(user, 'admin');
  return db.prepare(`SELECT u.id, u.name, d.status, d.vehicle_model, d.vehicle_plate
    FROM users u JOIN drivers d ON d.user_id = u.id ORDER BY (d.status = 'pending') DESC, u.created_at DESC LIMIT 100`)
    .all().map((driver) => ({ id: driver.id, name: driver.name, status: driver.status,
      vehicle: { model: driver.vehicle_model, plate: driver.vehicle_plate } }));
}

export function reviewDriver(db, user, id, data, now) {
  requireRole(user, 'admin');
  fields(data, ['decision']);
  check(['approved', 'rejected'].includes(data.decision), 400, 'INVALID_DECISION', 'Choose approved or rejected.');
  return transaction(db, () => {
    const driver = db.prepare('SELECT status FROM drivers WHERE user_id = ?').get(id);
    check(driver, 404, 'NOT_FOUND', 'Driver application not found.');
    if (driver.status !== data.decision) {
      check(driver.status === 'pending', 409, 'ALREADY_REVIEWED', 'This application has already been reviewed.');
      db.prepare('UPDATE drivers SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE user_id = ?')
        .run(data.decision, user.id, now, id);
      audit(db, user.id, `driver.${data.decision}`, id, now);
    }
    return listDrivers(db, user).find((item) => item.id === id);
  });
}

export function bootstrapAdmin(db, email, now = Date.now()) {
  email = emailAddress(email);
  return transaction(db, () => {
    check(!db.prepare("SELECT id FROM users WHERE role = 'admin'").get(),
      409, 'ADMIN_EXISTS', 'An administrator already exists. This command only sets up the first administrator.');
    const user = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    check(user?.role === 'customer', 400, 'INVALID_ACCOUNT', 'Register a separate customer account for administration first.');
    check(!db.prepare('SELECT id FROM rides WHERE customer_id = ?').get(user.id),
      409, 'ACCOUNT_HAS_RIDES', 'Use a separate account that has no ride requests.');
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit(db, user.id, 'admin.bootstrapped_locally', user.id, now);
    return userView(db, user.id);
  });
}
