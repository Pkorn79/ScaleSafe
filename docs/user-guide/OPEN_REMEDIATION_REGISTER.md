# ScaleSafe Open Remediation Register

> Current status rollup: `docs/MASTER_INDEX.md`. This register preserves detailed finding history; use the Master Index when this file's older baseline conflicts with later proof.

Reconciled: 2026-07-21 CDT
Current release baseline: `67d9ea3f40d8882b0bbcd32163f0736261257597`
Production schema: `102`
Working branch: `codex/beta-remediation`

This is the current open-work list. `LIVE_FINDINGS.md` and `LIVE_CERTIFICATION_2026-07-13.md` remain historical audit records and intentionally retain the original findings.

## Stop-Ship Before The First Real Beta Merchant

No open stop-ship gate remains. FIND-068 closed with the July 21 encrypted backup/restore drill. FIND-073 closed when `ScaleSafe V2 Clean Certified 2` passed the July 19 scratch installation and became the approved reviewer package.

## Publication And Owner-Configuration Gates

These are not unresolved application-code defects, but GHL review or processor launch should not proceed without them.

| Gate | Required action |
| --- | --- |
| NMI official webhook (FIND-007) | Certify a signed/verified live callback for each NMI configuration offered during beta. Do not infer webhook readiness from successful dashboard charges. |
| GHL lifecycle templates (FIND-035) | Confirm pause/resume/cancel templates use the documented scalar contact fields and produce one correctly named program message. Disable any unverified workflow rather than shipping `[object Object]`. |
| Production release control (FIND-072) | Protect `main` with green CI/owner review or record a controlled-beta exception and practice one Railway rollback. |
| Repository visibility | Confirm the public GitHub repository is intentional; otherwise make it private after checking Railway access. |

## Features That Need One Remaining Live Proof

These do not block the base product when described accurately, but they must not be advertised as certified until their proof is captured.

| Area | Current proof | Missing proof |
| --- | --- | --- |
| Zoom attendance (FIND-057) | OAuth is connected, health distinguishes authorization from evidence, host exclusion is implemented, and the connection awaits a completed participant session. | One real non-host participant event matched once to the correct enrollment and visible in the client evidence/defense path. |
| Enrollment-linked direct messages (FIND-066) | UI requires or selects the exact enrollment and displays the client-facing program name; automated tests cover the contract. | One harmless PMG message sent after the fix, observed in GHL and linked to that exact enrollment. |
| NMI saved-method identity (FIND-025) | New data paths retain masked identity when NMI returns it. Historical methods without last four remain ambiguous and are correctly unsafe to select. | A fresh vaulted method showing the authorized last four, followed by a separately approved low-value charge if NMI saved charging is in beta scope. |
| Zoom/connector defense exhibit | Connector history loads and GHL fulfillment publishes exact enrollment evidence. | One Zoom-derived exhibit in an enrollment-scoped packet after the attendance proof above. |

## Closed By Deployed Code And Current Live Proof

- FIND-068: Supabase Pro managed backups are active; encrypted snapshot `20260721T175646Z` passed off-platform verification and a complete isolated restore. See `docs/RECOVERY_DRILL_2026-07-21.md`.
- FIND-073: `ScaleSafe V2 Clean Certified 2` passed the scratch-install allowlist certification and replaced the legacy reviewer package.
- Marketplace submission package: the end-to-end and scope videos, reviewer credentials, reviewer notes, final 20-scope explanation, and certified Snapshot were submitted for GHL review.
- Public review URLs: privacy, terms, support, guide, FAQ, and troubleshooting returned `200` with distinct page titles/content on July 21, 2026. Legacy `.html` Marketplace URLs redirect to the corresponding live pages.
- FIND-044: dashboard reads are bounded, read-only, and currently respond below the three-second observation threshold.
- FIND-045: milestone state is durable and trigger delivery is queued/observable.
- FIND-048: defense regeneration returns `202` and completes in the durable background path.
- FIND-049 through FIND-055: current defense regeneration stays `needs_review` when delivery is absent, does not assert unsupported delivery, preserves the selected Stripe transaction, includes the pulse follow-up facts, explains the `$65` pricing difference, and does not fire `ss_defense_ready`.
- FIND-056/059/064: Evidence Connections separates OAuth, observed events, and published evidence; connector history loads from the live schema.
- FIND-060: Payments exposes Stripe, NMI, Whop, and GHL processor filters.
- FIND-061/062: Stripe Risk Health reads Stripe-only data and renders the normalized DTO.
- FIND-063: terminal Stripe disputes stay out of the active queue, and PMG now shows zero Active Disputes after local/manual defense rows were excluded from Stripe routes.
- FIND-065: successful client actions provide one success state and refresh affected data.
- FIND-067 code portion: idle workers use bounded behavior, dependency failures are typed, and production health recovered after the Supabase upgrade.
- FIND-067 operations proof: the continuous 2026-07-15 4:46:45-5:47:42 PM CDT observation contained 134 HTTP requests, zero 4xx/5xx, zero requests over three seconds, a 1.536-second maximum, zero application warning/error lines, and ten consecutive healthy app/Supabase/schema probes. Reopen this finding if the Supabase resource warning or database timeouts return.
- FIND-069/074: PMG and the clean reviewer sub-account both complete trusted location-bound SSO without a cross-account chooser; dependency and parent-context failures are separately classified.
- FIND-071: password/temp evidence paths are ignored and no live secret was found in the tracked-tree scan.
- FIND-036/037: the fresh Stripe finite plan charged `$1` first installment plus a one-time `$1` add-on, then one final `$1` installment; it completed at 2/2 with no next billing date. `ss_payment_received` was delivered once for payment 2 with the exact enrollment and program name.
- Dual-option Quick Checkout: a live `$1.50` Stripe paid-in-full selection on the installment-capable certification offer created one client-linked PIF enrollment and payment, no next billing, no saved recurring method, no recurring-plan display, and no processor subscription. Railway logged the exact enrollment as `paymentType: pif` with `nextBilling: null` and no warning/error response.
- Reviewer full enrollment: the dedicated `ScaleSafe` location produced one linked Stripe sandbox payment, enrollment, consent record, enrollment-payment record, and private packet. Receipt and welcome messages were received. Public enrollment and checkout surfaces now use the DBA/brand, customer maps retain the public program name, and packet clause acceptance reflects the semantic IDs recorded at signature time.

## Accepted Controlled-Beta Limitations

- Railway remains in `us-west2` while Supabase is in `us-east-1` (FIND-070). Current measured health is acceptable for the controlled beta; continue latency monitoring and revisit regional alignment before scale.
- Historical test records contain stale workflow copy, ambiguous saved methods, and intentionally unrealistic Stripe risk metrics. They remain in PMG for regression work and must not be used in reviewer screenshots.
- FanBasis checkout/webhooks remain disabled pending provider approval and are outside beta certification.

## Release Rule

Do not call the beta ready until the stop-ship table is empty. Before any production push, run focused tests, the full Jest suite, TypeScript, production build, dependency audit, diff/secret checks, and record the deployed SHA.
