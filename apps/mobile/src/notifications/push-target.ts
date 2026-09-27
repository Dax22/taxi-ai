/** Notification payloads select a review surface, never confer account, trip or announcement access. */
export function pushTarget(data: unknown):
  | { kind: 'family'; eventId: string }
  | { kind: 'journey'; notificationId: number }
  | { kind: 'announcement'; announcementId: string }
  | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.kind === 'family') return typeof value.eventId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.eventId)
    ? { kind: 'family', eventId: value.eventId } : null;
  if (value.kind === 'announcement') return typeof value.announcementId === 'string' && /^[a-f0-9-]{36}$/.test(value.announcementId)
    ? { kind: 'announcement', announcementId: value.announcementId } : null;
  if (Number.isSafeInteger(value.notificationId) && Number(value.notificationId) > 0) return { kind: 'journey', notificationId: Number(value.notificationId) };
  return null;
}
