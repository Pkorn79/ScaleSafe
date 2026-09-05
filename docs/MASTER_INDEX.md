# ScaleSafe Master Index

**Purpose:** One repository-owned source of truth for what ScaleSafe contains, what is live-certified, what still needs proof, what is planned, and which documents are authoritative.

**Last reconciled:** September 4, 2026

**Code baseline:** release candidate `adff345`; production deployment SHA must be verified before rollout

**Latest release-candidate migration:** `112_immutable_processor_config_binding.sql`

**Release stage:** Marketplace-approved controlled beta; Command Center production rollout preparation

## How To Use This Index

1. Start here for feature, plan, launch, documentation, or roadmap status.
2. Treat current code, migrations, tests, and authenticated external-system state as implementation truth.
3. Use [Project Decisions](PROJECT_DECISIONS.md) for decisions that should not be reopened without Philip.
4. Use [Open Remediation Register](user-guide/OPEN_REMEDIATION_REGISTER.md) for detailed unresolved findings, but use this index when its older baseline conflicts with newer verified work.
5. Use [Changelog](../CHANGELOG.md) for implementation history, not current product status.
6. Treat archived plans and dated audit files as history unless this index explicitly reactivates them.

Do not create another feature ledger, roadmap, or status tracker without Philip's approval. Update this file instead.

## Authority Order

When sources disagree, use this order:

1. Current code, migrations, tests, and live provider/GHL state.
2. This Master Index.
3. [Project Decisions](PROJECT_DECISIONS.md).
4. Current operating contracts and user guides linked below.
5. Current launch and remediation records.
6. Changelog and technical handoff history.
7. Plans, research, dated audits, and archived documents.

The former OneDrive `FEATURE_LEDGER.md` is retired as a source of truth. Its last reconciliation was May 11, 2026 and parts of it are malformed. Preserve it as history only.

## Status Language

| Status | Meaning |
| --- | --- |
| **Certified** | Implemented and proven through the required live or external-system path. |
| **Shipped** | Implemented in current code, but may still need a named live proof or per-merchant configuration. |
| **Partial** | Foundation exists, but an important capability, provider approval, rollout, or proof remains. |
| **Owner action** | Code is not the blocker; Philip must complete or approve an external step. |
| **Planned** | Approved future work that is not represented as available. |
| **Deferred** | Explicitly outside controlled-beta scope. |
| **Historical** | Useful context only; do not implement from it without revalidation. |

## Current Release Truth

| Area | Current state | Next proof or limitation |
| --- | --- | --- |
| Application core | **Certified for controlled testing** | Continue focused regression and logs review before each real beta onboarding. |
| GHL installation and tenant isolation | **Certified** | Every new location must still pass trusted location-bound SSO and show no account chooser or cross-tenant data. |
| Clean V2 Snapshot | **Certified** | `ScaleSafe V2 Clean Certified 2` passed a scratch installation on July 19, 2026. Attach and use only the certified package. |
| Marketplace scopes | **Certified configuration** | Final 20-scope list is saved; the separate explanation video has been recorded. Reauthorize the reviewer install if GHL requires it. |
| Marketplace billing | **Shipped** | Standard paid access and exact-location, HQ-approved no-cost beta access are enforced by backend entitlement records. Browser input cannot grant free access. |
| Marketplace submission | **Approved** | ScaleSafe is approved in the GoHighLevel Marketplace. New beta installs still require exact-location entitlement and onboarding verification. |
| Public website | **Deployed and verified** | Privacy, terms, support, guide, FAQ, and troubleshooting pages returned `200` with distinct titles/content on July 21, 2026; legacy `.html` Marketplace URLs redirect correctly. |
| Production schema | **Verified at 106; pre-migration catalog gate passed** | Railway, the production RPC, and the checksum-verified forced-read-only PostgreSQL checker identify exact project `zddyagfotdtfbcdursqu` at schema 106. The checker returned `COMMAND_CENTER_PRE_MIGRATION_CATALOG_PASSED` and rolled back. No partial Command Center or migration 112 rollout was found. |
| Production health | **Healthy in September 4 preflight** | Public app, Supabase, and schema checks are healthy; sampled 24-hour Railway logs had no error-level entries. Two known cancellation 500s came from the disconnected test-Stripe/live-platform mismatch and are covered by the release candidate. |
| Independent recovery | **Certified** | Encrypted snapshot `20260721T175646Z` passed completion/hash checks and an isolated schema-102 scratch restore with all 105 Storage objects and readable private PDFs. See [Recovery Drill](RECOVERY_DRILL_2026-07-21.md). |
| Release governance | **Open owner decision** | Protect `main`/require green CI or record a controlled-beta exception; practice one Railway rollback. |

## Product Capability Index

