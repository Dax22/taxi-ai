import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability } from '../../shared/policies.mjs';
import { DRIVER_FACE_CONSENT_VERSION } from '../../../../../packages/shared/src/driver-face-check.mjs';

const CONSENT_VERSION = DRIVER_FACE_CONSENT_VERSION;
const PENDING_MS = 60_000, DAY_MS = 24 * 60 * 60_000, MAX_DAILY_ATTEMPTS = 5;
const completed = new Set(['matched', 'needs_review', 'unavailable']);
const resultReasons = new Set(['matched', 'invalid_image', 'no_face', 'multiple_faces', 'low_confidence', 'below_threshold']);
const identityDocuments = documents => documents.filter(doc => ['profile_photo', 'driving_licence'].includes(doc.kind))
  .map(({ id, kind, sha256 }) => ({ id, kind, sha256 })).sort((a, b) => a.kind.localeCompare(b.kind));

/** Provider calls run outside transactions. Stored consent/results bind to one version and two immutable document hashes. */
export function createDriverFaceChecks({ repository, provider, getAccount, hasDriverWork, access, editable, view, canonical, tokens, unitOfWork, audit, clock }) {
  async function project(id, documents) {
    const now = clock(), current = await repository.faceCheck(id);
    const attempts = await repository.faceAttempts(id, now - DAY_MS);
    const nextAttempt = attempts.length >= MAX_DAILY_ATTEMPTS ? attempts.at(-1).startedAt + DAY_MS + 1
      : attempts.length ? attempts[0].startedAt + PENDING_MS : null;
    const fresh = current && canonical(current.documents) === canonical(identityDocuments(documents));
    const expired = fresh && current.status === 'pending' && current.startedAt + PENDING_MS <= now;
    return { available: Boolean(provider.enabled), provider: fresh ? current.provider : provider.provider,
      status: fresh ? expired ? 'unavailable' : current.status : 'not_started',
      reason: fresh ? expired ? 'timeout' : current.reason : null,
      checkedAt: fresh ? expired ? current.startedAt + PENDING_MS : current.checkedAt : null,
      similarity: fresh ? current.similarity : null, threshold: fresh ? current.threshold : provider.threshold ?? null,
      consentVersion: CONSENT_VERSION, retryAfter: nextAttempt && nextAttempt > now ? nextAttempt : null };
  }
  async function requireCompleted(id, documents) {
    const result = await project(id, documents);
    check(!provider.enabled || (completed.has(result.status) && result.checkedAt !== null), 'FACE_CHECK_REQUIRED',
      'Complete the automatic face comparison before submitting or approving. Uncertain results can be reviewed by staff.');
    return result;
  }
  async function run(user, id, data, key, reauthenticate = async () => await getAccount(user.id)) {
    check(hasCapability(user, 'driver') && user.id === id, 'FORBIDDEN', 'Only the applicant can request a face comparison.');
    await access(user, id);
    fields(data, ['expectedVersion', 'consent']);
    check(data.consent === true, 'INVALID_CONSENT', 'Consent to comparing your selfie with your licence photo is required.');
    check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Use the application version shown on screen.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ id, action: 'face-check', data }));
    const reserved = await unitOfWork(async () => {
      const freshUser = await reauthenticate(), app = await access(freshUser, id);
      check(freshUser?.id === user.id, 'UNAUTHENTICATED', 'Sign in to continue.');
      const previous = await repository.command(user.id, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { replayed: true };
      }
      check(provider.enabled, 'FACE_CHECK_DISABLED', 'Automatic face comparison is not configured. Staff can review your documents.');
      check(app.version === data.expectedVersion, 'STALE_VERSION', 'The application changed. Refresh and review the current version.');
      editable(app);
      check(!await hasDriverWork(id), 'DRIVER_BUSY', 'Finish assigned work before changing the application.');
      const documents = identityDocuments(await repository.documents(id)), now = clock();
      check(documents.length === 2, 'APPLICATION_INCOMPLETE', 'Save your selfie and the front of your driving licence first.');
      const attempts = await repository.faceAttempts(id, now - DAY_MS);
      check(!attempts.some(attempt => attempt.checkedAt === null && attempt.startedAt + PENDING_MS > now),
        'FACE_CHECK_PENDING', 'A face comparison is already running. Refresh shortly.');
      check(attempts.length < MAX_DAILY_ATTEMPTS && (!attempts.length || attempts[0].startedAt + PENDING_MS <= now),
        'FACE_CHECK_LIMIT', 'Please wait before retrying. Up to five face comparisons are available in 24 hours.');
      const selfieContent = await repository.content(documents.find(doc => doc.kind === 'profile_photo').id);
      const licenceContent = await repository.content(documents.find(doc => doc.kind === 'driving_licence').id);
      check(selfieContent && licenceContent, 'APPLICATION_INCOMPLETE', 'Upload both photos again.');
      await repository.invalidateFaceChecks(id);
      app.version++; app.updatedAt = now;
      const attempt = { id: tokens.id(), driverId: id, applicationVersion: app.version, documents,
        consentVersion: CONSENT_VERSION, consentedAt: now, provider: provider.provider, threshold: provider.threshold, startedAt: now };
      await repository.insertFaceCheck(attempt);
      await repository.save(app);
      await repository.event(id, user.id, 'face_check_requested', app.version, { attemptId: attempt.id, consentVersion: CONSENT_VERSION }, now);
      await audit.record(user.id, 'driver.face_check.requested', attempt.id, now);
      await repository.saveCommand(user.id, key, fingerprint, id);
      return { attempt, licenceContent, selfieContent, replayed: false };
    });
    if (!reserved.replayed) {
      let result;
      try {
        result = await provider.compare({ licenceContent: reserved.licenceContent, selfieContent: reserved.selfieContent });
        if (!['matched', 'needs_review'].includes(result?.status) || !resultReasons.has(result.reason)
          || result.provider !== reserved.attempt.provider || result.threshold !== reserved.attempt.threshold
          || !(result.similarity === null || (Number.isFinite(result.similarity) && result.similarity >= 0 && result.similarity <= 100))
          || (result.status === 'matched' && (result.reason !== 'matched' || result.similarity === null || result.similarity < result.threshold))) throw new Error('Invalid provider result');
      } catch { result = { status: 'unavailable', reason: 'provider_unavailable', similarity: null }; }
      // A deleted profile, replacement upload or later version must never inherit a delayed match.
      await unitOfWork(async () => {
        const attempt = await repository.faceAttempt(reserved.attempt.id), app = await repository.application(id), now = clock();
        const current = attempt?.status === 'pending' && app?.version === attempt.applicationVersion
          && canonical(attempt.documents) === canonical(identityDocuments(await repository.documents(id)));
        if (!attempt) return;
        const timedOut = attempt.startedAt + PENDING_MS <= now;
        const outcome = current ? timedOut ? { status: 'unavailable', reason: 'timeout', similarity: null } : result
          : { status: 'superseded', reason: 'application_changed', similarity: null };
        await repository.completeFaceCheck(attempt.id, { ...outcome, checkedAt: now });
        if (current) {
          app.version++; app.updatedAt = now; await repository.save(app);
          await repository.event(id, user.id, 'face_check_completed', app.version, { attemptId: attempt.id, status: outcome.status }, now);
          await audit.record(user.id, 'driver.face_check.completed', attempt.id, now);
        }
      });
    }
    const freshUser = await reauthenticate();
    check(freshUser?.id === user.id, 'UNAUTHENTICATED', 'Sign in to continue.');
    return { application: await view(freshUser, id), replayed: reserved.replayed };
  }
  return Object.freeze({ project, requireCompleted, run });
}
