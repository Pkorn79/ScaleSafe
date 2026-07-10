# Canonical External Evidence API

## Authentication

Send the API key created under **Settings > Evidence Connections**:

```http
Authorization: Bearer ss_ev_...
Content-Type: application/json
```

API keys are tenant-bound, revocable, rate-limited, and shown only when created or rotated.

## Create Event

`POST https://dashboard.scalesafe.app/api/v1/evidence/events`

```json
{
  "schema_version": "1.0",
  "event_id": "provider-event-123",
  "event_type": "session.completed",
  "occurred_at": "2026-07-10T14:30:00Z",
  "subject": {
    "enrollment_ref": "the-reference-issued-by-scalesafe"
  },
  "resource": {
    "type": "coaching_session",
    "id": "session_123",
    "name": "Implementation Call"
  },
  "actor": {
    "type": "client",
    "external_id": "customer_456"
  },
  "activity": {
    "status": "completed",
    "duration_seconds": 3600,
    "description": "Client attended the scheduled implementation call."
  },
  "attachments": [],
  "metadata": {}
}
```

Successful intake returns `202 Accepted`. Replaying the same `event_id` on the same connection returns the existing event without creating duplicate evidence.

The recommended identity is `subject.enrollment_ref`. When a managed resource mapping is configured, ScaleSafe may also resolve an existing external enrollment identity or an exact email plus mapped offer. Ambiguous events never become evidence.

## Prepare Attachment

`POST https://dashboard.scalesafe.app/api/v1/evidence/attachments`

```json
{
  "filename": "attendance.pdf",
  "content_type": "application/pdf"
}
```

Upload the file to the returned signed URL, then include the returned `attachmentId` in the evidence event:

```json
{
  "attachments": [{ "attachment_id": "attachment-uuid", "label": "Attendance report" }]
}
```

Allowed formats are PDF, PNG, JPEG, TXT, and CSV, up to 10 MB.

## Responses

- `202`: accepted for asynchronous validation and publication.
- `200`: duplicate event already accepted.
- `400`: invalid event schema.
- `401`: missing, invalid, expired, or disabled credential.
- `429`: connection rate limit exceeded.
