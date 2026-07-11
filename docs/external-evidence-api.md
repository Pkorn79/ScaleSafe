# Canonical External Evidence API

## Authentication

Send the API key issued by the ScaleSafe operator during assisted setup:

```http
Authorization: Bearer ss_ev_...
Content-Type: application/json
```

API keys are tenant-bound, revocable, rate-limited, and shown only when created or rotated.
They belong on the integrating company's server and must never be placed in browser JavaScript.

## Create Enrollment Link

`POST https://dashboard.scalesafe.app/api/v1/evidence/enrollment-links`

```json
{
  "request_id": "stable-idempotency-key",
  "external_contact_id": "customer_456",
  "external_enrollment_id": "purchase_789",
  "resource": {
    "type": "subscription_tier",
    "id": "tier_pro"
  },
  "expires_in_days": 7
}
```

The resource must already have an HQ-approved ScaleSafe offer mapping. ScaleSafe returns that offer's full-enrollment or quick-checkout URL with an opaque `evidenceContextToken`. The token contains no client PII, defaults to seven days, and may be configured from 1 to 30 days.

Repeating the same `request_id` with the same details returns the same active link. A consumed, expired, revoked, wrong-tenant, or changed request fails closed. Use a new `request_id` for a genuinely new link.

## Bind Existing Enrollment

Approved server integrations that already possess a ScaleSafe enrollment reference may call:

`POST https://dashboard.scalesafe.app/api/v1/evidence/subjects/bind`

```json
{
  "enrollment_ref": "opaque-scalesafe-reference",
  "external_contact_id": "customer_456",
  "external_enrollment_id": "purchase_789"
}
```

The enrollment reference must belong to the API key's sub-account. This endpoint cannot create contacts or enrollments.

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

After an enrollment-link context binds, use `subject.external_enrollment_id` for future events. ScaleSafe may also resolve a persisted external contact identity plus approved resource. Exact email plus mapped offer is a one-time bootstrap only when exactly one eligible enrollment exists. Ambiguous events never become evidence.

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
