import { check } from '../../shared/errors.mjs';
import { fields, label, emailAddress, passwordInput } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';

export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * Transport-independent account use cases. Ports are supplied at composition:
 * repository, driverProfiles {find, insert, validateVehicle}, passwords {hash, verify}, tokens
 * {id, generate, digest}, unitOfWork, audit, hasRideHistory and clock.
 */
export function createAccountsService({ repository, driverProfiles, passwords, tokens, unitOfWork, audit, hasRideHistory, clock, revokeDevices = () => {} }) {
  function profile(id) {
    const user = repository.findById(id);
    if (!user) return null;
    const capabilities = repository.capabilities(id);
    const driver = capabilities.includes('driver') ? driverProfiles.find(id) : null;
    return { ...user, capabilities, driver: driver ? { status: driver.status, vehicle: driver.vehicle, eligibility: driver.eligibility } : null };
  }

  function vehicleInput(data) {
    fields(data, ['model', 'plate', 'make', 'year', 'colour'], ['model', 'plate']);
    if (['make', 'year', 'colour'].some((field) => Object.hasOwn(data, field))) {
      const selection = driverProfiles.validateVehicle(data);
      return { model: `${selection.make} ${selection.model}`, plate: selection.plate, selection };
    }
    // Older clients can still add a display-model/plate pair, then complete their application.
    const vehicle = { model: label(data.model, 'Vehicle model', 2, 80),
      plate: label(data.plate, 'Vehicle plate', 2, 15).toUpperCase() };
    check(/^[A-Z0-9 -]+$/.test(vehicle.plate), 'INVALID_PLATE', 'Use letters, digits, spaces or dashes for the plate.');
    return vehicle;
  }

  async function register(data) {
    fields(data, ['name', 'email', 'password', 'role', 'vehicle'], ['name', 'email', 'password']);
    const name = label(data.name, 'Name');
    const email = emailAddress(data.email);
    const password = passwordInput(data.password);
    // Keep older registration clients working. New clients start as customers.
    const role = data.role ?? 'customer';
    check(['customer', 'driver'].includes(role), 'INVALID_ROLE', 'Choose customer or driver.');
    let vehicle;
    if (role === 'driver') vehicle = vehicleInput(data.vehicle);
    else check(!Object.hasOwn(data, 'vehicle'), 'INVALID_FIELDS', 'Add a driver profile after creating your account.');
    // Hash outside the short synchronous database transaction.
    const passwordHash = await passwords.hash(password);
    return unitOfWork(() => {
      check(!repository.findByEmail(email), 'EMAIL_IN_USE', 'An account already uses this email address. Try signing in.');
      const id = tokens.id();
      const now = clock();
      repository.insert({ id, email, name, passwordHash, role, createdAt: now });
      repository.grant(id, 'customer', now);
      if (vehicle) { driverProfiles.insert(id, vehicle, now); repository.grant(id, 'driver', now); }
      audit.record(id, 'account.created', id, now);
      return profile(id);
    });
  }

  function addDriverProfile(userId, data, key) {
    fields(data, ['vehicle']);
    const vehicle = vehicleInput(data.vehicle);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify(['driver-profile', vehicle.model, vehicle.plate,
      ...(vehicle.selection ? [vehicle.selection] : [])]));
    return unitOfWork(() => {
      const user = profile(userId);
      requireRole(user, 'customer');
      const previous = repository.findCommand(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another application.');
        return { user, replayed: true };
      }
      check(!user.driver && !user.capabilities.includes('driver'), 'DRIVER_PROFILE_EXISTS', 'You already have a driver profile. Open Work to continue your application.');
      const now = clock();
      driverProfiles.insert(userId, vehicle, now);
      repository.grant(userId, 'driver', now);
      repository.saveCommand(userId, key, fingerprint);
      audit.record(userId, 'account.driver_profile_added', userId, now);
      return { user: profile(userId), replayed: false };
    });
  }

  async function login(data) {
    fields(data, ['email', 'password']);
    const record = repository.findByEmail(emailAddress(data.email));
    const valid = await passwords.verify(passwordInput(data.password), record?.passwordEnabled ? record.passwordHash : undefined);
    check(record?.passwordEnabled && valid, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return profile(record.id);
  }

  // Only a verified provider adapter can reach this port; HTTP accepts no claims.
  // Google subject is the stable identifier. Email matches never link accounts.
  function resolveGoogle(identity, linkUserId = null) {
    fields(identity, ['subject', 'email', 'name']);
    const subject = label(identity.subject, 'Google identity', 1, 255), email = emailAddress(identity.email);
    const name = typeof identity.name === 'string' && identity.name.trim().length >= 2
      && !/[\u0000-\u001f\u007f]/.test(identity.name) ? identity.name.trim().slice(0, 80) : 'Taxi Ai member';
    return unitOfWork(() => {
      const owner = repository.googleOwner(subject);
      if (owner) {
        const user = profile(owner); requireRole(user, 'customer');
        check(!linkUserId || linkUserId === owner, 'GOOGLE_ACCOUNT_CONFLICT', 'This Google account is already connected to a different Taxi Ai account.');
        audit.record(user.id, 'account.google_signed_in', user.id, clock()); return user;
      }
      const collision = repository.findByEmail(email);
      let id = linkUserId;
      if (id) {
        const user = profile(id); requireRole(user, 'customer');
        check(user.email === email && collision?.id === id && collision.passwordEnabled,
          'GOOGLE_ACCOUNT_CONFLICT', 'Choose the Google account with the same email as your Taxi Ai account.');
        check(!repository.googleLinked(id), 'GOOGLE_ACCOUNT_CONFLICT', 'A different Google account is already connected.');
      } else {
        check(!collision, 'GOOGLE_ACCOUNT_EXISTS', 'Sign in with your Taxi Ai password first, then connect Google from Sign-in methods.');
        id = tokens.id();
        repository.insert({ id, email, name, passwordHash: '', passwordEnabled: false, role: 'customer', createdAt: clock() });
        repository.grant(id, 'customer', clock()); audit.record(id, 'account.created', id, clock());
      }
      repository.linkGoogle(id, subject, clock()); audit.record(id, 'account.google_connected', id, clock());
      return profile(id);
    });
  }

  function signInMethods(userId) {
    const user = profile(userId); requireRole(user, 'customer');
    return { password: Boolean(repository.findByEmail(user.email)?.passwordEnabled), google: repository.googleLinked(userId) };
  }

  async function unlinkGoogle(userId, data, sessionToken) {
    fields(data, ['password']);
    const user = profile(userId); requireRole(user, 'customer');
    check(signInMethods(userId).password, 'GOOGLE_LAST_METHOD', 'Google is your only sign-in method. Keep it connected to retain access.');
    await login({ email: user.email, password: data.password });
    return unitOfWork(() => {
      check(sessionFor(sessionToken)?.user.id === userId, 'UNAUTHENTICATED', 'Your session changed. Sign in again.');
      requireRole(profile(userId), 'customer');
      repository.unlinkGoogle(userId);
      // Remove credentials that may have been obtained with the old method.
      repository.deleteUserSessions(userId); revokeDevices(userId);
      audit.record(userId, 'account.google_disconnected', userId, clock());
      return { disconnected: true };
    });
  }

  function revokeSession(token) {
    if (token) repository.deleteSession(tokens.digest(token));
  }

  function issueSession(userId, previousToken) {
    const token = tokens.generate();
    const csrfToken = tokens.generate();
    const now = clock();
    unitOfWork(() => {
      revokeSession(previousToken);
      repository.deleteExpiredSessions(now);
      repository.insertSession({ tokenHash: tokens.digest(token), userId, csrfToken, expiresAt: now + SESSION_MS });
    });
    return { token, csrfToken, maxAgeSeconds: SESSION_MS / 1000 };
  }

  function sessionFor(token) {
    if (!token) return null;
    const session = repository.findSession(tokens.digest(token), clock());
    if (!session) return null;
    return { user: profile(session.userId), csrfToken: session.csrfToken };
  }

  function bootstrapAdmin(email) {
    email = emailAddress(email);
    return unitOfWork(() => {
      check(!repository.hasAdmin(), 'ADMIN_EXISTS', 'An administrator already exists. This command only sets up the first administrator.');
      const user = repository.findByEmail(email);
      check(user?.role === 'customer', 'INVALID_ACCOUNT', 'Register a separate customer account for administration first.');
      check(user.passwordEnabled && !repository.googleLinked(user.id), 'INVALID_ACCOUNT', 'Use a separate password account without Google connected for administration.');
      check(!repository.capabilities(user.id).includes('driver'), 'INVALID_ACCOUNT', 'Use a separate account without a driver profile for administration.');
      check(!hasRideHistory(user.id), 'ACCOUNT_HAS_RIDES', 'Use a separate account that has no ride requests.');
      repository.promoteToAdmin(user.id);
      repository.clearCapabilities(user.id);
      repository.deleteUserSessions(user.id);
      revokeDevices(user.id);
      audit.record(user.id, 'admin.bootstrapped_locally', user.id, clock());
      return profile(user.id);
    });
  }

  return Object.freeze({ profile, register, login, resolveGoogle, signInMethods, unlinkGoogle, addDriverProfile, issueSession, sessionFor, revokeSession, bootstrapAdmin,
    sessionOwner: (hash) => repository.findSession(hash, clock())?.userId ?? null });
}
