/** Notification payloads select a review screen, never confer access to a person or trip. */
export function pushTarget(data: unknown): { kind: 'family'; eventId: string } | { kind: 'journey'; notificationId: number } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.kind === 'family') return typeof value.eventId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.eventId)
    ? { kind: 'family', eventId: value.eventId } : null;
  if (Number.isSafeInteger(value.notificationId) && Number(value.notificationId) > 0) return { kind: 'journey', notificationId: Number(value.notificationId) };
  return null;
}
