# Troubleshooting

Start with the visible symptom and exact timestamp. Inspect matching Railway logs before changing code or configuration.

## ScaleSafe Does Not Open

1. Confirm the intended GHL sub-account, not agency view.
2. Check `https://dashboard.scalesafe.app/health` once.
3. Inspect `/auth/sso` at the exact time.

No trusted parent location context is not permission to choose another account. Reinstall only when ScaleSafe proves the location installation is missing or revoked, not for a temporary dependency error.

## Unexpected Install Error

Collect the final install response plus Railway logs for OAuth/install routes. Confirm whether GHL supplied location context and whether the location merchant record was created. Do not apply successive speculative fixes or add an agency-wide selector.

## Checkout Or QMS Does Not Load

Confirm active offer, entitlement, processor ownership/configuration, and the relevant config route. Do not submit repeatedly after an ambiguous timeout; inspect durable idempotency/reconciliation state.

## Payment Missing Or Misclassified

Compare processor ID, payment-event ID, enrollment ID, and subscription/membership ID. Confirm contact identity and offer metadata. Do not borrow another program from the same contact or repair before processor truth is known.

## Workflow Did Not Send

Prove separately:

1. ScaleSafe trigger delivery.
2. GHL workflow entry.
3. GHL action state: executed, waiting, skipped, or failed.
4. Communication record.
5. Inbox delivery.

Check re-entry, send windows, deleted trigger subscriptions, and scalar merge fields. `[object Object]` means the workflow used an object rather than a documented scalar field.

## Pulse Did Not Arrive Or Arrived Too Often

Confirm offer cadence, offer active state, enrollment status, next due time, subscription, GHL filter, re-entry, and send window. Distinguish already queued GHL executions from new ScaleSafe schedules. Archiving an offer must disable its enrollment pulse schedules.

## Evidence Is Unlinked

Unlinked means ScaleSafe cannot prove one exact enrollment. Check explicit enrollment selection, provider identity, mapped resource, and overlapping program dates. Never default to newest enrollment. Quarantined/unlinked evidence stays outside enrollment-scoped defense packets.

## Zoom Connected Without Evidence

Confirm a non-host participant event was observed and resolved to one contact/enrollment. OAuth success alone is not evidence publication.

## Defense Needs Review

Read the stored review reasons. Check selected transaction, enrollment scope, reason code, chronology, delivery, signed packet, amounts, AI fallback, and PDF availability. Do not clear the warning by marking submitted.

## Production Slow Or Unavailable

Check health, Supabase resource state, Railway requests over three seconds, worker/queue warnings, webhook failures, and recent deploy status. Static app success with database route failure indicates a dependency incident, not necessarily a broken GHL install.

## Escalation Record

Include:

- Timestamp and timezone.
- GHL location and visible screen.
- Client/offer/enrollment IDs when safe.
- Route and status.
- Processor or GHL execution ID when relevant.
- Sanitized log excerpt.
- Expected versus actual result.
- Whether retrying could duplicate money or communication.
