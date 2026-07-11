# Universal Evidence Connector: Assisted Automation Plan

**Implementation status (2026-07-10):** Implemented in code behind migration 090 and `EVIDENCE_CONNECTOR_AUTOMATION_ENABLED`. Migration review/application and live test-sub-account certification remain required before deployment.

## Objective

Turn the connector foundation into an operator-managed, automatic evidence system. Merchants should not configure payload paths, map individual events, repair quarantined records, or revisit the connection after onboarding.

ScaleSafe must still bind every event deterministically to one tenant and one enrollment. It must never guess the newest enrollment or silently attach evidence to the wrong program.

## Product Truth

No universal connector can infer the meaning of arbitrary third-party data without one of these anchors:

1. A ScaleSafe enrollment reference carried by the outside system.
2. A stable external client/enrollment identity plus a resource-to-offer association.
3. A named provider adapter that discovers those identities and resources through the provider API.

The merchant does not need to perform this work. During beta, ScaleSafe/WholePay performs the one-time setup in ScaleSafe HQ. Named adapters can later replace operator setup with OAuth and guided discovery.

## Connection Paths

### Custom Software and Canonical API

The merchant's server creates a ScaleSafe enrollment link using its own customer ID, purchase/enrollment ID, and external product or tier ID. ScaleSafe returns the correct offer URL with a short-lived signed integration context.

When the client enrolls, ScaleSafe consumes that context and permanently binds the outside identities to the exact ScaleSafe enrollment. Future evidence events use those stable outside IDs and resolve automatically, even if the client's email changes.

### Generic Raw Webhook

ScaleSafe/WholePay configures the webhook once in HQ using sample payloads. The operator defines safe mapping rules and associates each external product, course, calendar, or service with one ScaleSafe offer. The first exact identity match is persisted. Every later event resolves automatically.

The merchant sees health and recent activity, not payload paths or mapping controls.

### Named Provider Adapter

A future adapter uses OAuth, provider signatures, resource discovery, and API enrichment. ScaleSafe discovers products and customers, proposes associations, and activates them after one setup confirmation. Named Zoom, Meet, LMS, or course-platform adapters remain outside this development pass.

## Phase A: Correct the Current Experience

- Show the client, program, enrollment, match method, and source event ID on every Recent Events row, including test events.
- Preserve and display the enrollment selected for the most recent test.
- Add a clear test result panel: tenant matched, enrollment matched, evidence suppressed because the event was a test.
- Remove raw mapping, credential rotation, and resource-mapping controls from the default merchant experience.
- Replace the merchant page with connection status, last successful activity, published count, and a simple needs-attention state.
- Keep advanced developer/API controls owner-only and hidden by default.
- Keep full setup controls in ScaleSafe HQ with audit logging.

Primary files:

- `src/controllers/evidence-connector.controller.ts`
- `src/repositories/evidence-connector.repository.ts`
- `src/ui/src/views/EvidenceConnectionsView.vue`
- `src/routes/hq-admin.routes.ts`

## Phase B: ScaleSafe HQ Setup Wizard

Build an operator-only guided setup flow:

1. Select the sub-account.
2. Choose canonical API or raw webhook.
3. Generate the credential and securely hand it to the merchant's developer or install it during assisted setup.
4. Capture one or more sample payloads without publishing evidence.
5. Configure safe ordered mapping rules.
6. Extract external resource IDs from samples or provider discovery.
7. Suggest offer associations by exact identifiers or normalized names; require one operator confirmation before activation.
8. Select the identity strategy: ScaleSafe context, external enrollment ID, external contact plus resource, or exact email plus resource bootstrap.
9. Run tenant and enrollment tests.
10. Activate the connection.

Connections remain inactive while incomplete. Invalid samples or ambiguous offer associations cannot be activated.

## Phase C: Automatic Enrollment Binding

Add a server-to-server enrollment-link endpoint:

`POST /api/v1/evidence/enrollment-links`

Authentication uses the connection's API key. The connection determines the tenant; payload tenant IDs are ignored.

Request:

```json
{
  "request_id": "stable-idempotency-key",
  "external_contact_id": "customer_456",
  "external_enrollment_id": "purchase_789",
  "resource": {
    "type": "subscription_tier",
    "id": "tier_pro"
  }
}
```

The optional `expires_in_days` accepts 1-30 days and defaults to 7. Repeating the same `request_id` returns the same active link; callers must use a new request ID after a context is consumed or expires.

