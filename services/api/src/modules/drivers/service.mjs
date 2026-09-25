import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { hasCapability, requireRole } from '../../shared/policies.mjs';
import { applicationDetails, documentExpiry, eligibility, canonical } from './domain.mjs';
import { DRIVER_REVIEW_CHECKS } from '../../../../../packages/shared/src/driver-onboarding.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


/** Manual review records evidence; it does not perform external identity checks. */
export function createDriversService({ repository, getAccount, hasDriverWork, codec, tokens, unitOfWork, audit, clock }) {
  async function access(user, id) {
    check(user?.role === 'admin' || (hasCapability(user, 'driver') && user.id === id), 'FORBIDDEN', 'Only the applicant and administrators can access this application.');
    check(hasCapability((await getAccount(id)), 'driver'), 'NOT_FOUND', 'This Work profile has been deleted.');
    const app = (await repository.application(id));
    check(app, 'NOT_FOUND', 'Driver application not found.'); return app;
  }
  async function eligibilityFor(id) { return eligibility((await repository.application(id)), (await repository.documents(id)), clock()); }
  async function view(user, id) {
    const app = (await access(user, id)), read = user.role === 'admin' ? (await repository.readIds(id, user.id)) : [];
    const documents = (await repository.documents(id)).map((doc) => ({ ...doc, readByReviewer: read.includes(doc.id) }));
    return { ...app, vehicle: app.details?.vehicle ?? (await repository.selection(id)) ?? (await repository.find(id)).vehicle,
      name: (await getAccount(id)).name, documents, eligibility: eligibility(app, documents, clock()),
      busy: (await hasDriverWork(id)), events: (await repository.events(id)) };
  }
  async function list(user) {
    requireRole(user, 'admin');
    return (await asyncMap((await repository.list()), async (driver) => ({ ...driver, name: (await getAccount(driver.id)).name,
      applicationStatus: (await repository.application(driver.id)).status, eligibility: (await eligibilityFor(driver.id)) })));
  }
  function editable(app) {
    check(['draft', 'changes_requested', 'rejected'].includes(app.status), 'APPLICATION_LOCKED', 'Reopen the application before changing it. Approval will need to be recorded again.');
  }
  function ready(app, documents, now) {
    const state = eligibility(app, documents, now);
    check(app.details && !state.missing.length && !state.expired.length, 'APPLICATION_INCOMPLETE', 'Complete the details and upload all five current documents before submitting or approving.');
    // Recheck old drafts/submissions against today's policy without rewriting approved history.
    applicationDetails(app.details, now);
  }
  async function command(user, id, action, data, key) {
    (await access(user, id));
    if (action === 'review') { requireRole(user, 'admin'); check(user.id !== id, 'FORBIDDEN', 'You cannot review your own application.'); }
    else check(hasCapability(user, 'driver') && user.id === id, 'FORBIDDEN', 'Only the applicant can change the application.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const allowed = { save: ['details'], upload: ['kind', 'name', 'mimeType', 'base64', 'expiresOn'],
      remove: ['documentId'], submit: [], reopen: [], review: ['decision', 'reason', 'reference', 'checks'] }[action];
    check(allowed, 'NOT_FOUND', 'Application action not found.');
    fields(data, ['expectedVersion', ...allowed], action === 'review' ? ['expectedVersion', 'decision', 'reason'] : ['expectedVersion', ...allowed]);
    check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Use the application version shown on screen.');
    const fingerprint = tokens.digest(canonical({ id, action, data }));
    return (await unitOfWork(async () => {
      const app = (await access((await getAccount(user.id)), id)), previous = (await repository.command(user.id, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { application: (await view(user, id)), replayed: true };
      }
      check(app.version === data.expectedVersion, 'STALE_VERSION', 'The application changed. Refresh and review the current version.');
      check(!(await hasDriverWork(id)), 'DRIVER_BUSY', 'Finish or cancel assigned work before changing or reviewing the application.');
      const now = clock(); let event = {};
      if (['save', 'upload', 'remove'].includes(action)) {
        editable(app);
        if (action === 'save') {
          const next = applicationDetails(data.details, now);
          const vehicleIdentity = (vehicle) => canonical({ ...vehicle, category: vehicle.category ?? 'standard', payloadKg: vehicle.payloadKg ?? null });
          if (app.details && vehicleIdentity(app.details.vehicle) !== vehicleIdentity(next.vehicle)) {
            const old = (await repository.documents(id)).filter((doc) => ['vehicle_registration', 'insurance', 'vehicle_photo'].includes(doc.kind));
            for (const doc of old) (await repository.removeDocument(doc.id));
            event = { replacedVehicleDocumentIds: old.map((doc) => doc.id) };
          }
          app.details = next;
        }
        if (action === 'upload') {
          const expiresOn = documentExpiry(data.kind, data.expiresOn), file = codec.decode(data);
          const old = (await repository.documents(id)).find((doc) => doc.kind === data.kind);
          check((await repository.storageBytes()) - (old?.sizeBytes ?? 0) + file.sizeBytes <= 128 * 1024 * 1024,
            'DOCUMENT_STORAGE_FULL', 'Document storage is full. Contact the administrator.');
          if (old) (await repository.removeDocument(old.id));
          const documentId = tokens.id();
          (await repository.insertDocument({ ...file, id: documentId, driverId: id, kind: data.kind, expiresOn, now }));
          event = { documentId, kind: data.kind, sha256: file.sha256, replacedId: old?.id ?? null };
        }
        if (action === 'remove') {
          check(typeof data.documentId === 'string' && /^[a-f0-9-]{36}$/.test(data.documentId), 'INVALID_DOCUMENT', 'Choose a document.');
          const doc = (await repository.document(data.documentId));
          check(doc?.driverId === id, 'NOT_FOUND', 'Document not found.');
          (await repository.removeDocument(doc.id)); event = { documentId: doc.id, kind: doc.kind };
        }
        app.status = 'draft'; app.verification = null;
      } else if (action === 'reopen') {
        check(['approved', 'submitted', 'rejected', 'changes_requested'].includes(app.status), 'APPLICATION_LOCKED', 'This application is already a draft.');
        app.status = 'draft'; app.verification = null;
      } else if (action === 'submit') {
        editable(app); ready(app, (await repository.documents(id)), now);
        app.status = 'submitted'; app.submittedAt = now; app.verification = null;
      } else {
        check(app.status === 'submitted', 'APPLICATION_LOCKED', 'Only a submitted application can be reviewed.');
        check(['approved', 'rejected', 'changes_requested'].includes(data.decision), 'INVALID_DECISION', 'Approve, reject or request corrections.');
        const reason = label(data.reason, 'Review reason', 10, 1000);
        if (data.decision === 'approved') {
          const documents = (await repository.documents(id)); ready(app, documents, now);
          fields(data.checks, Object.keys(DRIVER_REVIEW_CHECKS));
          check(Object.values(data.checks).every((value) => value === true), 'INVALID_REVIEW', 'Record all four manual checks before approval.');
          const read = (await repository.readIds(id, user.id));
          check(documents.every((doc) => read.includes(doc.id)), 'INVALID_REVIEW', 'Download and inspect every current document before approval.');
          app.verification = { method: 'manual', reference: label(data.reference, 'Verification reference', 5, 200),
            checks: { ...data.checks }, documents: documents.map(({ id, kind, sha256, expiresOn }) => ({ id, kind, sha256, expiresOn })),
            reviewerId: user.id, checkedAt: now };
        } else app.verification = null;
        app.status = data.decision; app.reviewedAt = now; app.reviewedBy = user.id; app.reviewReason = reason;
        event = { reason, details: app.details, verification: app.verification };
      }
      app.version++; app.updatedAt = now;
      (await repository.save(app));
      (await repository.setProfile(id, app.status === 'approved' ? 'approved' : app.status === 'rejected' ? 'rejected' : 'pending',
        app.status === 'approved' ? app.details : null, action === 'review' ? user.id : null, now));
      (await repository.event(id, user.id, action === 'review' ? app.status : action, app.version, event, now));
      (await audit.record(user.id, `driver.application.${action === 'review' ? app.status : action}`, id, now));
      (await repository.saveCommand(user.id, key, fingerprint, id));
      return { application: (await view(user, id)), replayed: false };
    }));
  }
  async function download(user, documentId) {
    return (await unitOfWork(async () => {
      const doc = (await repository.document(documentId));
      check(doc && (user?.role === 'admin' || (hasCapability(user, 'driver') && user.id === doc.driverId)), 'NOT_FOUND', 'Document not found.');
      if (user.role === 'admin') (await repository.readDocument(documentId, user.id, clock()));
      (await audit.record(user.id, 'driver.document.downloaded', documentId, clock()));
      return { document: { ...doc, downloadName: `${doc.kind}-${doc.id}.${doc.mimeType === 'image/png' ? 'png' : 'jpg'}` },
        base64: codec.encode((await repository.content(documentId))) };
    }));
  }
  return Object.freeze({ list, get: view, command, download, eligibilityFor });
}
