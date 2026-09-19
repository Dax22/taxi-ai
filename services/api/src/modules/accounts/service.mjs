import { check } from '../../shared/errors.mjs';
import { fields, label, emailAddress, passwordInput } from '../../shared/validation.mjs';

export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * Transport-independent account use cases. Ports are supplied at composition:
 * repository, driverProfiles {find, insert}, passwords {hash, verify}, tokens
 * {id, generate, digest}, unitOfWork, audit, hasRideHistory and clock.
 */
export function createAccountsService({ repository, driverProfiles, passwords, tokens, unitOfWork, audit, hasRideHistory, clock }) {
  function profile(id) {
    const user = repository.findById(id);
    if (!user) return null;
    const driver = user.role === 'driver' ? driverProfiles.find(id) : null;
    return { ...user, driver: driver ? { status: driver.status, vehicle: driver.vehicle } : null };
  }

  async function register(data) {
    fields(data, ['name', 'email', 'password', 'role', 'vehicle'], ['name', 'email', 'password', 'role']);
    const name = label(data.name, 'Name');
    const email = emailAddress(data.email);
    const password = passwordInput(data.password);
    check(['customer', 'driver'].includes(data.role), 'INVALID_ROLE', 'Choose customer or driver.');
    let vehicle;
    if (data.role === 'driver') {
      fields(data.vehicle, ['model', 'plate']);
      vehicle = { model: label(data.vehicle.model, 'Vehicle model', 2, 80),
        plate: label(data.vehicle.plate, 'Vehicle plate', 2, 15).toUpperCase() };
      check(/^[A-Z0-9 -]+$/.test(vehicle.plate), 'INVALID_PLATE', 'Use letters, digits, spaces or dashes for the plate.');
    } else check(!Object.hasOwn(data, 'vehicle'), 'INVALID_FIELDS', 'Vehicle details belong to driver accounts.');
    // Hash outside the short synchronous database transaction.
    const passwordHash = await passwords.hash(password);
    return unitOfWork(() => {
      check(!repository.findByEmail(email), 'EMAIL_IN_USE', 'An account already uses this email address. Try signing in.');
      const id = tokens.id();
      const now = clock();
      repository.insert({ id, email, name, passwordHash, role: data.role, createdAt: now });
      if (vehicle) driverProfiles.insert(id, vehicle);
      audit.record(id, 'account.created', id, now);
      return profile(id);
    });
  }

  async function login(data) {
    fields(data, ['email', 'password']);
    const record = repository.findByEmail(emailAddress(data.email));
    const valid = await passwords.verify(passwordInput(data.password), record?.passwordHash);
    check(record && valid, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return profile(record.id);
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
      check(!hasRideHistory(user.id), 'ACCOUNT_HAS_RIDES', 'Use a separate account that has no ride requests.');
      repository.promoteToAdmin(user.id);
      repository.deleteUserSessions(user.id);
      audit.record(user.id, 'admin.bootstrapped_locally', user.id, clock());
      return profile(user.id);
    });
  }

  return Object.freeze({ profile, register, login, issueSession, sessionFor, revokeSession, bootstrapAdmin,
    sessionOwner: (hash) => repository.findSession(hash, clock())?.userId ?? null });
}