ScaleSafe resolves the resource through the approved mapping and returns the correct ScaleSafe enrollment URL with a short-lived signed context token. The outside software places that URL behind its signup or purchase button.

The context is preserved through the ScaleSafe funnel. When the enrollment exists, ScaleSafe atomically consumes the context and creates the external identity bindings. Future events resolve from external IDs without merchant action.

Add an internal binding endpoint for approved adapters that already know a ScaleSafe enrollment reference:

`POST /api/v1/evidence/subjects/bind`

It may bind only an enrollment reference belonging to the credential-derived tenant.

Primary files:

- `src/routes/evidence-connector.routes.ts`
- `src/controllers/evidence-connector.controller.ts`
- `src/services/evidence-connection.service.ts`
- `src/repositories/evidence-connector.repository.ts`
- `src/services/enrollment.service.ts`
- `src/controllers/enrollment.controller.ts`
- `src/routes/enrollment.routes.ts`
- enrollment widget scripts that preserve funnel query context

## Phase D: Data Changes

Use migration 090 after reviewing live schema.

Extend `evidence_connections` with:

- `setup_status`: draft, testing, active, needs_attention, disabled
- `setup_mode`: operator_managed, developer_api, native_adapter
- `identity_strategy`
- `activated_at`
- `configured_by`

Extend `evidence_resource_mappings` with:

- provider/resource metadata
- proposed match confidence
- approval timestamp and approver

Extend `evidence_subject_identities` with:

- binding method
- source context ID
- verification metadata

Create `evidence_enrollment_contexts` with:

- tenant and connection ownership
- external contact, enrollment, and resource IDs
- resolved ScaleSafe offer
- hashed single-use context token
- expiration and consumption timestamps
- final ScaleSafe enrollment ID

The context token is single-use, short-lived, tenant-bound, and cannot select an arbitrary offer.

## Phase E: Developer Package

Provide a small server-side SDK after the REST flow is certified:

- initialize with the connection API key
- create an enrollment link
- send canonical evidence events
- generate stable event IDs
- retry safe failures without duplicating evidence
- expose typed event helpers

Never place the connector API key in browser JavaScript. Browser activity must be sent through the merchant's authenticated server.

## Resolution Rules

Keep the current strict order:

1. ScaleSafe enrollment reference.
2. Persisted external enrollment identity.
3. Persisted external contact identity plus approved resource mapping.
4. Exact normalized email plus approved offer only when exactly one eligible enrollment exists.
5. Otherwise quarantine internally.

Quarantine is an integration-health signal for ScaleSafe operators. It is not a merchant event-mapping inbox. Fixes apply to the connection configuration or identity binding and then replay affected events.

## Merchant Experience

The merchant sees:

- Connected or Needs Attention
- source/platform name
- last evidence received
- recent published evidence count
- programs receiving evidence
- contact support/request setup action

The merchant does not see:

- dot-path mapping rules
- raw payloads
- quarantined event repair controls
- cross-tenant diagnostics
- credential hashes or encrypted secrets

Developer customers may receive a separately gated server integration panel and documentation.

## Acceptance Tests

- The test result continues to display the selected client and program after processing.
- A merchant cannot access raw mapper or cross-tenant setup controls.
- HQ can configure and activate a connection for a chosen sub-account.
- A custom app creates an enrollment link using external IDs and a mapped resource.
- Completing that link binds the exact ScaleSafe enrollment automatically.
- Later events resolve after the client's email changes.
- The same email in two sub-accounts never crosses tenants.
- Two enrollments for the same email and offer never cause newest-enrollment guessing.
- Repeated enrollment in the same offer resolves through the external enrollment ID.
- Invalid, expired, reused, wrong-tenant, or wrong-resource context tokens fail closed.
- Generic raw events publish without merchant intervention after one HQ setup.
- A corrected mapping can replay quarantined intake idempotently.
- Test events remain visible in diagnostics and absent from evidence and defense packets.
- Existing GHL, payment, pulse, milestone, and defense behavior remains unchanged.

## Rollout

1. Ship Phase A first so the test UI reports what actually happened.
2. Build HQ setup and enrollment contexts behind an internal feature flag.
3. Certify in the new GHL test sub-account.
4. Certify a raw webhook and a custom-software enrollment-link flow.
5. Run cross-tenant and repeated-enrollment tests.
6. Enable the existing test-heavy sub-account for regression.
7. Onboard one assisted beta merchant.
8. Document the exact operator setup process before broader beta.

CSV imports, generic polling, and named providers remain deferred. They can use the same intake, identity, and evidence pipeline later.
