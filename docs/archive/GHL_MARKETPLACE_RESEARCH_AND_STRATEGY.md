# ScaleSafe — GHL Marketplace Research & Strategy Decision

**Created:** 2026-03-25
**Status:** ACTIVE DECISION DOCUMENT
**Purpose:** Research findings + two ready-to-use prompts + marketplace vs standalone recommendation

---

## RESEARCH FINDINGS (Plain English Summary)

### What GHL Marketplace Gives You For Free

When you build a GHL Marketplace app, you get a LOT of plumbing handled for you:

- **OAuth + SSO**: GHL handles login. Your app gets user identity, location ID, and permissions automatically through encrypted session data. No building your own auth system.
- **Install/Uninstall Webhooks**: GHL fires events when someone installs or removes your app. You just listen.
- **Payment Module Framework**: GHL has a built-in system for custom payment providers. It supports one-time, recurring, and off-session (saved card) charges. Your app plugs into this — GHL handles the checkout UI, invoices, order forms, and Text2Pay links.
- **Custom Pages (iframes)**: You can embed your own UI inside GHL as a sidebar menu item. It loads your hosted URL in an iframe.
- **Marketplace Distribution**: Your app shows up where GHL users are already shopping.
- **Agency Rebilling**: Agencies can mark up your app price and resell to their sub-accounts.

### What NMI + GHL Gives You

GHL integrates natively with NMI. Here's what that means for ScaleSafe:

- **Recurring billing is handled by GHL** — not NMI's Automatic Recurring Billing (ARB). GHL manages subscription logic at the app level.
- **Installment plans exist on invoices** — GHL can split invoices into payment plans.
- **ACH is rolling out** — this solves the ACH gap that was a pain point with accept.blue.
- **Payment events are accessible** — through GHL's payment scopes, your app can see transaction data.

**The catch**: GHL does NOT use NMI's native subscription system. It manages recurring billing itself. So the subscription data lives in GHL, not in the payment processor. This is actually fine for ScaleSafe — it means all the billing data is accessible through GHL's API.

### Custom JS Module Limitation — ANSWERED

The limitation you saw: "Custom JS can be added for apps whose Target user: Agency OR Target user: Sub-Account AND Installed by: Agency."

**What this means**: If your app targets Sub-Accounts AND allows Sub-Accounts to install it themselves (not just agencies), you CANNOT use Custom JS modules.

**Does this limit ScaleSafe?** Not really. Here's why:
- ScaleSafe's target is Sub-Account, but the installer would typically be the agency (the coaching business owner)
- Setting it to "Sub-Account, Installed by Agency" gives you Custom JS access
- Even without Custom JS, the Custom Pages iframe approach gives you a full UI inside GHL
- The AI defense compiler, evidence logging, and payment processing all happen on YOUR server, not in GHL's JS

### The 11 Payment Scopes

GHL offers extensive payment-related API access:
- Create/manage invoices, order forms, subscriptions
- Access transaction history and payment events
- White-label payment provider integration
- Test mode and live mode separation
- Customer vault (stored payment methods)
- Webhook events for payment status updates

### Key Gotchas Discovered

1. **Webhook fragility**: GHL webhooks only retry on HTTP 429 (rate limit). Any other failure = permanent data loss. For a compliance tool like ScaleSafe, this means you MUST run daily reconciliation.
2. **Version management**: Max 3 versions active. Can't force users to upgrade. Plan releases carefully.
3. **No bulk management**: Can't programmatically install across locations. Each location installs separately.
4. **Card required**: Sub-accounts need a card on file to install marketplace apps.
5. **15% revenue share**: GHL takes 15% of marketplace sales.

---

## PROMPT 1: COMPLETE RESEARCH TASK

Use this prompt in a new Claude session (or Claude Code) to do a deeper research dive:

---

