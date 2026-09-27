import { check } from '../../shared/errors.mjs';
import { fields, label, emailAddress, passwordInput } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';

export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * Transport-independent account use cases. Ports are supplied at composition:
 * repository, driverProfiles {find, insert, validateVehicle}, passwords {hash, verify}, tokens
 * {id, generate, digest}, unitOfWork, audit, hasRideHistory and clock.
 */
export function createAccountsService({ repository, driverProfiles, passwords, tokens, unitOfWork, audit, hasRideHistory, clock, revokeDevices = () => {}, onRegistered = () => {}, revokeRecoveryLinks = () => {} }) {
  const passwordProofs = new WeakMap();
  const registrationIntents = ['customer','driver','eats_seller'];
  function registrationIntent(value, fallback = 'customer') {
    const intent = value ?? fallback;
    check(registrationIntents.includes(intent), 'INVALID_ROLE', 'Choose Book & Order, Drive & Deliver or Sell Food.');
    return intent;
  }
  async function profile(id) {
    const user = (await repository.findById(id));
    if (!user) return null;
    const capabilities = (await repository.capabilities(id));
    const driver = capabilities.includes('driver') ? (await driverProfiles.find(id)) : null;
    const setup = await repository.kemmySetup(id);
    return { ...user, emailVerified: Boolean(user.emailVerified), capabilities,
      startingExperience: setup?.experience ?? null,
      driver: driver ? { status: driver.status, vehicle: driver.vehicle, eligibility: driver.eligibility } : null };
  }

  async function vehicleInput(data) {
    fields(data, ['model', 'plate', 'make', 'year', 'colour', 'category', 'payloadKg'], ['model', 'plate']);
    if (['make', 'year', 'colour', 'category', 'payloadKg'].some((field) => Object.hasOwn(data, field))) {
      const selection = (await driverProfiles.validateVehicle(data));
      return { model: `${selection.make} ${selection.model}`, plate: selection.plate, selection };
    }
    // Older clients can still add a display-model/plate pair, then complete their application.
    const vehicle = { model: label(data.model, 'Vehicle model', 2, 80),
      plate: label(data.plate, 'Vehicle plate', 2, 15).toUpperCase() };
    check(/^[A-Z0-9 -]+$/.test(vehicle.plate), 'INVALID_PLATE', 'Use letters, digits, spaces or dashes for the plate.');
    return vehicle;
  }

  async function register(data) {
    fields(data, ['name', 'email', 'password', 'role', 'vehicle', 'intent'], ['name', 'email', 'password']);
    const name = label(data.name, 'Name');
    const email = emailAddress(data.email);
    const password = passwordInput(data.password);
    const intent = registrationIntent(data.intent, data.role === 'driver' ? 'driver' : 'customer');
    // Keep older registration clients working. New clients start as customers.
    const role = data.role ?? 'customer';
    check(['customer', 'driver'].includes(role), 'INVALID_ROLE', 'Choose customer or driver.');
    let vehicle;
    if (role === 'driver') {
      check(data.intent === undefined || intent === 'driver', 'INVALID_FIELDS', 'Legacy driver registration cannot use a different starting experience.');
      vehicle = (await vehicleInput(data.vehicle));
    } else check(!Object.hasOwn(data, 'vehicle'), 'INVALID_FIELDS', 'Add a driver profile after creating your account.');
    // Hash outside the short synchronous database transaction.
    const passwordHash = await passwords.hash(password);
    const user = (await unitOfWork(async () => {
      check(!(await repository.findByEmail(email)), 'EMAIL_IN_USE', 'An account already uses this email address. Try signing in.');
      const id = tokens.id();
      const now = clock();
      (await repository.insert({ id, email, name, passwordHash, role, createdAt: now }));
      (await repository.grant(id, 'customer', now));
      if (vehicle) { (await driverProfiles.insert(id, vehicle, now)); (await repository.grant(id, 'driver', now)); }
      await repository.kemmyPatch(id, { startedAt: now, experience: intent }, now);
      (await audit.record(id, 'account.created', id, now));
      return (await profile(id));
    }));
    (await onRegistered(user.id));
    return user;
  }

  async function addDriverProfile(userId, data, key) {
    fields(data, ['vehicle']);
    const vehicle = (await vehicleInput(data.vehicle));
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify(['driver-profile', vehicle.model, vehicle.plate,
      ...(vehicle.selection ? [vehicle.selection] : [])]));
    return (await unitOfWork(async () => {
      const user = (await profile(userId));
      requireRole(user, 'customer');
      const previous = (await repository.findCommand(userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another application.');
        return { user, replayed: true };
      }
      check(!user.driver && !user.capabilities.includes('driver'), 'DRIVER_PROFILE_EXISTS', 'You already have a driver profile. Open Work to continue your application.');
      const now = clock();
      (await driverProfiles.insert(userId, vehicle, now));
      (await repository.grant(userId, 'driver', now));
      (await repository.saveCommand(userId, key, fingerprint));
      (await audit.record(userId, 'account.driver_profile_added', userId, now));
      return { user: (await profile(userId)), replayed: false };
    }));
  }

  async function deleteDriverProfile(userId, data, key) {
    fields(data, ['expectedVersion', 'confirmation']);
    check(data.confirmation === 'DELETE', 'INVALID_CONFIRMATION', 'Type DELETE to confirm deleting your Work profile.');
    check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Refresh your Work profile before deleting it.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify(['delete-driver-profile', data.expectedVersion, data.confirmation]));
    return (await unitOfWork(async () => {
      const user = (await profile(userId)); requireRole(user, 'customer');
      const previous = (await repository.findCommand(userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        // A lost response must never delete a subsequently recreated profile.
        return { user, replayed: true };
      }
      check(user.capabilities.includes('driver'), 'NOT_FOUND', 'Your Work profile has already been deleted.');
      check((await driverProfiles.version(userId)) === data.expectedVersion, 'STALE_VERSION', 'Your Work profile changed. Refresh it and confirm deletion again.');
      check(!(await driverProfiles.hasWork(userId)), 'DRIVER_BUSY', 'Finish or cancel assigned work before deleting your Work profile.');
      const now = clock();
      (await driverProfiles.remove(userId, now));
      (await repository.revokeCapability(userId, 'driver'));
      (await driverProfiles.stopWork(userId, now));
      (await repository.saveCommand(userId, key, fingerprint));
      (await audit.record(userId, 'account.driver_profile_deleted', userId, now));
      return { user: (await profile(userId)), replayed: false };
    }));
  }

  async function login(data) {
    fields(data, ['email', 'password']);
    const record = (await repository.findByEmail(emailAddress(data.email)));
    const valid = await passwords.verify(passwordInput(data.password), record?.passwordEnabled ? record.passwordHash : undefined);
    check(record?.passwordEnabled && valid, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const current = (await repository.findByEmail(emailAddress(data.email)));
    check(current?.id === record.id && current.passwordEnabled && current.passwordHash === record.passwordHash,
      'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const user = (await profile(record.id));
    passwordProofs.set(user,record.passwordHash);
    return user;
  }

  // An in-memory proof, never part of the public profile. Recheck at issuance as
  // well as after hashing: a reset can win between two async continuations.
  async function validatePasswordLogin(user) {
    const hash = passwordProofs.get(user), current = (await repository.findByEmail(user.email));
    check(hash && current?.id === user.id && current.passwordEnabled && current.passwordHash === hash,
      'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  // A SERIALIZABLE transaction may retry its callback after rollback. Consume
  // this process-local proof only when the issuance transaction has committed.
  function consumePasswordLogin(user) { passwordProofs.delete(user); }

  // Internal ports: never serialize password state into an HTTP response.
  async function emailState(userId) {
    const user = (await profile(userId));
    if (!user?.capabilities.includes('customer')) return null;
    const credential = (await repository.findByEmail(user.email));
    return { id: user.id, email: user.email, verified: user.emailVerified,
      passwordEnabled: Boolean(credential.passwordEnabled), passwordHash: credential.passwordHash };
  }
  async function emailStateForAddress(email) { const row = (await repository.findByEmail(email)); return row ? (await emailState(row.id)) : null; }
  // These synchronous commands share the email action's atomic transaction.
  async function confirmEmail(userId,email) {
    check((await emailState(userId))?.email === email, 'INVALID_EMAIL_LINK', 'Request a new email link.');
    (await repository.confirmEmail(userId,email,clock()));
  }
  async function replacePassword(userId,email,expectedHash,hash) {
    const state = (await emailState(userId));
    check(state?.passwordEnabled && state.email === email && state.passwordHash === expectedHash,
      'INVALID_EMAIL_LINK', 'Request a new password reset link.');
    (await repository.replacePassword(userId,hash));
    (await repository.deleteUserSessions(userId)); (await revokeDevices(userId));
  }

  // Only a verified provider adapter can reach this port; HTTP accepts no claims.
  // Google subject is the stable identifier. Email matches never link accounts.
  async function resolveGoogle(identity, linkUserId = null, intent = null) {
    fields(identity, ['subject', 'email', 'name']);
    const subject = label(identity.subject, 'Google identity', 1, 255), email = emailAddress(identity.email);
    const startingIntent = intent === null ? null : registrationIntent(intent);
    const name = typeof identity.name === 'string' && identity.name.trim().length >= 2
      && !/[\u0000-\u001f\u007f]/.test(identity.name) ? identity.name.trim().slice(0, 80) : 'Taxi Ai member';
    return (await unitOfWork(async () => {
      const owner = (await repository.googleOwner(subject));
      if (owner) {
        const user = (await profile(owner)); requireRole(user, 'customer');
        check(!linkUserId || linkUserId === owner, 'GOOGLE_ACCOUNT_CONFLICT', 'This Google account is already connected to a different Taxi Ai account.');
        (await audit.record(user.id, 'account.google_signed_in', user.id, clock())); return user;
      }
      const collision = (await repository.findByEmail(email));
      let id = linkUserId;
      if (id) {
        const user = (await profile(id)); requireRole(user, 'customer');
        check(user.email === email && collision?.id === id && collision.passwordEnabled,
          'GOOGLE_ACCOUNT_CONFLICT', 'Choose the Google account with the same email as your Taxi Ai account.');
        check(!(await repository.googleLinked(id)), 'GOOGLE_ACCOUNT_CONFLICT', 'A different Google account is already connected.');
      } else {
        check(!collision, 'GOOGLE_ACCOUNT_EXISTS', 'Sign in with your Taxi Ai password first, then connect Google from Sign-in methods.');
        id = tokens.id();
        const now = clock();
        (await repository.insert({ id, email, name, passwordHash: '', passwordEnabled: false, role: 'customer', createdAt: now }));
        (await repository.grant(id, 'customer', now));
        await repository.kemmyPatch(id, { startedAt: now, experience: startingIntent ?? 'customer' }, now);
        (await audit.record(id, 'account.created', id, now));
      }
      (await repository.linkGoogle(id, subject, clock())); (await audit.record(id, 'account.google_connected', id, clock()));
      return (await profile(id));
    }));
  }

  async function signInMethods(userId) {
    const user = (await profile(userId)); requireRole(user, 'customer');
    return { password: Boolean((await repository.findByEmail(user.email))?.passwordEnabled), google: (await repository.googleLinked(userId)) };
  }

  async function unlinkGoogle(userId, data, sessionToken) {
    fields(data, ['password']);
    const user = (await profile(userId)); requireRole(user, 'customer');
    check((await signInMethods(userId)).password, 'GOOGLE_LAST_METHOD', 'Google is your only sign-in method. Keep it connected to retain access.');
    await login({ email: user.email, password: data.password });
    return (await unitOfWork(async () => {
      check((await sessionFor(sessionToken))?.user.id === userId, 'UNAUTHENTICATED', 'Your session changed. Sign in again.');
      requireRole((await profile(userId)), 'customer');
      (await repository.unlinkGoogle(userId));
      // Remove credentials that may have been obtained with the old method.
      (await repository.deleteUserSessions(userId)); (await revokeDevices(userId));
      (await audit.record(userId, 'account.google_disconnected', userId, clock()));
      return { disconnected: true };
    }));
  }

  async function revokeSession(token) {
    if (token) (await repository.deleteSession(tokens.digest(token)));
  }

  async function issueSession(userId, previousToken, passwordLogin = null) {
    const token = tokens.generate();
    const csrfToken = tokens.generate();
    const now = clock();
    (await unitOfWork(async () => {
      if (passwordLogin) { check(passwordLogin.id === userId, 'INVALID_CREDENTIALS', 'Sign in again.'); (await validatePasswordLogin(passwordLogin)); }
      (await revokeSession(previousToken));
      (await repository.deleteExpiredSessions(now));
      (await repository.insertSession({ tokenHash: tokens.digest(token), userId, csrfToken, expiresAt: now + SESSION_MS }));
    }));
    if (passwordLogin) consumePasswordLogin(passwordLogin);
    return { token, csrfToken, maxAgeSeconds: SESSION_MS / 1000 };
  }

  async function sessionFor(token) {
    if (!token) return null;
    const session = (await repository.findSession(tokens.digest(token), clock()));
    if (!session) return null;
    return { user: (await profile(session.userId)), csrfToken: session.csrfToken };
  }

  async function bootstrapAdmin(email) {
    email = emailAddress(email);
    return (await unitOfWork(async () => {
      check(!(await repository.hasAdmin()), 'ADMIN_EXISTS', 'An administrator already exists. This command only sets up the first administrator.');
      const user = (await repository.findByEmail(email));
      check(user?.role === 'customer', 'INVALID_ACCOUNT', 'Register a separate customer account for administration first.');
      check(user.passwordEnabled && !(await repository.googleLinked(user.id)), 'INVALID_ACCOUNT', 'Use a separate password account without Google connected for administration.');
      check(!(await repository.capabilities(user.id)).includes('driver'), 'INVALID_ACCOUNT', 'Use a separate account without a driver profile for administration.');
      check(!(await hasRideHistory(user.id)), 'ACCOUNT_HAS_RIDES', 'Use a separate account that has no ride requests.');
      (await repository.promoteToAdmin(user.id));
      (await repository.clearCapabilities(user.id));
      (await repository.deleteUserSessions(user.id));
      (await revokeDevices(user.id));
      (await audit.record(user.id, 'admin.bootstrapped_locally', user.id, clock()));
      return (await profile(user.id));
    }));
  }

  // Operator-only port for the local CLI. No browser or native route exposes it.
  // Database access is the operator authority; this never grants roles or resets MFA.
  async function resetAdminPasswordLocally(email, password) {
    email = emailAddress(email); password = passwordInput(password);
    const original = await repository.findByEmail(email);
    check(original?.role === 'admin' && original.passwordEnabled, 'INVALID_ACCOUNT',
      'No password-based administrator was found for that email in the configured database.');
    const hash = await passwords.hash(password);
    return await unitOfWork(async () => {
      const current = await repository.findByEmail(email);
      check(current?.id === original.id && current.role === 'admin' && current.passwordEnabled
        && current.passwordHash === original.passwordHash, 'INVALID_ACCOUNT',
      'The administrator account changed. Run the reset command again.');
      await repository.replacePassword(current.id, hash);
      await repository.deleteUserSessions(current.id);
      await revokeDevices(current.id);
      await revokeRecoveryLinks(current.id);
      await audit.record(current.id, 'admin.password_reset_locally', current.id, clock());
      return { email, reset: true };
    });
  }


  function kemmyProjection(user, state = null) {
    const value = state ?? {};
    const nextStep = value.completedAt ? 'complete'
      : !value.startedAt ? 'welcome'
        : !user.emailVerified && !value.emailDeferredAt ? 'email'
          : !value.experience ? 'experience'
            : !value.notificationsChoice ? 'notifications'
              : !value.safetyChoice ? 'safety' : 'finish';
    return {
      version: 1,
      assistant: 'Kemmy',
      deterministic: true,
      nextStep,
      autoOpen: !value.completedAt && !value.dismissedAt,
      startedAt: value.startedAt ?? null,
      emailDeferredAt: value.emailDeferredAt ?? null,
      experience: value.experience ?? null,
      notificationsChoice: value.notificationsChoice ?? null,
      safetyChoice: value.safetyChoice ?? null,
      dismissedAt: value.dismissedAt ?? null,
      completedAt: value.completedAt ?? null,
      emailVerified: Boolean(user.emailVerified),
    };
  }

  async function kemmySetup(userId) {
    const user = await profile(userId); requireRole(user, 'customer');
    return kemmyProjection(user, await repository.kemmySetup(userId));
  }

  async function updateKemmySetup(userId, data) {
    fields(data, ['action','value'], ['action']);
    const user = await profile(userId); requireRole(user, 'customer');
    check(typeof data.action === 'string' && ['start','email-later','experience','notifications','safety','dismiss','resume','complete','restart'].includes(data.action),
      'INVALID_INPUT', 'Choose a valid Kemmy setup action.');
    const now = clock(), patch = {};
    if (data.action === 'start') patch.startedAt = now;
    if (data.action === 'email-later') patch.emailDeferredAt = now;
    if (data.action === 'experience') {
      check(['customer','driver','eats_seller'].includes(data.value), 'INVALID_INPUT', 'Choose Customer, Driver or Eats seller.');
      patch.experience = data.value;
    }
    if (data.action === 'notifications') {
      check(['enabled','in_app','later'].includes(data.value), 'INVALID_INPUT', 'Choose a valid notification preference.');
      patch.notificationsChoice = data.value;
    }
    if (data.action === 'safety') {
      check(['review','later'].includes(data.value), 'INVALID_INPUT', 'Choose a valid Family Safety preference.');
      patch.safetyChoice = data.value;
    }
    if (data.action === 'dismiss') patch.dismissedAt = now;
    if (data.action === 'resume') patch.dismissedAt = null;
    if (data.action === 'complete') {
      const current = kemmyProjection(user, await repository.kemmySetup(userId));
      check(current.nextStep === 'finish' || current.nextStep === 'complete', 'SETUP_INCOMPLETE', 'Finish the remaining setup steps first.');
      patch.completedAt = current.completedAt ?? now; patch.dismissedAt = null;
    }
    if (data.action === 'restart') Object.assign(patch, { startedAt: now, emailDeferredAt: null, experience: null,
      notificationsChoice: null, safetyChoice: null, dismissedAt: null, completedAt: null });
    const state = await unitOfWork(async () => {
      const saved = await repository.kemmyPatch(userId, patch, now);
      if (data.action === 'complete') await audit.record(userId, 'account.kemmy_setup_completed', userId, now);
      return saved;
    });
    return kemmyProjection(await profile(userId), state);
  }

  return Object.freeze({ profile, register, login, resolveGoogle, signInMethods, unlinkGoogle, addDriverProfile, deleteDriverProfile, issueSession, sessionFor, revokeSession, bootstrapAdmin, resetAdminPasswordLocally, kemmySetup, updateKemmySetup,
    emailState, emailStateForAddress, confirmEmail, replacePassword, validatePasswordLogin, consumePasswordLogin,
    sessionOwner: async (hash) => (await repository.findSession(hash, clock()))?.userId ?? null });
}