### Installation, Accounts, And Merchant Setup

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| GHL Marketplace OAuth install and SSO | **Certified** | [Installation Guide](user-guide/INSTALLATION_GUIDE.md), `src/routes/auth.routes.ts` | Location-bound and fail-closed. Agency context is never permission to select another merchant. |
| Multi-location agency installs | **Certified** | [Installation Guide](user-guide/INSTALLATION_GUIDE.md) | Each installed sub-account remains a separate tenant. |
| Snapshot provisioning | **Certified** | [V2 Snapshot Allowlist](SCALESAFE_V2_SNAPSHOT_ALLOWLIST.md) | Clean package excludes stale Make.com, SYS2, duplicate, and old model-specific assets. |
| Merchant Setup and branding | **Shipped** | [New Account Checklist](user-guide/NEW_ACCOUNT_OPERATOR_CHECKLIST.md), `src/services/merchant.service.ts` | GHL Business Profile and ScaleSafe branding are separate setup surfaces. |
| Provisioning Health and repairs | **Shipped** | [Installation Guide](user-guide/INSTALLATION_GUIDE.md) | Run after merchant fields, domains, branding, and processor setup. |
| Standard subdomain and sending-domain setup | **Operating standard** | [Operator Onboarding](../.agents/skills/operate-scalesafe/references/onboarding.md) | Default pattern is `<merchant-slug>.scalesafe.app` and `mail-<merchant-slug>.scalesafe.app`. |
| Marketplace entitlement enforcement | **Shipped** | [Billing And Entitlements](MARKETPLACE_BILLING_AND_ENTITLEMENTS.md), `src/services/marketplace-entitlement.service.ts` | Browser input cannot unlock a plan or NMI capability. |
| Gated no-cost beta plan | **Shipped** | [Billing And Entitlements](MARKETPLACE_BILLING_AND_ENTITLEMENTS.md) | Full-feature access is activated for an exact approved location by HQ; installing or selecting the plan cannot self-authorize it. |

### Offers, Enrollment, And Checkout

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Offer CRUD and cloning | **Certified** | [User Guide](user-guide/README.md), `src/services/offer.service.ts` | GHL Product/Price creation remains active; Offers Custom Object sync is excluded from beta. |
| Internal and public offer names | **Certified** | [Operations](../.agents/skills/operate-scalesafe/references/operations.md) | Internal labels stay merchant-facing; client communications use the public program name. |
| PIF, installment, and subscription offers | **Certified** | [User Guide](user-guide/README.md) | Processor-native recurring billing; no fallback billing job. |
| Order bumps and pre-payment upsells | **Certified core** | `src/services/checkout-cart.service.ts` | One-time items must not recur with installment principal. |
| Full enrollment funnel | **Certified with Stripe** | [Reviewer Test Script](user-guide/REVIEWER_TEST_SCRIPT.md) | Captures identity, review, milestones, terms, signature, payment, and enrollment packet. |
| Quick Checkout | **Certified core** | [User Guide](user-guide/README.md) | Supports client creation/matching and enrollment linkage. |
| Quick Manual Sale | **Certified core** | [Operations](../.agents/skills/operate-scalesafe/references/operations.md) | Pay-first consent flow; no duplicate processor subscription during finalization. |
| Dual pricing | **Certified** | `src/services/dual-pricing.service.ts` | Shows clear bank and card choices and records the pricing snapshot for reconciliation/defense. |
| Turnstile checkout protection | **Certified core** | `src/services/turnstile.service.ts` | Applies to configured public checkout actions, not QMS or paid-enrollment finalization. |
| Merchant terms and click-wrap consent | **Certified core** | `src/services/consent.service.ts`, `src/services/enrollment-packet.service.ts` | Canonical terms URL and signed packet preserve enrollment evidence. |