> **PROMPT: GHL Marketplace App Research for ScaleSafe**
>
> I'm building ScaleSafe — a chargeback defense SaaS for high-ticket coaching businesses. It's currently a Node.js/TypeScript app that installs from the GHL Marketplace. I need you to do comprehensive research to map out EVERYTHING available to me through GHL's Marketplace app framework.
>
> **Context**: ScaleSafe needs to:
> - Process payments (currently accept.blue, evaluating NMI since GHL integrates natively)
> - Log evidence of customer engagement (sessions, modules, milestones, pulse checks)
> - Compile AI-powered chargeback defense packets (using Claude API)
> - Manage merchant onboarding through GHL
> - Handle recurring billing / installment plans for merchants' customers
> - Generate and store PDFs for chargeback defense
> - Work across multiple merchants (multi-tenant)
>
> **Research these specific areas and document your findings:**
>
> 1. **Complete OAuth Scope Inventory**: List EVERY available scope at marketplace.gohighlevel.com/docs/Authorization/Scopes with a one-line description of what each enables. Group by category (payments, contacts, opportunities, workflows, custom objects, etc.)
>
> 2. **Payment Module Deep Dive**: Document the full Custom Payments Integration framework (marketplace.gohighlevel.com/docs/marketplace-modules/Payments). What payment types are supported? What webhook events fire? What data comes back? How do invoices, order forms, and Text2Pay interact with a custom payment provider?
>
> 3. **NMI + GHL Native Integration**: What exactly does GHL's NMI integration support today? Recurring billing? ACH? Payment plans on invoices? What transaction data is available through the API? Does GHL use NMI's ARB or manage subscriptions itself?
>
> 4. **Custom Pages & SSO**: Document the Custom Pages iframe system. How does SSO work? What user context data is available? What are the cross-origin requirements? Can you have multiple custom pages?
>
> 5. **Workflow Integration**: Can marketplace apps create custom workflow triggers? Custom workflow actions? How would ScaleSafe fire a "chargeback detected" trigger that merchants can build workflows around?
>
> 6. **Custom Objects API**: Full documentation on creating, reading, updating custom object records. ScaleSafe uses a "Offers" custom object in GHL — can the app manage these programmatically?
>
> 7. **Webhook System**: Complete list of available webhook events. Retry behavior. Signature verification (new X-GHL-Signature standard). Payload formats.
>
> 8. **App Distribution Models**: Compare "Agency" vs "Sub-Account (Both Install)" vs "Sub-Account (Agency Only)". Which model works best for ScaleSafe where coaching businesses are sub-accounts but may be managed by agencies?
>
> 9. **Snapshot System**: Can ScaleSafe use snapshots to pre-configure a merchant's GHL setup (custom fields, workflows, pipeline stages) during onboarding?
>
> 10. **Rate Limits & Constraints**: API rate limits, webhook delivery limits, custom object limits, storage limits.
>
> 11. **Real Marketplace Apps**: Find 5-10 successful GHL Marketplace apps (especially in payments, compliance, or protection). How are they structured? What pricing models do they use?
>
> **Output format**: Organized document with each area as a section. Include source URLs for every claim. Flag anything that's unclear or contradictory in the docs.

---

## PROMPT 2: OPTIMAL APP STRATEGY

Use this prompt AFTER the research is complete:

---

> **PROMPT: ScaleSafe Optimal Architecture Strategy**
>
> Based on the GHL Marketplace research completed in our previous session, design the optimal architecture for ScaleSafe.
>
> **What ScaleSafe does (non-negotiable features)**:
> 1. Evidence logging — tracks customer engagement across sessions, modules, milestones, pulse checks, payments, cancellations, refunds, and external platform access (Kajabi, Zoom, etc.)
> 2. AI Defense Compiler — when a chargeback hits, compiles ALL evidence into a defense packet using Claude API, generates a persuasive defense letter, and packages it as a PDF
> 3. Merchant onboarding — new coaching businesses install the app, configure their payment processor credentials, set their evidence modules, and go live
> 4. Payment processing — handles one-time (pay-in-full) and recurring (installment) payments for merchants' coaching programs
> 5. Multi-tenant — every feature works across unlimited merchants, each with their own GHL sub-account
> 6. Health monitoring — internal system that catches failures, retries webhooks, runs daily reconciliation
>
> **What we already have built**:
> - Node.js/TypeScript Express app with Vue 3 frontend
> - Supabase database with merchants, ab_customer_map, idempotency_keys, defense_packets, evidence_service_access tables
> - Evidence timeline view (unified query across all evidence types)
> - GHL OAuth flow (using @gohighlevel/api-client SDK)
> - Accept.blue payment integration (tokenization, recurring billing, webhooks)
> - 9 evidence tables already in Supabase from previous Make.com system
>
> **Strategic questions to answer**:
>
> 1. **Payment processor decision**: Given GHL's native NMI integration with ACH rolling out, should ScaleSafe:
>    - (A) Use GHL's native payment system (NMI) and focus on evidence + defense only
>    - (B) Keep accept.blue as a "bring your own processor" option
>    - (C) Build a Custom Payment Provider that bridges both
>    - (D) Something else?
>    Show the trade-offs for each.
>
> 2. **What to build in GHL vs in the app**: For each ScaleSafe feature, decide whether it should live in GHL (workflows, custom fields, pipelines) or in the app (code, database, API). Create a feature-by-feature matrix.
>
> 3. **Distribution model**: Should ScaleSafe target Agency or Sub-Account? Should agencies be able to resell? What's the pricing model?
>
> 4. **Leverage GHL's built-in features**: Where can we delete code we've already written because GHL handles it natively? (Example: if GHL handles recurring billing via NMI, do we still need our installment tracking code?)
>
> 5. **Offer link flow**: Currently we planned custom code to send payment links (pages 3 and 4 of the funnel). With NMI native, can GHL's order forms or Text2Pay handle this instead?
>
> 6. **Evidence gaps with NMI**: If payments go through GHL/NMI instead of accept.blue, do we still get enough transaction data for chargeback defense? What evidence do we lose vs gain?
>
> 7. **Revised Phase Plan**: Given the optimal architecture, revise the deployment phases (currently A-G). What can be removed? What needs to be added? What's the new estimated completion percentage?
>
> **Output format**: A strategy document with clear recommendations, trade-off tables, and a revised build plan. Use plain English — the founder is non-technical.

