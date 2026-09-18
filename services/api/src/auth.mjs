import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { check, fields, label, emailAddress } from './errors.mjs';
import { transaction } from './database.mjs';

const scrypt = promisify(scryptCallback);
// OWASP's N=2^15, r=8, p=3 option. Keep work bounded on this local server.
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'taxi_ai_session';
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
let passwordJobs = 0;

export const digest = (value) => createHash('sha256').update(value).digest('hex');

async function derive(password, salt) {
  check(passwordJobs < 2, 429, 'AUTH_BUSY', 'Please wait a moment before trying again.');
  passwordJobs++;
  try { return await scrypt(password, salt, 64, SCRYPT); }
  finally { passwordJobs--; }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) {
    throw new Error('Invalid password record');
  }
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function passwordInput(value) {
  check(typeof value === 'string' && value.length >= 12 && value.length <= 128,
    400, 'INVALID_PASSWORD', 'Use a password containing 12–128 characters.');
  return value;
}

export function userView(db, id) {
  const user = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id);
  if (!user) return null;
  const driver = user.role === 'driver'
    ? db.prepare('SELECT status, vehicle_model, vehicle_plate FROM drivers WHERE user_id = ?').get(id) : null;
  return { id: user.id, email: user.email, name: user.name, role: user.role,
    createdAt: user.created_at, driver: driver ? { status: driver.status,
      vehicle: { model: driver.vehicle_model, plate: driver.vehicle_plate } } : null };
}

export async function register(db, data, now) {
  fields(data, ['name', 'email', 'password', 'role', 'vehicle'], ['name', 'email', 'password', 'role']);
  const name = label(data.name, 'Name');
  const email = emailAddress(data.email);
  const password = passwordInput(data.password);
  check(['customer', 'driver'].includes(data.role), 400, 'INVALID_ROLE', 'Choose customer or driver.');
  let model, plate;
  if (data.role === 'driver') {
    fields(data.vehicle, ['model', 'plate']);
    model = label(data.vehicle.model, 'Vehicle model', 2, 80);
    plate = label(data.vehicle.plate, 'Vehicle plate', 2, 15).toUpperCase();
    check(/^[A-Z0-9 -]+$/.test(plate), 400, 'INVALID_PLATE', 'Use letters, digits, spaces or dashes for the plate.');
  } else {
    check(!Object.hasOwn(data, 'vehicle'), 400, 'INVALID_FIELDS', 'Vehicle details belong to driver accounts.');
  }
  const passwordHash = await hashPassword(password);
  return transaction(db, () => {
    check(!db.prepare('SELECT id FROM users WHERE email = ?').get(email),
      409, 'EMAIL_IN_USE', 'An account already uses this email address. Try signing in.');
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, name, passwordHash, data.role, now);
    if (data.role === 'driver') {
      db.prepare('INSERT INTO drivers (user_id, vehicle_model, vehicle_plate) VALUES (?, ?, ?)').run(id, model, plate);
    }
    db.prepare('INSERT INTO audit_events (actor_id, kind, subject_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'account.created', id, now);
    return userView(db, id);
  });
}

export async function login(db, data) {
  fields(data, ['email', 'password']);
  const email = emailAddress(data.email);
  const password = passwordInput(data.password);
  const record = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  const valid = await verifyPassword(password, record?.password_hash ?? DUMMY_HASH);
  check(record && valid, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  return userView(db, record.id);
}

function cookieToken(request) {
  const values = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
  const raw = values.find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}

export function sessionCookie(token, maxAge = SESSION_MS / 1000) {
  // HTTP is intentional only on loopback. Public hosting requires HTTPS + Secure.
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function issueSession(db, request, userId, now) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  transaction(db, () => {
    revokeSession(db, request);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), userId, csrfToken, now + SESSION_MS);
  });
  return { cookie: sessionCookie(token), csrfToken };
}

export function sessionFor(db, request, now) {
  const token = cookieToken(request);
  if (!token) return null;
  const session = db.prepare('SELECT user_id, csrf_token FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), now);
  if (!session) return null;
  return { user: userView(db, session.user_id), csrfToken: session.csrf_token };
}

export function revokeSession(db, request) {
  const token = cookieToken(request);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
}

export function requireCsrf(request, session) {
  const token = request.headers['x-csrf-token'];
  check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken)),
  403, 'INVALID_CSRF', 'Refresh the page before trying again.');
}

export function rateLimit(db, key, now, limit, windowMs) {
  transaction(db, () => {
    db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
    db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1`).run(digest(key), now + windowMs);
  });
  const rate = db.prepare('SELECT count FROM rate_limits WHERE key = ?').get(digest(key));
  check(rate.count <= limit, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
}
