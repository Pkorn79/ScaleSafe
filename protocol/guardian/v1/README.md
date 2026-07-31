# ScaleSafe Guardian Protocol v1

**Status:** Pre-activation v1 contract re-frozen as of 2026-07-31
**Protocol header value:** `1`
**Maximum request body:** 65,536 bytes

This contract is shared by ScaleSafe and the private ScaleSafe Guardian
repository. The alert-delivery endpoint was added before either implementation
was activated in production, then the complete version-1 contract was
re-certified and re-frozen. Future deployed version-1 semantics must not change
in place; later protocol changes require a new version.

## Endpoints

| Method | Exact path | Request body |
| --- | --- | --- |
| `GET` | `/internal/guardian/v1/snapshot` | Empty |
| `POST` | `/internal/guardian/v1/runs` | `run.schema.json` |
| `POST` | `/internal/guardian/v1/recovery-verifications` | `recovery-verification.schema.json` |
| `POST` | `/internal/guardian/v1/alert-deliveries` | `alert-delivery.schema.json` |

Query strings are forbidden. When Guardian ingestion is disabled, every path
under `/internal/guardian` returns the existing generic `404` response.

## Request Authentication

Every request includes:

- `X-ScaleSafe-Guardian-Key-Id`
- `X-ScaleSafe-Guardian-Timestamp`
- `X-ScaleSafe-Guardian-Sequence`
- `X-ScaleSafe-Guardian-Body-SHA256`
- `X-ScaleSafe-Guardian-Signature`
- `X-ScaleSafe-Guardian-Protocol: 1`

The timestamp and sequence headers are unsigned decimal integers. Sequence is in
the PostgreSQL signed `BIGINT` range and is parsed as a decimal string before
conversion so JavaScript cannot truncate it.

The body hash is lowercase hexadecimal SHA-256 over the exact raw request bytes.
For `GET`, it is the SHA-256 of an empty byte string.

The canonical UTF-8 signing input is:

```text
v1
HTTP_METHOD
EXACT_PATH
UNIX_TIMESTAMP_SECONDS
MONOTONIC_SEQUENCE
LOWERCASE_SHA256_OF_RAW_BODY
```

There is no trailing newline. The Ed25519 signature is base64url without
padding. Public keys are stored as raw 32-byte Ed25519 keys. Key IDs are opaque
UUIDs assigned by ScaleSafe.

## Verification Order

1. Reject a disabled feature or unmatched Guardian path with generic `404`.
2. Reject query strings and unsupported methods.
3. Use a Guardian-specific raw parser mounted before the application-wide JSON
   parser. Require `application/json` for `POST`, enforce the 65,536-byte limit,
   and retain the exact bytes.
4. Parse and validate all authentication headers.
5. Compare the supplied and calculated body hashes.
6. Load an active credential by key ID without exposing whether it exists.
7. Verify timestamp tolerance and Ed25519 signature.
8. Strictly validate the JSON schema and every semantic invariant.
9. Atomically claim the next sequence and write the receipt and payload.

Authentication failures return one generic response. Logs never include a
signature, raw body, public-key material, or authentication header values.

## Sequence and Retry Semantics

- The first accepted sequence for a credential is `1`.
- A new request must use `last_sequence + 1`.
- An exact retry of the last accepted method, path, sequence, and body hash
  returns the original receipt and performs no second mutation.
- Reusing a `run_id`, `verification_id`, or `delivery_id` under a new sequence with identical
  raw payload content creates a new no-op receipt linked to the original
  receipt, advances the sequence, and performs no second domain mutation.
- Reusing a logical ID with changed payload content is rejected without
  advancing the sequence.
- Reusing a sequence with different signed content is rejected.
- Lower sequences are stale.
- Higher sequences with a gap are rejected.
- Credentials rotate by overlapping two independent key IDs and sequence
  counters. A key ID and its sequence are never reset or reused.

