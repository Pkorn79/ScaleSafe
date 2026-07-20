---
name: operate-scalesafe
description: Install, configure, operate, certify, and troubleshoot ScaleSafe inside GoHighLevel merchant sub-accounts. Use for Marketplace installation, merchant onboarding, domains and email, processor connections, offers, checkout, client records, payments, workflows, pulse, milestones, evidence connections, defense packets, reviewer testing, production diagnostics, and repeatable account setup. Enforce tenant isolation, one-step-at-a-time guidance, action approvals, and evidence-backed verification.
---

# Operate ScaleSafe

Operate one ScaleSafe merchant installation safely and repeatably. Treat the current GHL `location_id` as the tenant boundary and verify outcomes across ScaleSafe, GHL, processors, and logs.

## Select The Workflow

- For a new merchant or reviewer sub-account, read `references/onboarding.md`.
- For offers, clients, payments, pulse, milestones, evidence, or defenses, read `references/operations.md`.
- For a smoke test, reviewer test, or launch certification, read `references/certification.md`.
- For an error or unexpected result, read `references/troubleshooting.md` before changing anything.

Load only the references needed for the current task.

## Establish Context

Before acting:

1. Identify the visible GHL agency, sub-account name, and trusted location ID.
2. State which location will be read or changed.
3. Confirm whether the processor/environment is test or live when money is involved.
4. Distinguish the requested mode:
   - **Guide:** give exactly one concrete step, then wait for the result.
   - **Operate:** perform authorized steps, reporting meaningful progress.
   - **Audit:** make no mutations and return evidence-backed findings.
5. Preserve any user work already in progress.

If GHL opens ScaleSafe without trusted location context, stop. Never solve this by selecting another merchant or accepting a location ID supplied by a public payload.

## Apply The Safety Boundary

Proceed without an extra confirmation only when the user's current request clearly authorizes the exact action and destination.

Require action-time approval before:

- Installing or uninstalling an app or Snapshot.
- Changing GHL, Cloudflare, DNS, email, workflow, processor, billing, or Marketplace settings.
- Creating a live charge, refund, void, subscription change, or saved payment method.
- Submitting evidence to a processor or marking a defense submitted.
- Rotating credentials, changing access, applying SQL, repairing live data, or deleting records.
- Uploading private data or credentials to another system.

Do not request approval again for each item when the user has granted a clear, narrow batch approval. Never broaden that approval silently.

## Preserve Tenant And Secret Safety

- Derive the tenant from GHL SSO, the authenticated merchant session, or a credential-bound connection.
- Keep every merchant query and action scoped by trusted `location_id`.
- Never expose or copy processor keys, OAuth tokens, service keys, card data, or webhook secrets into chat, screenshots, workflow bodies, notes, or source control.
- Never add merchant-specific location IDs, domains, processor credentials, or provider tokens to Railway. Railway holds app-level configuration only.
- Never use one merchant's processor, Zoom account, client data, or evidence to configure another merchant.
- Use fictional clients and approved inboxes for certification.
- Do not use camera or microphone permissions unless the user explicitly asks for that exact use.

## Work One Layer At A Time

For setup or troubleshooting, prove these layers in order:

1. GHL location and installation.
2. ScaleSafe merchant configuration.
3. Provider or processor connection.
4. ScaleSafe request and stored state.
5. GHL trigger acceptance and workflow execution.
6. Outbound message or processor result.
7. Enrollment-scoped evidence and defense output.

Do not infer a later layer from an earlier success. A `200` trigger response does not prove an email sent; a processor payment does not prove the correct enrollment was linked.

## Use Logs Early

For an unexpected production error:

1. Record the exact timestamp, location, client/offer, action, and visible message.
2. Inspect the matching Railway HTTP/deploy logs before proposing code changes.
3. Check processor, GHL execution, Supabase, or connector state only where the failing layer points.
4. Separate code defects from configuration gaps, missing live proof, stale queued work, and intentional limitations.

Do not make speculative fixes from screenshots alone when logs can identify the failing route.

## Verify Every Mutation

After an authorized change, verify the narrowest authoritative result:

- Reload the affected view.
- Confirm the exact merchant, client, offer, enrollment, processor ID, or workflow execution.
- Check logs for unexpected `4xx`, `5xx`, duplicate work, or background failure.
- Record sanitized proof without credentials or unnecessary client data.

For money movement, reconcile the processor result with one ScaleSafe payment event and the correct enrollment. For evidence, verify the exact enrollment rather than the newest program for the contact.

## Complete The Task

Report:

- What was changed or verified.
- The merchant location affected.
- External proof obtained.
- Anything queued, waiting, excluded, or still requiring the owner.
- The next single action when operating in Guide mode.

Never claim completion from tests alone when live configuration or external delivery still lacks proof.
