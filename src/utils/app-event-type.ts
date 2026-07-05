const APP_EVENT_TYPE_FIELDS = [
  'event_type',
  'eventType',
  'event_type_key',
  'eventTypeKey',
  'event_key',
  'eventKey',
  'app_event_type',
  'appEventType',
  'event_type_display',
  'eventTypeDisplay',
];

export function normalizeAppEventType(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function appEventTypeMatches(
  payload: Record<string, unknown> | null | undefined,
  expected: string,
): boolean {
  if (!payload) return false;
  const normalizedExpected = normalizeAppEventType(expected);
  return APP_EVENT_TYPE_FIELDS.some((field) => normalizeAppEventType(payload[field]) === normalizedExpected);
}