### Processors, Payments, And Billing

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Stripe checkout, recurring, saved method, refund | **Certified core** | `src/clients/stripe.client.ts`, payment services | Finite recurring and day-one billing behavior have live proof. |
| Stripe Risk Health | **Shipped and live-observed** | [Stripe Defense Spec](STRIPE_DEFENSE_LAYER_SPEC.md), `src/services/stripe-risk-audit.service.ts` | Measures customer-present data and paginated settled-volume denominators. |
| Stripe EFW and dispute ingestion | **Shipped** | `src/services/stripe-efw.service.ts`, `src/services/stripe-dispute.service.ts` | Keep network-alert positioning distinct from direct Ethoca/Verifi/RDR integration. |
| Stripe evidence submission | **Shipped, gated** | `src/services/defense-submission.service.ts` | Requires a qualified packet and explicit merchant action. |
| NMI checkout, recurring, QMS, refund, lifecycle | **Certified core for PMG** | `src/clients/nmi.client.ts`, NMI services | Each beta merchant still needs NMI ownership/configuration proof. |
| NMI official webhook verification | **Shipped, per-config proof required** | `src/routes/webhook.routes.ts` | Certify the signed or transaction-verified callback for each active NMI configuration. |
| NMI saved-method identity | **Partial live proof** | `src/services/payment-methods.service.ts` | Query API and fresh masked-card identity remain onboarding checks. |
| Whop hosted checkout, PIF/installments, add-ons, QMS | **Certified core** | `src/services/whop.service.ts` | Hosted membership channel, not a Stripe/NMI gateway clone. |
| Whop refund, pause, resume, cancel | **Certified core** | `src/services/whop.service.ts` | Requires actual `pay_` and `mem_` identifiers; unsupported actions stay unavailable. |
| FanBasis checkout channel | **Deferred** | [FanBasis Plan](FANBASIS_INTEGRATION_BUILD_PLAN.md) | Foundation exists, but checkout/webhooks remain disabled pending provider approval and certification. |
| Payment ledger, reconciliation, durable idempotency | **Release candidate certified in isolation** | payment ledger/reconciliation/money-operation services, migrations 083/098/112 | Processor truth precedes local lifecycle mutations. Candidate schema 112 binds each record and retry to the exact processor configuration and makes deduplication configuration-aware. |
| Refund concurrency protection | **Shipped** | migration 083, `src/services/refund-reconciliation.service.ts` | Prevents parallel refunds from exceeding refundable balance. |
| Daily test billing flag | **Owner action before live billing** | [Launch Checklist](LAUNCH_READINESS_CHECKLIST.md) | Disable `VITE_ENABLE_DAILY_TEST_BILLING` when intentional daily testing ends. |

### Clients, Workflows, Pulse, And Milestones

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Client/program/payment/evidence views | **Certified core** | [User Guide](user-guide/README.md) | One contact may have multiple independent enrollments. |
| Enrollment-linked workflow payloads | **Shipped** | [Trigger Payload Contract](GHL_WORKFLOW_TRIGGER_PAYLOADS.md), [Field Matrix](WORKFLOW_FIELD_CONTRACT_MATRIX.md) | Scalar trigger fields are authoritative for program-specific messages. |
| Enrollment link, receipt, welcome, refund workflows | **Certified core** | [Workflow Reference](user-guide/WORKFLOW_REFERENCE.md) | Verify each new Snapshot/location end to end. |
| Pause/resume/cancel workflow copy | **Live proof still required** | [Workflow Reference](user-guide/WORKFLOW_REFERENCE.md) | Confirm no object-valued merge output before enabling for a beta merchant. |
| Pulse scheduling, delivery, response, evidence | **Certified core** | [Operations](../.agents/skills/operate-scalesafe/references/operations.md) | GHL event acceptance, workflow execution, outbound delivery, and response are separate proof layers. |
| Archived-offer pulse shutdown | **Shipped** | `src/jobs/pulse-cadence-check.ts` | Archiving an offer clears and refuses future pulse scheduling for its enrollments. |
| Milestone completion and signoff | **Certified core** | [Workflow Reference](user-guide/WORKFLOW_REFERENCE.md) | Operate on the exact enrollment; scheduled appointments do not prove completion. |
| Enrollment-linked direct message | **Shipped, one live proof open** | [Open Remediation](user-guide/OPEN_REMEDIATION_REGISTER.md) | Verify one harmless message remains linked to the selected enrollment. |

### Evidence And Integrations

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Enrollment-scoped evidence timeline | **Certified core** | `src/services/evidence.service.ts`, `src/services/dispute-scope.service.ts` | Ambiguous contact activity remains client-level and outside exact-enrollment packets. |
| Consent, payment, refund, cancellation evidence | **Certified core** | evidence and payment services | Evidence follows the exact payment/enrollment where a defensible match exists. |
| GHL communications | **Certified core** | `src/services/ghl-activity.service.ts` | Preserve timestamps, direction/channel, and readable content where available. |
| GHL appointment/fulfillment evidence | **Certified core** | `src/services/ghl-fulfillment.service.ts` | Scheduled means engagement; attended/completed can support delivery. |
| Universal canonical API and raw webhooks | **Shipped foundation** | [External Evidence API](external-evidence-api.md), migrations 089/090 | Authenticated, tenant-bound, idempotent intake with exact enrollment resolution. |
| Enrollment contexts and automatic identity binding | **Shipped foundation** | [Connector Automation Plan](UNIVERSAL_EVIDENCE_CONNECTOR_AUTOMATION_PLAN.md) | Never defaults to newest enrollment when ambiguous. |
| Integration catalog and entitlement ledger | **Shipped foundation** | migration 092, `src/services/integration-catalog.service.ts` | Named providers remain release-gated until certified. |
| Zoom OAuth and webhook adapter | **Shipped beta** | `src/integrations/zoom.adapter.ts`, `src/services/zoom-integration.service.ts` | One real non-host participant event and defense exhibit remain the certification proof. |
| Broader named provider catalog | **Planned in waves** | This index and connector plan | Course, agency, community, support, file, checkout, and reporting providers are future adapters. |

