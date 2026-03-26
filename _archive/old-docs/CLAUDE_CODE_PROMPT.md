# First Prompt for Claude Code — Copy and Paste This

---

Read SCALESAFE_CONTEXT_PACKAGE.md first — that's the architecture overview and briefing.

Then read ALL 13 docs in the docs/ folder. These are the complete reference materials:

**API & Integration Specs:**
- docs/acceptblue-api-v2-reference.md — Verified accept.blue API endpoints (DO NOT search online for this)
- docs/acceptblue-webhooks-reference.md — Verified webhook events and signatures (DO NOT search online)
- docs/external-integration-guide.md — How Calendly/Zoom/Kajabi feed evidence in (shapes /webhooks/external)

**GHL Data Model (LIVE DATA — pulled from actual GHL account):**
- docs/ghl-custom-fields-reference.md — All 352 contact-level custom fields with IDs, keys, and data types
- docs/ghl-offers-custom-object-schema.md — Complete Offers custom object: 66 fields with exact field keys
- docs/ghl-custom-values-reference.md — All location-level custom values with IDs, keys, and current values

**Product & Business Logic:**
- docs/feature-inventory.md — Complete feature list: what's BUILT, PARTIAL, NOT BUILT, and BRAINSTORM
- docs/payment-lifecycle-build-plan.md — 48 payment functions across 8 categories with architecture decisions
- docs/plain-english-system-guide.md — What every component does in normal words
- docs/merchant-operating-manual.md — How merchants actually use ScaleSafe day-to-day

**Build State & Roadmap:**
- docs/master-contents-index.md — Component directory with IDs and cross-references
- docs/phase-tracker.md — Current phase, pending items, what's next
- docs/merchant-onboarding-funnel.md — 4-page funnel structure with field mappings

After reading everything, revisit your architecture plan. Specifically:

1. **Does your plan account for ALL features in the feature inventory?** Look at the NOT BUILT and BRAINSTORM sections — are any missing from your architecture?

2. **Does your plan handle the T&C clause system?** There are 11 clause slots per offer, compiled into clickwrap HTML. This is legally critical.

3. **Does your plan handle the incentive program?** It has toggles, tier descriptions, and thresholds per merchant.

4. **Are the GHL custom field IDs integrated?** You now have the exact field keys for every contact field and custom object field. These should be constants in the app.

5. **Does your external integration design match the actual webhook payload spec?** The external-integration-guide.md has the exact JSON format.

6. **Are there features that would be better as GHL native automations instead of app code?** Think about what GHL workflows already do well (email/SMS, pipeline moves, simple triggers).

7. **Are there better architectural decisions now that you have the full picture?** You're not tied to the Make.com approach. If consolidating evidence tables, restructuring the data model, or changing the enrollment flow would be better — propose it.

8. **Consider the merchant onboarding flow.** The funnel collects 16 fields across 2 pages. The app needs to handle this as part of provisioning.

Present your updated plan with any changes clearly marked. Don't start coding until I approve.
