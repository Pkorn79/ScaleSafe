# ScaleSafe Troubleshooting Guide

Start with the visible symptom, then prove each layer. A successful ScaleSafe HTTP response does not by itself prove that GHL sent an email or that a processor changed state.

## ScaleSafe Does Not Open

1. Confirm the user opened ScaleSafe from the intended GHL sub-account, not the agency view.
2. Retry once after confirming [ScaleSafe health](https://dashboard.scalesafe.app/health).
3. Record the exact time and technical error category.
4. Check Railway for `/auth/sso` at that time.

Interpretation:

- No `/auth/sso` plus `parent_context_timeout`: GHL did not return trusted location context. Do not choose another sub-account or trust a URL location parameter.
- `/auth/sso` returns a temporary-service error: wait and retry; do not uninstall a valid app.
- ScaleSafe confirms the install/location binding is missing or revoked: reinstall only that sub-account.

## Payment Information Does Not Load

1. Wait for the QMS or checkout loading state to finish.
2. Confirm the selected offer is active and assigned to a configured processor.
3. Refresh once and retry the same client/offer.
4. Record `/api/dashboard/manual-sale/config`, `/api/offers`, and the payment route status in Railway.

Do not submit repeatedly after an ambiguous timeout. ScaleSafe's durable payment claim may be waiting for reconciliation.

## A Payment Succeeded But Is Missing Or Misclassified

Compare four identifiers:

- Processor transaction/payment ID.
- ScaleSafe payment-event ID.
- Enrollment ID.
- Processor subscription or Whop membership ID when recurring.

Check Payments > Reconciliation. A one-time add-on appears on the first checkout only; it must not be counted as recurring principal. Do not repair data manually until processor truth is known.

## A Workflow Did Not Send

Check these layers separately:

1. ScaleSafe trigger delivery log: did GHL accept the app event?
2. GHL workflow execution log: did the contact enter the workflow?
3. GHL action state: executed, waiting, skipped, or failed?
4. Client communication history: was an email/SMS actually created?
5. Recipient inbox: was it delivered?

Common causes:

- The contact is still inside the workflow and GHL skips re-entry.
- A time window leaves the email action waiting until the next allowed period.
- A deleted trigger subscription is stale. Current ScaleSafe code deactivates it after GHL returns the terminal deleted-trigger error.
- A workflow template uses an object merge field rather than the documented scalar contact field.

## A Merge Field Shows `[object Object]`

Use the scalar ScaleSafe contact fields documented in `WORKFLOW_FIELD_CONTRACT_MATRIX.md`. Do not paste a whole trigger object into an email. Re-publish the workflow and run one exact-client test.

## Pulse Was Not Received

Confirm:

- The offer has pulse cadence enabled.
- The enrollment is active and `next_pulse_due_at` is due.
- The app event reached GHL.
- The workflow filter is `Event Type = Pulse Check Due`.
- The contact is not still waiting inside the workflow.
- The email action is inside its allowed send window.

Pulse diagnostics distinguish app-event delivery, outbound communication, and client submission. Treat them as separate proofs.

## Evidence Is Not Linked To A Program

`Link to Program` means ScaleSafe knows the client but cannot safely prove one exact enrollment. This is preferable to assigning evidence to the newest program.

For direct messages, select the intended enrollment before sending. For provider events, inspect the connection's match method and health. Ambiguous events must remain outside an enrollment-scoped defense packet.

## Zoom Is Connected But Shows No Evidence

Connected means OAuth succeeded. Zoom evidence requires a completed non-host participant event that can be matched to one enrollment. Confirm:

- The participant is not the Zoom host.
- The meeting/participant event was observed.
- ScaleSafe resolved one exact contact and enrollment.
- The event reached `published`, not `quarantined` or `rejected`.

## A Defense Packet Says Needs Review

Read the review reasons. Common causes are missing delivery proof, transaction/enrollment mismatch, ambiguous scope, unsupported chronology, or AI fallback. **Needs Review** is a safety state; it must not automatically fire `ss_defense_ready`.

Do not mark a packet submitted merely to clear the warning. Correct the facts, regenerate if appropriate, and compare the letter, exhibits, PDF, transaction, reason code, and actual processor deadline.

## Production Appears Slow

1. Check `/health`.
2. Check Supabase project health and resource warnings.
3. Query Railway HTTP logs for `>=400` and requests over three seconds.
4. Check worker warning/error logs and queue age.
5. Avoid opening many retrying tabs during a dependency incident.

If database-backed routes fail while the static app root loads, treat it as a dependency/availability incident rather than a GHL installation failure.