### Defense And Chargeback Reduction

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Transaction/enrollment-scoped defense compilation | **Certified core** | `src/services/defense.service.ts`, `src/services/defense-exhibits.service.ts` | Never substitutes the newest enrollment for the disputed transaction. |
| Reason-code strategies | **Shipped** | [Defense Research](CHARGEBACK_DEFENSE_OPTIMIZATION_RESEARCH.md), migration 085 | Current database includes Visa, Mastercard, Amex, and Discover strategies. |
| AI draft with structured fallback | **Shipped** | `src/clients/anthropic.client.ts`, defense service | AI fallback or incomplete scope produces `needs_review`, not unquestioned readiness. |
| Defense PDFs and exhibit bundle | **Certified core** | defense PDF/bundle services | Signed packet and enrollment-scoped exhibits are preserved; section headers render correctly. |
| `needs_review` safety gate | **Certified** | [User Guide](user-guide/README.md) | Does not automatically fire `ss_defense_ready`. |
| Outcome tracking and value recovered | **Shipped** | defense/outcome services | Outcomes are deduplicated per packet. |
| Enrollment-level readiness scoring | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) | Current contact-level score must not be presented as win probability. |
| Native Ethoca/Verifi/RDR/Order Insight integration | **Planned/partner-dependent** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) | Processor-side guidance is current; native automation is not yet a ScaleSafe feature. |

### Dashboard, Administration, Security, And Operations

| Capability | Status | Canonical source | Notes |
| --- | --- | --- | --- |
| Merchant dashboard and attention summaries | **Certified core** | [User Guide](user-guide/README.md) | Open disputes and pulse follow-up are visible. Dismissible tabbed attention center remains planned. |
| ScaleSafe HQ read-only/admin foundation | **Shipped foundation** | `src/routes/hq-admin.routes.ts` | Internal access and mutations remain narrowly gated and audited. |
| Public action tokens | **Shipped** | public-action middleware/services | Legacy raw action links remain disabled in production. |
| Tenant isolation and webhook authentication | **Shipped core** | auth/webhook middleware and connector services | Payloads cannot select their own tenant. |
| Trigger delivery durability | **Shipped** | migration 099, trigger delivery worker | GHL app-event acceptance is not mislabeled as customer communication delivery. |
| Background money reconciliation | **Shipped** | migration 098, money reconciliation worker | Multi-instance claims/leases prevent duplicate work. |
| Recovery toolkit | **Shipped and restore-certified** | [Recovery Toolkit](../ops/recovery/README.md), [Recovery Checklist](RECOVERY_OPERATOR_CHECKLIST.md), [Recovery Drill](RECOVERY_DRILL_2026-07-21.md) | Daily encrypted B2 backup is scheduled; the July 21 scratch restore passed. |
| AI operator skill and account SOP | **Shipped** | [AI Operator Setup](user-guide/AI_OPERATOR_SETUP.md), [Operator Skill](../.agents/skills/operate-scalesafe/SKILL.md) | Guides or operates one authorized tenant with approval gates and logs-first troubleshooting. |

## Open Controlled-Beta Work

### Stop-Ship

No open recovery stop-ship item remains. Snapshot `20260721T175646Z` passed the encrypted backup and isolated restore drill on July 21, 2026.

### Publication And Owner Actions

1. Monitor the submitted `v1.0.0` Marketplace review and respond only if GHL requests changes.
2. Confirm the reviewer install uses the certified clean V2 Snapshot and current entitlement.
3. Disable daily test billing before live merchant billing.
4. Decide repository visibility and production branch protection; practice one Railway rollback.

### Remaining Feature Proof

1. Certify NMI official callback and fresh masked saved-method identity for every NMI setup offered.
2. Deploy the completed exact-enrollment lifecycle field sync, then verify pause/resume/cancel workflow messages render the selected program and no `[object Object]` values.
3. Publish one real non-host Zoom attendance event to the correct enrollment and defense packet.
4. Send one harmless enrollment-linked direct message and verify the GHL echo remains on that enrollment.

## Roadmap Index

