import { check } from '../../shared/errors.mjs';
import { fields, emailAddress, passwordInput } from '../../shared/validation.mjs';

const HOUR = 60 * 60_000;
const accepted = () => ({ accepted: true });
const invalid = () => check(false, 'INVALID_EMAIL_LINK', 'This link is expired or no longer valid. Request a new email.');

/** Account actions and durable delivery scheduling. All providers are injected ports. */
export function createAccountEmailService({ repository, accounts, mail, passwords, tokens, unitOfWork, rateLimiter, audit, clock }) {
  let running = false, stopped = false;
  const settings = () => ({ enabled: mail.enabled });
  const enabled = () => check(mail.enabled, 'EMAIL_DISABLED', 'Account emails are not available yet. Please try again once email delivery is enabled.');
  async function status(userId) {
    const state = (await accounts.emailState(userId));
    check(state, 'FORBIDDEN', 'Use your customer or driver account.');
    return { enabled: mail.enabled, verified: state.verified, email: state.email };
  }
  async function allowance(email, purpose) {
    try {
      // Apply the same private mailbox limits to existing and unknown addresses.
      (await rateLimiter.consume(`email-minute:${purpose}:${email}`, clock(), 1, 60_000));
      (await rateLimiter.consume(`email-hour:${purpose}:${email}`, clock(), 3, HOUR));
      return true;
    } catch (error) { if (error.code === 'RATE_LIMITED') return false; throw error; }
  }
  async function enqueue(userId, purpose, email) {
    return (await unitOfWork(async () => {
      if ((await repository.countJobs()) >= 1000) return false;
      (await repository.enqueue(tokens.id(),userId,purpose,email,clock())); return true;
    }));
  }
  async function requestReset(data) {
    fields(data, ['email']); const email = emailAddress(data.email); enabled();
    const allowed = (await allowance(email, 'reset'));
    const state = (await accounts.emailStateForAddress(email));
    if (allowed && state?.passwordEnabled) (await enqueue(state.id,'reset',email));
    return accepted(); // No account existence, delivery result or token is exposed.
  }
  async function requestVerification(userId, data = {}) {
    fields(data, []); enabled();
    const state = (await accounts.emailState(userId));
    check(state, 'FORBIDDEN', 'Use your customer or driver account.');
    if ((await allowance(state.email,'verify')) && !state.verified) (await enqueue(userId,'verify',state.email));
    return accepted();
  }
  async function queueWelcome(userId) {
    if (!mail.enabled) return false;
    const state = await accounts.emailState(userId); if (!state) return false;
    return enqueue(userId, 'welcome', state.email);
  }
  async function onRegistered(userId, { emailVerified = false } = {}) {
    if (!mail.enabled) return;
    if (emailVerified) await queueWelcome(userId);
    else await requestVerification(userId);
  }
  async function readToken(value, purpose) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
    const hash = tokens.digest(value), record = (await repository.token(hash,purpose,clock()));
    const state = record && (await accounts.emailState(record.userId));
    if (!state || record.email !== state.email || record.credentialHash !== state.passwordHash
      || (purpose === 'reset' && !state.passwordEnabled)) return invalid();
    return { hash, record, state };
  }
  async function verify(data) {
    fields(data, ['token']);
    return (await unitOfWork(async () => {
      const { hash, record } = (await readToken(data.token,'verify'));
      (await accounts.confirmEmail(record.userId, record.email));
      (await repository.deleteToken(hash));
      if (mail.enabled) (await repository.enqueue(tokens.id(),record.userId,'welcome',record.email,clock()));
      (await audit.record(record.userId,'account.email_verified',record.userId,clock()));
      return { verified: true };
    }));
  }
  async function reset(data) {
    fields(data, ['token','password']); const password = passwordInput(data.password);
    (await readToken(data.token,'reset'));
    const passwordHash = await passwords.hash(password);
    return (await unitOfWork(async () => {
      // Re-read after hashing: expiry, a parallel reset or a role change may win.
      const { record } = (await readToken(data.token,'reset'));
      (await accounts.replacePassword(record.userId,record.email,record.credentialHash,passwordHash));
      (await accounts.confirmEmail(record.userId,record.email));
      (await repository.deleteUserTokens(record.userId)); (await repository.deleteUserJobs(record.userId));
      if (mail.enabled) (await repository.enqueue(tokens.id(),record.userId,'changed',record.email,clock()));
      (await audit.record(record.userId,'account.password_reset',record.userId,clock()));
      return { reset: true };
    }));
  }
  async function deliverPending() {
    if (!mail.enabled || running || stopped) return;
    running = true;
    try {
      // Bound each sweep. SMTP happens outside transactions and request latency.
      for (let index = 0; index < 2 && !stopped; index++) {
        const delivery = (await unitOfWork(async () => {
          (await repository.sweep(clock()));
          const job = (await repository.due(clock())); if (!job) return null;
          const state = (await accounts.emailState(job.userId));
          if (!state || state.email !== job.email || job.createdAt + HOUR <= clock() || job.attempts >= 3
            || (job.purpose === 'verify' && state.verified) || (job.purpose === 'reset' && !state.passwordEnabled)) {
            (await repository.deleteJob(job.id)); return { skipped: true };
          }
          const lease = tokens.generate(), token = ['verify','reset'].includes(job.purpose) ? tokens.generate() : null;
          if (!await repository.claim(job.id,lease,clock())) return { skipped: true };
          if (token) (await repository.putToken({ hash: tokens.digest(token), userId: job.userId, purpose: job.purpose,
            email: state.email, credentialHash: state.passwordHash, expiresAt: clock() + (job.purpose === 'reset' ? HOUR / 2 : 24 * HOUR) }));
          return { job, lease, token };
        }));
        if (!delivery) break;
        if (delivery.skipped) continue;
        const { job, lease, token } = delivery;
        let sent = false;
        try { const state = await accounts.emailState(job.userId);
          await mail.send({ email: job.email, purpose: job.purpose, token, name: state?.name, intent: state?.startingExperience }); sent = true;
        } catch { /* Never log provider errors, recipients or links. */ }
        if (stopped) break;
        (await unitOfWork(async () => {
          if (!(await repository.owns(job.id,lease))) return;
          if (sent) {
            (await repository.deleteJob(job.id)); (await audit.record(job.userId,'account.email_accepted',job.userId,clock()));
          } else {
            if (token) (await repository.deleteToken(tokens.digest(token)));
            if (job.attempts >= 2) { (await repository.deleteJob(job.id)); (await audit.record(job.userId,'account.email_failed',job.userId,clock())); }
            else (await repository.retry(job.id, clock() + (job.attempts + 1) * 60_000));
          }
        }));
      }
    } finally { running = false; }
  }
  return Object.freeze({ settings, status, requestReset, requestVerification, onRegistered, verify, reset, deliverPending,
    async stop() { stopped = true; (await mail.close()); } });
}
