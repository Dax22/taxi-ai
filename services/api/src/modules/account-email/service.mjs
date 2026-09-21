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
  function status(userId) {
    const state = accounts.emailState(userId);
    check(state, 'FORBIDDEN', 'Use your customer or driver account.');
    return { enabled: mail.enabled, verified: state.verified, email: state.email };
  }
  function allowance(email, purpose) {
    try {
      // Apply the same private mailbox limits to existing and unknown addresses.
      rateLimiter.consume(`email-minute:${purpose}:${email}`, clock(), 1, 60_000);
      rateLimiter.consume(`email-hour:${purpose}:${email}`, clock(), 3, HOUR);
      return true;
    } catch (error) { if (error.code === 'RATE_LIMITED') return false; throw error; }
  }
  function enqueue(userId, purpose, email) {
    return unitOfWork(() => {
      if (repository.countJobs() >= 1000) return false;
      repository.enqueue(tokens.id(),userId,purpose,email,clock()); return true;
    });
  }
  function requestReset(data) {
    fields(data, ['email']); const email = emailAddress(data.email); enabled();
    const allowed = allowance(email, 'reset');
    const state = accounts.emailStateForAddress(email);
    if (allowed && state?.passwordEnabled) enqueue(state.id,'reset',email);
    return accepted(); // No account existence, delivery result or token is exposed.
  }
  function requestVerification(userId, data = {}) {
    fields(data, []); enabled();
    const state = accounts.emailState(userId);
    check(state, 'FORBIDDEN', 'Use your customer or driver account.');
    if (allowance(state.email,'verify') && !state.verified) enqueue(userId,'verify',state.email);
    return accepted();
  }
  function onRegistered(userId) { if (mail.enabled) requestVerification(userId); }
  function readToken(value, purpose) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
    const hash = tokens.digest(value), record = repository.token(hash,purpose,clock());
    const state = record && accounts.emailState(record.userId);
    if (!state || record.email !== state.email || record.credentialHash !== state.passwordHash
      || (purpose === 'reset' && !state.passwordEnabled)) return invalid();
    return { hash, record, state };
  }
  function verify(data) {
    fields(data, ['token']);
    return unitOfWork(() => {
      const { hash, record } = readToken(data.token,'verify');
      accounts.confirmEmail(record.userId, record.email);
      repository.deleteToken(hash);
      audit.record(record.userId,'account.email_verified',record.userId,clock());
      return { verified: true };
    });
  }
  async function reset(data) {
    fields(data, ['token','password']); const password = passwordInput(data.password);
    readToken(data.token,'reset');
    const passwordHash = await passwords.hash(password);
    return unitOfWork(() => {
      // Re-read after hashing: expiry, a parallel reset or a role change may win.
      const { record } = readToken(data.token,'reset');
      accounts.replacePassword(record.userId,record.email,record.credentialHash,passwordHash);
      accounts.confirmEmail(record.userId,record.email);
      repository.deleteUserTokens(record.userId); repository.deleteUserJobs(record.userId);
      if (mail.enabled) repository.enqueue(tokens.id(),record.userId,'changed',record.email,clock());
      audit.record(record.userId,'account.password_reset',record.userId,clock());
      return { reset: true };
    });
  }
  async function deliverPending() {
    if (!mail.enabled || running || stopped) return;
    running = true;
    try {
      // Bound each sweep. SMTP happens outside transactions and request latency.
      for (let index = 0; index < 2 && !stopped; index++) {
        const delivery = unitOfWork(() => {
          repository.sweep(clock());
          const job = repository.due(clock()); if (!job) return null;
          const state = accounts.emailState(job.userId);
          if (!state || state.email !== job.email || job.createdAt + HOUR <= clock() || job.attempts >= 3
            || (job.purpose === 'verify' && state.verified) || (job.purpose === 'reset' && !state.passwordEnabled)) {
            repository.deleteJob(job.id); return { skipped: true };
          }
          const lease = tokens.generate(), token = job.purpose === 'changed' ? null : tokens.generate();
          repository.claim(job.id,lease,clock());
          if (token) repository.putToken({ hash: tokens.digest(token), userId: job.userId, purpose: job.purpose,
            email: state.email, credentialHash: state.passwordHash, expiresAt: clock() + (job.purpose === 'reset' ? HOUR / 2 : 24 * HOUR) });
          return { job, lease, token };
        });
        if (!delivery) break;
        if (delivery.skipped) continue;
        const { job, lease, token } = delivery;
        let sent = false;
        try { await mail.send({ email: job.email, purpose: job.purpose, token }); sent = true; } catch { /* Never log provider errors, recipients or links. */ }
        if (stopped) break;
        unitOfWork(() => {
          if (!repository.owns(job.id,lease)) return;
          if (sent) {
            repository.deleteJob(job.id); audit.record(job.userId,'account.email_accepted',job.userId,clock());
          } else {
            if (token) repository.deleteToken(tokens.digest(token));
            if (job.attempts >= 2) { repository.deleteJob(job.id); audit.record(job.userId,'account.email_failed',job.userId,clock()); }
            else repository.retry(job.id, clock() + (job.attempts + 1) * 60_000);
          }
        });
      }
    } finally { running = false; }
  }
  return Object.freeze({ settings, status, requestReset, requestVerification, onRegistered, verify, reset, deliverPending,
    stop() { stopped = true; mail.close(); } });
}
