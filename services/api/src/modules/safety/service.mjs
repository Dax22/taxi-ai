import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { MAX_CONTACTS, SHARE_MINUTES, canUseTripSafety } from '../../../../../packages/shared/src/safety.mjs';
import { commandKey, version, identifier, contactData, incidentData, noteText, canonical, notificationTransition } from './domain.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


/** Safety records are private; notification actions are an explicit local simulator. */
export function createSafetyService({ repository, getAccount, getTrip, locationForTrip, sessionOwner, nativeSessionOwner = () => null, vehicleCheckEvidence, unitOfWork, tokens, audit, clock, allowSimulation = false }) {
  const settings = Object.freeze({ mode: 'simulation', canSimulate: allowSimulation, localOnly: allowSimulation, maxContacts: MAX_CONTACTS, shareMinutes: SHARE_MINUTES });
  async function actor(id) { const user = (await getAccount(id)); check(user, 'UNAUTHENTICATED', 'Sign in to continue.'); return user; }
  function participant(user) { requireRole(user, 'customer'); }
  const envelope = (user, data) => ({ viewerId: user.id, settings, ...data });
  const contactView = (row) => row?.active ? { id: row.id, name: row.name, phone: row.phone, version: row.version, verified: false } : null;
  const linkView = (row) => row ? { id: row.id, rideId: row.rideId, active: Boolean(row.active), version: row.version,
    createdAt: row.createdAt, expiresAt: row.expiresAt, endedAt: row.endedAt, reason: row.reason } : null;
  async function ownContact(user, id, active = false) {
    const row = (await repository.contact(id)); check(row?.ownerId === user.id && (!active || row.active), 'NOT_FOUND', 'Saved contact not found.'); return row;
  }
  async function ownLink(user, id) { const row = (await repository.link(id)); check(row?.ownerId === user.id, 'NOT_FOUND', 'Trip link not found.'); return row; }
  async function incident(user, id) {
    const row = (await repository.incident(id));
    check(row && (row.reporterId === user.id || user.role === 'admin'), 'NOT_FOUND', 'Incident not found.'); return row;
  }
  function summary(row) {
    const snapshot = JSON.parse(row.snapshotJson);
    return { id: row.id, rideId: row.rideId, kind: row.kind, status: row.status, version: row.version,
      createdAt: row.createdAt, updatedAt: row.updatedAt, reporter: snapshot.reporter, acknowledgedBy: row.acknowledgedBy, resolvedAt: row.resolvedAt };
  }
  async function incidentView(row) {
    return { ...summary(row), note: row.note, snapshot: JSON.parse(row.snapshotJson), events: (await repository.incidentEvents(row.id)),
      notifications: (await asyncMap((await repository.notifications(row.id)), async (notice) => ({ id: notice.id, incidentId: notice.incidentId,
        recipientName: notice.recipientName, recipientPhone: `••••${notice.recipientPhone.slice(-4)}`, mode: notice.mode,
        status: notice.status, version: notice.version, attempts: notice.attempts, updatedAt: notice.updatedAt,
        events: (await repository.notificationEvents(notice.id)) }))) };
  }
  async function endLink(row, now, reason) {
    if (!row?.active) return;
    (await repository.endLink(row.id, now, reason)); (await audit.record(row.ownerId, `safety.link.${reason}`, row.id, now));
  }
  const linkOwner = async (binding) => binding?.startsWith('native:') ? (await nativeSessionOwner(binding.slice(7))) : (await sessionOwner(binding));
  async function invalidLink(row, now) {
    if (now >= row.expiresAt) return 'expired';
    if ((await linkOwner(row.sessionHash)) !== row.ownerId) return 'session_ended';
    if (!canUseTripSafety((await getTrip((await actor(row.ownerId)), row.rideId)).status)) return 'trip_ended';
    return null;
  }
  const sweep = async () => (await unitOfWork(async () => { const now = clock(); for (const row of (await repository.activeLinks())) { const reason = (await invalidLink(row, now)); if (reason) (await endLink(row, now, reason)); } }));
  async function contacts(userId) { const user = (await actor(userId)); participant(user); return envelope(user, { contacts: (await repository.contacts(user.id)).map(contactView) }); }
  async function trip(userId, rideId) {
    const user = (await actor(userId)); participant(user); const ride = (await getTrip(user, rideId)); (await sweep());
    return envelope(user, { rideId, canRaise: canUseTripSafety(ride.status),
      location: (await locationForTrip(rideId)), incidents: (await asyncMap((await repository.rideIncidents(rideId, user.id)), incidentView)), share: linkView((await repository.currentLink(user.id, rideId))) });
  }
  async function get(userId, id) { const user = (await actor(userId)); return envelope(user, { incident: (await incidentView((await incident(user, id)))) }); }
  async function list(userId, status = 'open', beforeId = null) {
    const user = (await actor(userId)); requireRole(user, 'admin');
    check(['all', 'open', 'acknowledged', 'resolved'].includes(status), 'INVALID_INPUT', 'Choose an incident status.');
    let before = null;
    if (beforeId !== null) { check(identifier(beforeId), 'INVALID_CURSOR', 'Invalid incident cursor.'); before = (await repository.incident(beforeId)); check(before, 'INVALID_CURSOR', 'Invalid incident cursor.'); }
    const rows = (await repository.listIncidents(before, status)), page = rows.slice(0, 20);
    return envelope(user, { status, incidents: page.map(summary), nextBefore: rows.length > 20 ? page.at(-1).id : null });
  }
  async function noticeState(row, status, attempts, user, now) {
    (await repository.updateNotification(row.id, status, attempts, now));
    (await repository.notificationEvent(row.id, user.id, status, attempts, now));
    (await audit.record(user.id, `safety.notification.${status}`, row.id, now));
  }
  async function replay(user, action, id) {
    if (action.startsWith('contact.')) return { contact: contactView((await ownContact(user, id))) };
    if (action.startsWith('link.')) return { share: linkView((await ownLink(user, id))), token: null };
    if (action === 'notification.simulate') {
      const notice = (await repository.notification(id)); check(notice, 'NOT_FOUND', 'Test notification not found.');
      return { incident: (await incidentView((await incident(user, notice.incidentId)))) };
    }
    return { incident: (await incidentView((await incident(user, id)))) };
  }
  async function command({ userId, sessionToken, nativeSessionId = null, action, id = null, data, key }) {
    commandKey(key); const fingerprint = tokens.digest(canonical({ action, id, data })); (await sweep());
    return (await unitOfWork(async () => {
      const user = (await actor(userId)), now = clock();
      if (['incident.review', 'notification.simulate'].includes(action)) requireRole(user, 'admin'); else participant(user);
      if (action === 'notification.simulate') check(allowSimulation, 'FORBIDDEN', 'Notification simulation is available only in local development.');
      const previous = (await repository.command(user.id, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another safety action.');
        return envelope(user, { ...(await replay(user, action, previous.resourceId)), replayed: true });
      }
      let resourceId = id, extra = {};
      if (action === 'contact.add') {
        const value = contactData(data), saved = (await repository.contacts(user.id));
        check(saved.length < MAX_CONTACTS, 'CONTACT_LIMIT', 'You can save up to three trusted contacts.');
        check(!saved.some((row) => row.phone === value.phone), 'CONTACT_EXISTS', 'That number is already saved.');
        resourceId = tokens.id(); (await repository.addContact(resourceId, user.id, value, now));
      } else if (action === 'contact.edit') {
        fields(data, ['name', 'phone', 'expectedVersion']);
        const row = (await ownContact(user, id, true)); version(row, data.expectedVersion);
        const value = contactData({ name: data.name, phone: data.phone });
        check(!(await repository.contacts(user.id)).some((other) => other.id !== id && other.phone === value.phone), 'CONTACT_EXISTS', 'That number is already saved.');
        (await repository.editContact(id, value));
        for (const notice of (await repository.pendingForContact(id))) (await noticeState(notice, 'cancelled', notice.attempts, user, now));
      } else if (action === 'contact.remove') {
        fields(data, ['expectedVersion']); const row = (await ownContact(user, id, true)); version(row, data.expectedVersion);
        (await repository.removeContact(id, now));
        for (const notice of (await repository.pendingForContact(id))) (await noticeState(notice, 'cancelled', notice.attempts, user, now));
      } else if (action === 'incident.create') {
        const value = incidentData(data), ride = (await getTrip(user, id));
        check(canUseTripSafety(ride.status), 'SAFETY_UNAVAILABLE', 'Test SOS is available on a confirmed trip until it ends.');
        check(!(await repository.openIncident(id, user.id)), 'INCIDENT_OPEN', 'You already have an open incident for this trip. Open its saved record.');
        check((await repository.incidentCount(id, user.id)) < 20, 'INCIDENT_LIMIT', 'This test trip has reached its incident limit.');
        const recipients = (await asyncMap(value.contactIds, async (contactId) => (await ownContact(user, contactId, true))));
        resourceId = tokens.id();
        const snapshot = { rideId: id, tripStatus: ride.status, pickup: ride.pickup, destination: ride.destination, driver: ride.driver,
          reporter: { id: user.id, name: user.name, role: ride.customerId === user.id ? 'customer' : 'driver' }, location: (await locationForTrip(id)), recordedAt: now };
        if (value.vehicleCheckId) snapshot.vehicleCheck = (await vehicleCheckEvidence(user.id,id,value.vehicleCheckId));
        (await repository.addIncident({ id: resourceId, rideId: id, reporterId: user.id, ...value, snapshot, now }));
        (await repository.incidentEvent(resourceId, user.id, 'created', '', 0, now));
        for (const contact of recipients) {
          const notificationId = tokens.id(); (await repository.addNotification(notificationId, resourceId, contact, now));
          (await repository.notificationEvent(notificationId, user.id, 'queued', 0, now));
        }
      } else if (action === 'incident.review') {
        fields(data, ['expectedVersion', 'decision', 'note']); const row = (await incident(user, id)); version(row, data.expectedVersion);
        const note = noteText(data.note, true);
        const next = { acknowledge: ['open', 'acknowledged'], resolve: ['acknowledged', 'resolved'] }[data.decision];
        check(next, 'INVALID_DECISION', 'Acknowledge or close the incident.');
        check(row.status === next[0], 'INCIDENT_CLOSED', 'This review action is not available at the current stage.');
        (await repository.reviewIncident(id, next[1], user.id, now)); (await repository.incidentEvent(id, user.id, next[1], note, row.version + 1, now));
        if (next[1] === 'resolved') for (const notice of (await repository.notifications(id))) {
          if (['queued', 'failed'].includes(notice.status)) (await noticeState(notice, 'cancelled', notice.attempts, user, now));
        }
      } else if (action === 'notification.simulate') {
        fields(data, ['expectedVersion', 'outcome']); const notice = (await repository.notification(id));
        check(notice, 'NOT_FOUND', 'Test notification not found.'); const row = (await incident(user, notice.incidentId)); version(notice, data.expectedVersion);
        const next = notificationTransition(notice, data.outcome, row.status !== 'resolved', Boolean((await repository.contact(notice.contactId))?.active && (await repository.contact(notice.contactId))?.phone === notice.recipientPhone && (await repository.contact(notice.contactId))?.name === notice.recipientName));
        (await noticeState(notice, next.status, next.attempts, user, now));
      } else if (action === 'link.create') {
        fields(data, ['minutes', 'expectedShareId']);
        check(SHARE_MINUTES.includes(data.minutes) && (data.expectedShareId === null || identifier(data.expectedShareId)), 'INVALID_INPUT', 'Choose a 15, 30 or 60 minute link and its current reference.');
        const ride = (await getTrip(user, id)); check(canUseTripSafety(ride.status), 'SAFETY_UNAVAILABLE', 'Share links are available only during a confirmed trip.');
        check(typeof sessionToken === 'string' || typeof nativeSessionId === 'string', 'UNAUTHENTICATED', 'Sign in to share a trip.');
        const sessionHash = nativeSessionId ? `native:${nativeSessionId}` : tokens.digest(sessionToken); check((await linkOwner(sessionHash)) === user.id, 'UNAUTHENTICATED', 'The sharing session expired.');
        const current = (await repository.currentLink(user.id, id));
        check((current?.id ?? null) === data.expectedShareId, 'STALE_VERSION', 'The trip link changed. Refresh before replacing it.');
        check((await repository.linkCount(user.id, id)) < 30, 'LINK_LIMIT', 'This trip has reached its test link limit.');
        (await endLink(current, now, 'replaced')); resourceId = tokens.id(); const token = tokens.generate();
        (await repository.addLink({ id: resourceId, rideId: id, ownerId: user.id, tokenHash: tokens.digest(token), sessionHash, now, expiresAt: now + data.minutes * 60_000 }));
        extra = { token }; // Returned once; only its hash is stored. Lost replies require explicit replacement.
      } else if (action === 'link.revoke') {
        fields(data, ['expectedVersion']); const row = (await ownLink(user, id)); version(row, data.expectedVersion);
        check(row.active, 'LINK_CLOSED', 'This trip link has ended.'); (await endLink(row, now, 'revoked'));
      } else check(false, 'NOT_FOUND', 'Safety action not found.');
      (await audit.record(user.id, `safety.${action}`, resourceId, now));
      (await repository.saveCommand(user.id, key, fingerprint, resourceId));
      return envelope(user, { ...(await replay(user, action, resourceId)), ...extra, replayed: false });
    }));
  }
  async function sharedTrip(data) {
    fields(data, ['token']);
    check(typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token), 'NOT_FOUND', 'This trip link is unavailable or expired.');
    (await sweep()); const row = (await repository.byToken(tokens.digest(data.token)));
    check(row, 'NOT_FOUND', 'This trip link is unavailable or expired.');
    const ride = (await getTrip((await actor(row.ownerId)), row.rideId));
    return { mode: 'preview', expiresAt: row.expiresAt, trip: { reference: ride.rideId, status: ride.status,
      pickup: ride.pickup, destination: ride.destination, driver: { name: ride.driver.name, vehicle: ride.driver.vehicle }, location: (await locationForTrip(row.rideId)) } };
  }
  // Trip closure owns this transaction. An open incident does not close itself when a trip ends.
  async function closeRide(id, now) { for (const row of (await repository.linksForRide(id))) (await endLink(row, now, 'trip_ended')); }
  return Object.freeze({ contacts, trip, get, list, command, sharedTrip, closeRide, sweep });
}
