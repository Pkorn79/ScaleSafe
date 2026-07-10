# External Evidence Security and Troubleshooting

## Tenant Isolation

- Tenant identity comes from the connection credential.
- Payload `location_id`, merchant IDs, and offer IDs cannot change tenant context.
- Enrollment references are checked inside the credential's location.
- Events that cannot resolve to exactly one enrollment are quarantined internally.

## Stored Data

ScaleSafe stores a sanitized source payload, its SHA-256 snapshot, the normalized event, source and receipt timestamps, authentication method, match method, and publication result. Passwords, access tokens, API keys, authorization headers, card data, and bank data are redacted from payloads and logs.

Payload hashing records the received snapshot. It is not marketed as a full append-only hash chain.

## Attachments

- Remote files must use HTTPS and an approved connection domain.
- Remote URLs cannot contain credentials or query tokens; use the signed upload endpoint for protected files.
- Private, loopback, link-local, and embedded-credential URLs are rejected.
- Redirect destinations are revalidated.
- File size, declared MIME type, and file signature must agree.
- Files remain in private ScaleSafe storage and are accessed with short-lived signed URLs.

## Event Statuses

- `received` / `verified`: accepted and awaiting processing.
- `resolving`: leased by a worker.
- `published`: enrollment-scoped evidence created, or a synthetic test validated.
- `retrying`: enrollment may not exist yet; ScaleSafe will retry.
- `quarantined`: no exact enrollment could be established or processing repeatedly failed.
- `rejected`: schema, mapping, or event type was invalid.

ScaleSafe HQ shows quarantined and rejected details. Merchants see connection health and successful evidence but do not repair individual events.