---

## MARKETPLACE vs STANDALONE — THE ANSWER

### Short Answer

**Build it as a GHL Marketplace app.** Here's why:

### The Case FOR Marketplace (Why It Wins)

1. **Your customers ARE in GHL.** High-ticket coaching businesses using GHL is your exact market. A standalone app would require you to build integrations to reach the same people who are already browsing the marketplace.

2. **Payment processing can be GHL's problem.** If NMI handles recurring billing, ACH, and payment plans natively through GHL, you can remove the entire accept.blue integration layer. That's easily 30-40% of the current codebase. Your app focuses on what's unique: evidence + defense.

3. **OAuth, SSO, onboarding — all handled.** The GHL SDK gives you merchant identity, location routing, and user permissions out of the box. Your current OAuth code already uses this. Going standalone would mean rebuilding all of this.

4. **Distribution matters more than margin.** Yes, GHL takes 15%. But finding 50 coaching businesses through cold outreach costs FAR more than 15% in marketing spend. The marketplace puts you where buyers are already shopping.

5. **You're already 30% built on this path.** The Node.js app, the GHL OAuth flow, the Supabase schema — it's all designed for marketplace deployment. Switching to standalone means rearchitecting, not just adding features.

### The Case FOR Standalone (Why You Might Switch Later)

1. **Revenue ceiling.** At scale (500+ merchants at $200/mo), that 15% = $18,000/month to GHL. At that point, standalone + your own sales team might make sense.

2. **Non-GHL customers.** Coaches using Kajabi, Circle, or Teachable directly can't install a GHL app. A standalone version opens that market.

3. **Platform risk.** If GHL changes their marketplace terms, raises the rev share, or deprecates APIs, you're exposed.

### The Verdict

**Start as Marketplace. Consider standalone V2 when you hit 100+ merchants.**

The marketplace gets you to revenue fastest with the least engineering work. The accept.blue → NMI shift alone could cut weeks off the timeline. And nothing stops you from building a standalone version later — your Supabase database, AI defense compiler, and evidence engine are all platform-agnostic. They work whether the front door is GHL or your own website.

### What This Means For The Current Build

If you decide to go this route, here's what changes:

| Component | Current Plan | With NMI/Marketplace | Impact |
|-----------|-------------|---------------------|--------|
| Payment processing | accept.blue integration | GHL native (NMI) | **Remove ~30% of code** |
| Offer links (pg 3-4) | Custom code to generate | GHL Order Forms or Text2Pay | **Remove custom funnel code** |
| Customer mapping | ab_customer_map table | GHL contact = payment source | **Simplify data model** |
| Recurring billing | Custom webhook tracking | GHL manages subscriptions | **Remove installment logic** |
| Tokenization iframe | Custom hosted page | GHL payment forms | **Remove entirely** |
| Evidence logging | Keep as-is | Keep as-is | **No change — this is your value** |
| AI Defense Compiler | Keep as-is | Keep as-is | **No change — this is your value** |
| Merchant onboarding | Custom flow | GHL Marketplace install + Custom Page config | **Simplify** |
| Webhook handling | accept.blue webhooks | GHL payment events | **Simpler, but add daily reconciliation** |

### Bottom Line

The stuff that makes ScaleSafe special — evidence logging and AI chargeback defense — has nothing to do with payment processing. Let GHL handle payments. You handle defense.

---

## SOURCES

- GHL Marketplace App Distribution: https://help.gohighlevel.com/support/solutions/articles/155000002141
- Custom JS Module: https://ideas.gohighlevel.com/changelog/app-marketplace-custom-js
- Custom Payments Integration: https://marketplace.gohighlevel.com/docs/marketplace-modules/Payments
- OAuth Scopes: https://marketplace.gohighlevel.com/docs/Authorization/Scopes
- NMI Integration: https://help.gohighlevel.com/support/solutions/articles/48001235741
- Webhook Guide: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide
- GHL App Template: https://github.com/GoHighLevel/ghl-marketplace-app-template
- Custom Pages: https://marketplace.gohighlevel.com/docs/marketplace-modules/CustomPages
- App Versioning: https://ideas.gohighlevel.com/changelog/introducing-app-updates-with-versioning-in-the-ghl-marketplace
- SSO Guide: https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps
