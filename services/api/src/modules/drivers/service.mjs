import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { applicationDetails, documentExpiry, eligibility, canonical } from './domain.mjs';
import { DRIVER_REVIEW_CHECKS } from '../../../../../packages/shared/src/driver-onboarding.mjs';

/** Manual review records evidence; it does not perform external identity checks. */
export function createDriversService({ repository, getAccount, hasDriverWork, codec, tokens, unitOfWork, audit, clock }) {
  function access(user, id) {
    check(user?.role === 'admin' || (user?.role === 'driver' && user.id === id), 'FORBIDDEN', 'Only the applicant and administrators can access this application.');
    const app = repository.application(id);
    check(app, 'NOT_FOUND', 'Driver application not found.'); return app;
  }
  function eligibilityFor(id) { return eligibility(repository.application(id), repository.documents(id), clock()); }
  function view(user, id) {
    const app = access(user, id), read = user.role === 'admin' ? repository.readIds(id, user.id) : [];
    const documents = repository.documents(id).map((doc) => ({ ...doc, readByReviewer: read.includes(doc.id) }));
    return { ...app, name: getAccount(id).name, documents, eligibility: eligibility(app, documents, clock()),
      busy: hasDriverWork(id), events: repository.events(id) };
  }
  function list(user) {
    requireRole(user, 'admin');
    return repository.list().map((driver) => ({ ...driver, name: getAccount(driver.id).name,
      applicationStatus: repository.application(driver.id).status, eligibility: eligibilityFor(driver.id) }));
  }
  function editable(app) {
    check(['draft', 'changes_requested', 'rejected'].includes(app.status), 'APPLICATION_LOCKED', 'Reopen the application before changing it. Approval will need to be recorded again.');
  }
  function ready(app, documents, now) {
    const state = eligibility(app, documents, now);
    check(app.details && !state.missing.length && !state.expired.length, 'APPLICATION_INCOMPLETE', 'Complete the details and upload all five current documents before submitting or approving.');
  }
  function command(user, id, action, data, key) {
    access(user, id);
    if (action === 'review') { requireRole(user, 'admin'); check(user.id !== id, 'FORBIDDEN', 'You cannot review your own application.'); }
    else check(user.role === 'driver' && user.id === id, 'FORBIDDEN', 'Only the applicant can change the application.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const allowed = { save: ['details'], upload: ['kind', 'name', 'mimeType', 'base64', 'expiresOn'],
      remove: ['documentId'], submit: [], reopen: [], review: ['decision', 'reason', 'reference', 'checks'] }[action];
    check(allowed, 'NOT_FOUND', 'Application action not found.');
    fields(data, ['expectedVersion', ...allowed], action === 'review' ? ['expectedVersion', 'decision', 'reason'] : ['expectedVersion', ...allowed]);
    check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Use the application version shown on screen.');
    const fingerprint = tokens.digest(canonical({ id, action, data }));
    return unitOfWork(() => {
      const app = access(getAccount(user.id), id), previous = repository.command(user.id, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { application: view(user, id), replayed: true };
      }
      check(app.version === data.expectedVersion, 'STALE_VERSION', 'The application changed. Refresh and review the current version.');
      check(!hasDriverWork(id), 'DRIVER_BUSY', 'Finish or cancel assigned work before changing or reviewing the application.');
      const now = clock(); let event = {};
      if (['save', 'upload', 'remove'].includes(action)) {
        editable(app);
        if (action === 'save') app.details = applicationDetails(data.details);
        if (action === 'upload') {
          const expiresOn = documentExpiry(data.kind, data.expiresOn), file = codec.decode(data);
          const old = repository.documents(id).find((doc) => doc.kind === data.kind);
          check(repository.storageBytes() - (old?.sizeBytes ?? 0) + file.sizeBytes <= 128 * 1024 * 1024,
            'DOCUMENT_STORAGE_FULL', 'Document storage is full. Contact the administrator.');
          if (old) repository.removeDocument(old.id);
          const documentId = tokens.id();
          repository.insertDocument({ ...file, id: documentId, driverId: id, kind: data.kind, expiresOn, now });
          event = { documentId, kind: data.kind, sha256: file.sha256, replacedId: old?.id ?? null };
        }
        if (action === 'remove') {
          check(typeof data.documentId === 'string' && /^[a-f0-9-]{36}$/.test(data.documentId), 'INVALID_DOCUMENT', 'Choose a document.');
          const doc = repository.document(data.documentId);
          check(doc?.driverId === id, 'NOT_FOUND', 'Document not found.');
          repository.removeDocument(doc.id); event = { documentId: doc.id, kind: doc.kind };
        }
        app.status = 'draft'; app.verification = null;
      } else if (action === 'reopen') {
        check(['approved', 'submitted', 'rejected', 'changes_requested'].includes(app.status), 'APPLICATION_LOCKED', 'This application is already a draft.');
        app.status = 'draft'; app.verification = null;
      } else if (action === 'submit') {
        editable(app); ready(app, repository.documents(id), now);
        app.status = 'submitted'; app.submittedAt = now; app.verification = null;
      } else {
        check(app.status === 'submitted', 'APPLICATION_LOCKED', 'Only a submitted application can be reviewed.');
        check(['approved', 'rejected', 'changes_requested'].includes(data.decision), 'INVALID_DECISION', 'Approve, reject or request corrections.');
        const reason = label(data.reason, 'Review reason', 10, 1000);
        if (data.decision === 'approved') {
          const documents = repository.documents(id); ready(app, documents, now);
          fields(data.checks, Object.keys(DRIVER_REVIEW_CHECKS));
          check(Object.values(data.checks).every((value) => value === true), 'INVALID_REVIEW', 'Record all four manual checks before approval.');
          const read = repository.readIds(id, user.id);
          check(documents.every((doc) => read.includes(doc.id)), 'INVALID_REVIEW', 'Download and inspect every current document before approval.');
          app.verification = { method: 'manual', reference: label(data.reference, 'Verification reference', 5, 200),
            checks: { ...data.checks }, documents: documents.map(({ id, kind, sha256, expiresOn }) => ({ id, kind, sha256, expiresOn })),
            reviewerId: user.id, checkedAt: now };
        } else app.verification = null;
        app.status = data.decision; app.reviewedAt = now; app.reviewedBy = user.id; app.reviewReason = reason;
        event = { reason, details: app.details, verification: app.verification };
      }
      app.version++; app.updatedAt = now;
      repository.save(app);
      repository.setProfile(id, app.status === 'approved' ? 'approved' : app.status === 'rejected' ? 'rejected' : 'pending',
        app.status === 'approved' ? app.details : null, action === 'review' ? user.id : null, now);
      repository.event(id, user.id, action === 'review' ? app.status : action, app.version, event, now);
      audit.record(user.id, `driver.application.${action === 'review' ? app.status : action}`, id, now);
      repository.saveCommand(user.id, key, fingerprint, id);
      return { application: view(user, id), replayed: false };
    });
  }
  function download(user, documentId) {
    return unitOfWork(() => {
      const doc = repository.document(documentId);
      check(doc && (user?.role === 'admin' || (user?.role === 'driver' && user.id === doc.driverId)), 'NOT_FOUND', 'Document not found.');
      if (user.role === 'admin') repository.readDocument(documentId, user.id, clock());
      audit.record(user.id, 'driver.document.downloaded', documentId, clock());
      return { document: { ...doc, downloadName: `${doc.kind}-${doc.id}.${doc.mimeType === 'image/png' ? 'png' : 'jpg'}` },
        base64: codec.encode(repository.content(documentId)) };
    });
  }
  return Object.freeze({ list, get: view, command, download, eligibilityFor });
}
