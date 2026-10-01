import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';

const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const TTL_MS = 12 * 60 * 60_000;
/** A headless task can publish/stop one existing lease, never read, start a job, or renew account authentication. */
export function createBackgroundLocationService({ repository, trackerFor, nativeSessionOwner, unitOfWork, tokens, clock }) {
  const identity = row => ({ userId: row.driverId, nativeSessionId: row.sessionId, clientId: row.clientId });
  async function checked(token) {
    check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'UNAUTHENTICATED', 'Background location access has ended.');
    const row = await repository.find(tokens.digest(token));
    check(row && clock() < row.expiresAt && await nativeSessionOwner(row.sessionId) === row.driverId,
      'UNAUTHENTICATED', 'Background location access has ended. Open Taxi Ai to review the job.');
    return row;
  }
  async function issue(input, data) {
    fields(data, ['kind','jobId','shareId','clientId']);
    check(['ride','food'].includes(data.kind) && id(data.jobId) && id(data.shareId), 'INVALID_LOCATION', 'Choose an active assigned job.');
    check(id(data.clientId), 'INVALID_LOCATION_CLIENT', 'Use location controls on this phone.');
    check(typeof input.nativeSessionId === 'string', 'FORBIDDEN', 'Background tracking requires a signed-in native device.');
    return unitOfWork(async () => {
      const tracker = trackerFor(data.kind), ctx = { ...input, clientId: data.clientId };
      const current = await tracker.tracking(ctx, data.jobId), share = current.share;
      check(current.isDriver && current.canShare && share?.active && share.owned && share.id === data.shareId,
        'LOCATION_CLOSED', 'Start location sharing on this phone before enabling background updates.');
      check(await tracker.freshPositionFor(input.userId, data.jobId, clock()), 'LOCATION_REQUIRED', 'Send a fresh location before enabling background updates.');
      const token = tokens.generate(), expiresAt = clock() + TTL_MS;
      // Credential issuance rotates the prior grant; retrying never leaves two valid background credentials.
      await repository.replace({ tokenHash: tokens.digest(token), kind: data.kind, jobId: data.jobId, shareId: data.shareId,
        driverId: input.userId, sessionId: input.nativeSessionId, clientId: data.clientId, expiresAt });
      return { background: { token, expiresAt, kind: data.kind, jobId: data.jobId, shareId: data.shareId,
        clientId: data.clientId, sequence: share.sequence } };
    });
  }
  async function position(token, data) {
    return unitOfWork(async () => {
      const row = await checked(token);
      return trackerFor(row.kind).update(identity(row), row.shareId, data);
    });
  }
  async function stop(token, data) {
    fields(data, []);
    return unitOfWork(async () => {
      const row = await checked(token);
      await trackerFor(row.kind).shareCommand(identity(row), 'stop', row.shareId, {}, `background-stop-${row.tokenHash}`);
      await repository.remove(row.tokenHash);
      return { stopped: true };
    });
  }
  return { issue, position, stop, owner: async token => (await checked(token)).driverId,
    sweep: () => unitOfWork(() => repository.prune(clock())) };
}