## Payload Boundaries

- A run contains between 1 and 64 observations.
- Unknown properties are rejected.
- Timestamps use exact UTC `YYYY-MM-DDTHH:mm:ss.sssZ` syntax and must parse to
  the same instant. Completion cannot precede start; snapshot expiry must follow
  generation.
- Guardian sends allowlisted `summary_code` and `failure_code` values. It never
  sends arbitrary summaries, instructions, or raw errors. ScaleSafe generates
  display text from its own catalog.
- Fact keys, types, ranges, patterns, and enum values are allowlisted per check.
  Values are safe integers, booleans, or tightly constrained tokens. Nested
  objects, arrays, nulls, decimals, non-finite values, and unsafe integers are
  forbidden.
- `observation_count` must exactly equal the observation-array length.
- UUID and timestamp validation is semantic; JSON Schema `format` annotations
  alone are not considered validation.
- No payload may contain a location, merchant, reseller, client, enrollment,
  payment, dispute, evidence record, credential, token, raw error, or file
  contents.
- Check keys are assigned to a credential in ScaleSafe. A valid key cannot
  expand its own authority through payload fields.
- Alert reconciliation contains only allowlisted state, channel labels, and
  hashes. GHL HTTP acceptance is recorded as `accepted`; only separately
  observed outbound message proof may be recorded as `notified`.

## Snapshot Response

`GET /snapshot` is a signed-request endpoint. Its HTTPS response follows
`snapshot.schema.json` and is bound to the accepted request sequence. ScaleSafe
does not introduce a second response-signing private key in version 1.

The response contains only global aggregate state. It excludes tenant and
merchant data.

## Response Contract

Successful `POST` responses follow `ingestion-response.schema.json`. Error
responses follow `error-response.schema.json`.

| Result | HTTP | Response |
| --- | ---: | --- |
| Snapshot accepted | `200` | `snapshot.schema.json` |
| New run or recovery verification accepted | `201` | status `accepted` |
| Exact same-sequence retry | `200` | status `duplicate` |
| Same logical ID and identical body under a new sequence | `200` | status `logical_duplicate` |
| Disabled namespace, query string, or unsupported path | `404` | `NOT_FOUND` |
| Unknown/revoked key, stale timestamp, bad hash, or bad signature | `401` | `AUTHENTICATION_FAILED` |
| Body over 65,536 bytes | `413` | `PAYLOAD_TOO_LARGE` |
| POST without `application/json` | `415` | `UNSUPPORTED_MEDIA_TYPE` |
| Invalid schema or semantic invariant | `422` | `VALIDATION_FAILED` |
| Durable credential/endpoint limit exceeded | `429` | `RATE_LIMITED` |
| Stale, skipped, or changed-content sequence | `409` | `SEQUENCE_CONFLICT` |
| Reused logical ID with changed content | `409` | `LOGICAL_ID_CONFLICT` |
| Unexpected server failure | `500` | `INTERNAL_ERROR` |

Guardian advances its local sequence only after `accepted`,
`logical_duplicate`, or a verified `duplicate` response for that same sequence.
An ambiguous timeout is retried with the same sequence and exact raw body.

## Test Vectors

`test-vectors.json` is generated by
`scripts/generate-guardian-protocol-vectors.js`. It uses the published RFC 8032
test seed and must never be used as a runtime credential.

Each vector supplies the exact request bytes and headers, verification clock,
credential and prior-receipt state, expected HTTP result, and expected
post-request sequence state. Sequence values remain decimal strings throughout
the generator and both implementations.

Both repositories must execute every positive and negative vector. ScaleSafe
also runs `scripts/verify-guardian-db-vectors.js` against an isolated loopback
schema-104 database. That verifier applies migration 105 inside a transaction,
executes every vector marked `database_expectation.reaches_rpc` through the real
`claim_guardian_request` RPC, validates its database effects, and rolls back to
schema 104.