| Roadmap item | Status | Source/trigger |
| --- | --- | --- |
| Dismissible Dashboard Attention Center for disputes, pulse, and milestones | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Offer milestone delivery windows and dashboard completion actions | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Enrollment-level and reason-code evidence readiness | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Pulse v2, negative-pulse alerts, and merchant follow-up workflow | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Support SLA evidence analytics | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Ethoca, Verifi, RDR, Order Insight, Consumer Clarity dashboard/integration | **Planned, access-dependent** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Radar/3DS setup recommendations | **Planned guidance** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Named evidence adapters for course, agency, community, support, file, checkout, and reporting systems | **Planned in waves** | [Connector Automation Plan](UNIVERSAL_EVIDENCE_CONNECTOR_AUTOMATION_PLAN.md) |
| Outcome analytics by reason, offer, processor, evidence, refund timing, and alerts | **Planned** | [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Recovery/legal/collections partner referral handoff | **Planned, legal review required** | Private research notes plus [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) |
| Command Center, Guardian, and reseller account dashboard | **Phase 4 integrated release candidate certified in isolation; production not authorized** | [Command Center Architecture](COMMAND_CENTER_GUARDIAN_ARCHITECTURE_PLAN.md), [Phase 3 Implementation And Certification](COMMAND_CENTER_PHASE_3_IMPLEMENTATION_AND_CERTIFICATION.md), [Phase 3.4 Fable Review](COMMAND_CENTER_PHASE_3_4_FABLE_REVIEW.md), [Phase 4 Rollout](COMMAND_CENTER_PHASE_4_ROLLOUT.md), [Phase 4 Certification](COMMAND_CENTER_PHASE_4_CERTIFICATION.md), [Prior Fable Architecture Review](COMMAND_CENTER_FABLE_ARCHITECTURE_REVIEW.md) | Read-only merchant/payment views, audited incident acknowledgement/suppression, dedicated-host Supabase Auth and TOTP MFA are implemented. The 106-to-110 Command Center upgrade, fresh replay through 111, exact 111-to-112 processor-binding upgrade, tenant/poison-data checks, 10,002-merchant query (89.141 ms), real owner MFA, and 1,768 backend tests passed. The exact production project, schema 106, deployment, health, API-visible drift, direct read-only catalog, logs, and backup service state are verified. Release approval, real-domain TLS/login, and scheduled-job continuity remain. Guardian activation and reseller onboarding have separate gates. All new flags remain default-off. |
| NMI billing portal and Stripe-shaped merchant API | **Deferred post-beta** | [Project Decisions](PROJECT_DECISIONS.md) |
| FanBasis checkout and lifecycle certification | **Deferred pending provider approval** | [FanBasis Plan](FANBASIS_INTEGRATION_BUILD_PLAN.md) |
| Gated no-cost Marketplace beta plan | **Shipped** | [Billing And Entitlements](MARKETPLACE_BILLING_AND_ENTITLEMENTS.md) |
| Stripe commercial pricing negotiation | **Deferred until threshold** | [Stripe Outreach](STRIPE_CONNECT_PRICING_OUTREACH.md): five paying Stripe merchants and $100,000 combined monthly Stripe volume for two consecutive months. |

## Canonical Document Map

### Product And Engineering Control

| Document | Role | Authority |
| --- | --- | --- |
| [Master Index](MASTER_INDEX.md) | Current product, plan, launch, and document status | Primary status source |
| [Project Decisions](PROJECT_DECISIONS.md) | Durable owner decisions | Primary decision source |
| [CLAUDE.md](../CLAUDE.md) | Repository engineering constraints | Current agent rule |
| [Claude Session Prompt](CLAUDE_CODE_SESSION_PROMPT.md) | Safe startup context for repository coding sessions | Current agent entry point |
| [Changelog](../CHANGELOG.md) | Chronological implementation history | Historical change proof |
| [Technical Codex Log](CLAUDE_CODE_CODEX_LOG.md) | Detailed session history and old findings | Handoff/history; not current status |
| [Architecture Map](FULL_ARCHITECTURE_MAP.md) | Broad architecture background | Validate against code before use |
| [Application Blueprint](SCALESAFE_APP_BLUEPRINT_v2.1.md) | Original V2 product specification | Background only where current code differs |

### Launch, Review, And Onboarding

| Document | Role | Authority |
| --- | --- | --- |
| [Launch Readiness Checklist](LAUNCH_READINESS_CHECKLIST.md) | Detailed controlled-beta gates | Active checklist; older header baseline |
| [Open Remediation Register](user-guide/OPEN_REMEDIATION_REGISTER.md) | Detailed unresolved and closed findings | Active detail; older header baseline |
| [Beta Closeout Plan](BETA_CLOSEOUT_EXECUTION_PLAN.md) | July closeout sequence | Partially completed plan |
| [Installation Guide](user-guide/INSTALLATION_GUIDE.md) | Human install sequence | Current operating guide |
| [New Account Checklist](user-guide/NEW_ACCOUNT_OPERATOR_CHECKLIST.md) | Literal operator checklist | Current operating guide |
| [Reviewer Test Script](user-guide/REVIEWER_TEST_SCRIPT.md) | GHL review journey and expected results | Current reviewer guide |
| [V2 Snapshot Allowlist](SCALESAFE_V2_SNAPSHOT_ALLOWLIST.md) | Certified Snapshot assets | Current Snapshot truth |
| [Scope Explanations](GHL_MARKETPLACE_SCOPE_EXPLANATIONS.md) | Final 20 scopes and video script | Current Marketplace scope truth |
| [Marketplace Listing](GHL_MARKETPLACE_LISTING.md) | Listing fields and reviewer notes | Current draft; verify against submitted form |
| [Billing And Entitlements](MARKETPLACE_BILLING_AND_ENTITLEMENTS.md) | Plan behavior and HQ approval | Current contract |

### Command Center And Guardian

| Document | Role | Authority |
| --- | --- | --- |
| [Command Center Architecture](COMMAND_CENTER_GUARDIAN_ARCHITECTURE_PLAN.md) | Phased security, monitoring, operator, and reseller design | Primary architecture source |
| [Phase 3 Implementation And Certification](COMMAND_CENTER_PHASE_3_IMPLEMENTATION_AND_CERTIFICATION.md) | Guardian and health implementation record | Current implementation history |
| [Phase 3.4 Fable Review](COMMAND_CENTER_PHASE_3_4_FABLE_REVIEW.md) | Independent Guardian review and disposition | Closed code-review record |
| [Phase 4 Rollout](COMMAND_CENTER_PHASE_4_ROLLOUT.md) | Migrations 107-112, owner login, production enablement, acceptance, and rollback | Current release gate |
| [Phase 4 Certification](COMMAND_CENTER_PHASE_4_CERTIFICATION.md) | Isolated migration, processor binding, permission, scale, MFA, regression proof, and dependency exceptions | September 4 integrated preparation evidence; not a production sign-off |

### GHL Workflows And Fields

| Document | Role | Authority |
| --- | --- | --- |
| [Trigger Payload Contract](GHL_WORKFLOW_TRIGGER_PAYLOADS.md) | Canonical customer-workflow payloads | Current beta source |
| [Workflow Field Matrix](WORKFLOW_FIELD_CONTRACT_MATRIX.md) | ScaleSafe/GHL scalar-field contract | Current contract, verify PMG-specific IDs |
| [Workflow Setup](GHL_TRIGGER_WORKFLOW_SETUP.md) | One-workflow-per-message-intent setup | Current guide |
| [Workflow Reference](user-guide/WORKFLOW_REFERENCE.md) | Merchant/operator workflow behavior | Current guide |
| [Custom Fields Reference](ghl-custom-fields-reference.md) | Field reference | Verify exact location through Provisioning Health |
| [Custom Values Reference](ghl-custom-values-reference.md) | Historical PMG value reference | Do not reuse PMG IDs across tenants |
| [Automation Companion](GHL_AUTOMATION_COMPANION.md) | Original exhaustive GHL plan | Historical where Snapshot allowlist/contracts differ |
| [Offers Custom Object Schema](ghl-offers-custom-object-schema.md) | Deferred Offers object design | Not a beta requirement |

### Evidence, Connectors, And Defense

| Document | Role | Authority |
| --- | --- | --- |
| [External Evidence API](external-evidence-api.md) | Canonical API contract | Current connector contract |
| [Event Taxonomy](external-evidence-event-taxonomy.md) | Supported evidence event meanings | Current connector contract |
| [Defense Contract](external-evidence-defense-contract.md) | Defense-facing external evidence rules | Current connector contract |
| [Raw Webhook Mapping](external-webhook-mapping.md) | Safe mapping rules | Current connector guide |
| [Connector Security](external-evidence-security-and-troubleshooting.md) | Auth, tenant, retry, attachment rules | Current connector guide |
| [Integration Guide](external-integration-guide.md) | Merchant/developer overview | Current guide; named adapters remain gated |
| [Connector Automation Plan](UNIVERSAL_EVIDENCE_CONNECTOR_AUTOMATION_PLAN.md) | Implemented foundation and future provider shape | Partial implementation/roadmap |
| [Stripe Defense Spec](STRIPE_DEFENSE_LAYER_SPEC.md) | Stripe prevention/dispute design | Active reference; code is final truth |
| [Defense Optimization Research](CHARGEBACK_DEFENSE_OPTIMIZATION_RESEARCH.md) | Card-brand/reason-code research | Research reference |
| [Chargeback Roadmap](CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md) | Positioning and future evidence/operations work | Current roadmap source |
| [Defense Rebuild Plan](DEFENSE_REBUILD_PLAN.md) | Original defense rebuild requirements | Historical implementation plan |

### User, Support, Recovery, And Public Site

| Document | Role | Authority |
| --- | --- | --- |
| [User Guide](user-guide/README.md) | Merchant-facing product guide index | Current guide |
| [FAQ](user-guide/FAQ.md) | Merchant FAQ | Current guide |
| [Troubleshooting](user-guide/TROUBLESHOOTING.md) | Merchant/support troubleshooting | Current guide |
| [AI Operator Setup](user-guide/AI_OPERATOR_SETUP.md) | Using the shared operator skill | Current guide |
| [Deep-Dive Test Plan](user-guide/DEEP_DIVE_TEST_PLAN.md) | Full interface/log verification | Current test protocol |
| [Recovery Checklist](RECOVERY_OPERATOR_CHECKLIST.md) | Human recovery certification | Current recovery runbook |
| [Recovery Toolkit](../ops/recovery/README.md) | Backup/restore scripts and security boundary | Current tooling guide |
| [Website Source](../website/README.md) | Astro public site | Current website implementation |
| [Static Public Site](../marketing/README.md) | Earlier static help/legal package | Retained fallback/reference |

## Plan And Research Disposition

| Document | Disposition |
| --- | --- |
| [Beta Testing Issue Tracker](BETA_TESTING_ISSUE_TRACKER.md) | Historical beta record; current open truth belongs here and in Open Remediation. |
| [May Bug-Hunt Triage](BUG_HUNT_TRIAGE_2026-05-29.md) | Historical audit; fixed findings remain valuable regression context. |
| [Launch Blocker Verification](LAUNCH_BLOCKER_VERIFICATION.md) | Historical targeted test runbook; use current open-gate section above. |
| [E2E Assistant SOP](E2E_BETA_TESTING_ASSISTANT_SOP.md) | Current general testing method. |
| [Phase A Payment Infrastructure](CLAUDE_CODE_PHASE_A_PAYMENT_INFRASTRUCTURE.md) | Implemented historical build plan. |
| [Custom Payment Provider Plan](CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md) | Implemented architecture background. |
| [Cloudflare Security Plan](CLOUDFLARE_SECURITY_LAYER_PLAN.md) | Partial operational hardening reference; app-level auth remains mandatory. |
| [FanBasis Plan](FANBASIS_INTEGRATION_BUILD_PLAN.md) | Foundation/decisions retained; release deferred. |
| [GHL Beta Snapshot Plan](GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md) | Execution history; certified allowlist now controls. |
| [Workflow Repair Plan](GHL_WORKFLOW_TEMPLATE_REPAIR_PLAN.md) | Implemented/historical; current payload and field contracts control. |
| [Marketplace Update Guide](OKE_MARKETPLACE_UPDATE_GUIDE.md) | Historical assistant-specific guide; use current Marketplace docs. |
| [Stripe Pricing Outreach](STRIPE_CONNECT_PRICING_OUTREACH.md) | Future commercial outreach, activated only at the documented volume threshold. |
| [Website Build Brief](../marketing/WEBSITE_BUILD_BRIEF.md) | Implemented original website brief; current Astro source and public review control. |

## Complete Knowledge Inventory

The files below are intentionally cataloged so future agents can find them without treating every file as equally current.

### Agent Instructions And Test Agents

- [ScaleSafe Operator Skill](../.agents/skills/operate-scalesafe/SKILL.md)
- [Operator onboarding reference](../.agents/skills/operate-scalesafe/references/onboarding.md)
- [Operator operations reference](../.agents/skills/operate-scalesafe/references/operations.md)
- [Operator certification reference](../.agents/skills/operate-scalesafe/references/certification.md)
- [Operator troubleshooting reference](../.agents/skills/operate-scalesafe/references/troubleshooting.md)
- [Defense integration test agent](../.cursor/agents/defense-integration-tests.md)
- [Enrollment integration test agent](../.cursor/agents/enrollment-integration-tests.md)
- [Evidence integration test agent](../.cursor/agents/evidence-integration-tests.md)
- [Offer integration test agent](../.cursor/agents/offer-integration-tests.md)
- [Webhook integration test agent](../.cursor/agents/webhook-integration-tests.md)

### Current User-Guide Records And Assets

- [Live Certification, July 13](user-guide/LIVE_CERTIFICATION_2026-07-13.md): dated proof ledger, not current open status.
- [Live Findings](user-guide/LIVE_FINDINGS.md): historical finding record; do not delete resolved findings.
- [Reviewer Asset Manifest](user-guide/REVIEWER_ASSET_MANIFEST.md): required sanitized capture list.
- [Reviewer Snapshot Inventory](user-guide/REVIEWER_SNAPSHOT_INVENTORY.md): pre-cleanup inventory and certification evidence.
- [Screenshot Catalog](user-guide/SCREENSHOT_CATALOG_2026-07-17.md): current screenshot locator.
- `docs/user-guide/assets/`: sanitized documentation images controlled by the manifests above.

### Public Website Content

- [Website project](../website/README.md)
- [Website FAQ source](../website/src/pages/faq.md)
- [Website guide source](../website/src/pages/guide.md)
- [Website privacy source](../website/src/pages/privacy.md)
- [Website terms source](../website/src/pages/terms.md)
- [Website troubleshooting source](../website/src/pages/troubleshooting.md)
- [Static public-site package](../marketing/README.md)
- [Static website build brief](../marketing/WEBSITE_BUILD_BRIEF.md)

### Repository Archive: Superseded Plans

Everything under `docs/archive/` is historical and non-authoritative:

- [OAuth reinstall task](archive/CLAUDE_CODE_FIX_OAUTH_REINSTALL.md)
- [Phase 1 trigger instructions](archive/CLAUDE_CODE_PHASE1_INSTRUCTIONS.md)
- [Phase 2 enrollment/payment instructions](archive/CLAUDE_CODE_PHASE2_INSTRUCTIONS.md)
- [Cursor/Claude strategy](archive/CURSOR_CLAUDE_CODE_STRATEGY.md)
- [Existing funnel plan](archive/EXISTING_FUNNEL_INTEGRATION_BUILD_PLAN.md)
- [Marketplace research](archive/GHL_MARKETPLACE_RESEARCH_AND_STRATEGY.md)
- [Old Snapshot plan](archive/GHL_SNAPSHOT_PLAN.md)
- [Old master build sequence](archive/MASTER_BUILD_SEQUENCE.md)
- [Order bump plan](archive/ORDER_BUMP_BUILD_PLAN.md)
- [Payment migration plan](archive/PAYMENT_MIGRATION_BUILD_PLAN.md)
- [Old positioning guide](archive/PRODUCT_POSITIONING.md)
- [March 31 project status](archive/PROJECT_STATUS_2026_03_31.md)

Everything under `_archive/old-docs/` and `_archive/old-src/` is V1 or retired history:

- [Accept.blue API reference](../_archive/old-docs/acceptblue-api-v2-reference.md)
- [Accept.blue webhooks](../_archive/old-docs/acceptblue-webhooks-reference.md)
- [Old architecture](../_archive/old-docs/ARCHITECTURE.md)
- [Old changelog](../_archive/old-docs/CHANGELOG.md)
- [Old Claude prompt](../_archive/old-docs/CLAUDE_CODE_PROMPT.md)
- [Old feature inventory](../_archive/old-docs/feature-inventory.md)
- [Old fields reference](../_archive/old-docs/ghl-custom-fields-reference.md)
- [Old values reference](../_archive/old-docs/ghl-custom-values-reference.md)
- [Old Offers object schema](../_archive/old-docs/ghl-offers-custom-object-schema.md)
- [Old contents index](../_archive/old-docs/master-contents-index.md)
- [Old merchant funnel](../_archive/old-docs/merchant-onboarding-funnel.md)
- [Old operating manual](../_archive/old-docs/merchant-operating-manual.md)
- [Old payment lifecycle plan](../_archive/old-docs/payment-lifecycle-build-plan.md)
- [Old phase tracker](../_archive/old-docs/phase-tracker.md)
- [Old system guide](../_archive/old-docs/plain-english-system-guide.md)
- [Old project setup](../_archive/old-docs/PROJECT_SETUP.md)
- [Old context package](../_archive/old-docs/SCALESAFE_CONTEXT_PACKAGE.md)
- [Old source README](../_archive/old-src/README.md)

### Non-Markdown And Local-Only Records

- `docs/SCALESAFE_APP_BLUEPRINT_v2.1.docx` is the formatted copy of the original blueprint; the Markdown version is searchable.
- `docs/ScaleSafe-Stripe-Defense-Layer.docx` is a formatted research/spec artifact; current code and the Markdown Stripe Defense spec control behavior.
- Private/local working files ignored by Git include defense-packet review prompts, recovery-partner legal research, live test journals, website audit notes, and visual-UX working memory. They are supporting research only and must not become hidden sources of truth.

## Maintenance Protocol

For every meaningful product change:

1. Update [Changelog](../CHANGELOG.md) with what changed.
2. Update this file when feature status, launch status, roadmap disposition, or document authority changes.
3. Update [Project Decisions](PROJECT_DECISIONS.md) only for durable owner decisions.
4. Update [Open Remediation](user-guide/OPEN_REMEDIATION_REGISTER.md) when a detailed finding opens or closes.
5. Update the user guide when merchant-visible behavior changes.
6. Record code paths, migration ordering, tests, and external proof without secrets or unnecessary PII.
7. Never mark **Certified** from code or unit tests alone when GHL, a processor, email delivery, DNS, storage, or another external system is part of the claim.
