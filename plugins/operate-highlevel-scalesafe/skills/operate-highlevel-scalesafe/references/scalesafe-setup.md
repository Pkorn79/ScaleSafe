# ScaleSafe installation and merchant setup

## Contents

- How to run this
- Intake
- Installation gates
- Hosted addresses
- Business profile
- Merchant configuration
- Terms and consent
- Plan entitlement and processors
- Provisioning and required workflows
- Evidence connections
- Before going live

## How to run this

One numbered step at a time; wait for the visible result before continuing. This is Guide mode
throughout — the owner does the clicking in their own account, and each step ends with something
they can report back.

Every step that changes configuration is its own action-time approval. Installation, processor
connection, and domain changes are never batched with anything.

Copy `assets/merchant-intake-template.md` and fill it with the owner before starting. Setup stalls
usually trace back to a detail nobody collected up front.

## Intake

Collect the business identity, support details, branding files, statement descriptor, terms and
policy sources, processor launch scope, required workflows, and evidence sources. The template lists
them.

Record no secrets. Record the account identity as the agency and sub-account **name** — the location
identifier stays on the owner's screen and out of the intake record, the transcript, and any file.

## Installation gates

1. Open the exact confirmed sub-account.
2. Install the ScaleSafe app into that location from the Marketplace. Separate approval.
3. Review and confirm the snapshot resources it attaches, before accepting them.
4. Open ScaleSafe from that same sub-account.
5. Verify it opens without an account chooser and shows no other merchant's data.

Stop immediately on cross-tenant data or missing trusted location context. That is never solved by
choosing another sub-account, and it is not a reason to reinstall — reinstall only when the app
proves the installation is genuinely missing or revoked, not for a temporary error.

## Hosted addresses

ScaleSafe provides two standard hosted addresses, built from the merchant's slug:

- **Funnel:** `<merchant-slug>.scalesafe.app`
- **Sending:** `mail-<merchant-slug>.scalesafe.app`

These are product conventions rather than merchant secrets, which is why they are stated here — but
they are a starting shape, not an authority. **Verify the exact values the app displays for this
merchant before making any DNS change.** A guessed slug or a stale hosted domain produces a funnel
the buyer cannot reach and DNS records that verify against nothing, and DNS changes are expensive to
diagnose afterwards.

Use the standard hosted shape unless a custom domain is separately approved and paid for.

For the funnel address: add the domain in HighLevel's domain settings, connect it to the enrollment
funnel, add the exact platform-provided record at the authoritative DNS host, leave the record
unproxied unless proxying has been separately verified for this setup, then confirm the public
HTTPS funnel loads.

For the sending address, follow the sending-domain guidance in `references/highlevel-setup.md`, then
save the merchant's real forwarding inbox and prove one test email arrives.

Do not treat the sending subdomain as an ordinary inbox, and do not add a catch-all without
approval. Receiving aliases are configured separately at the DNS host.

Some ScaleSafe addresses embed the location identifier — a merchant terms URL commonly does. Take
these from the app rather than constructing them, and verify them by having the owner open the app's
own link on their own screen and confirm the correct merchant appears. Never construct such a URL,
never paste one into the conversation, and never put one into a report, a brief, or an intake
record.

## Business profile

Enter the business identity, email, phone with country code, website, address, timezone, and
currency. Upload logo and favicon. Confirm sender name, sender email, forwarding address, and
compliance footer. Save, reload, and verify persistence in this sub-account only.

Timezone first, and read back by the owner. A wrong timezone silently corrupts every appointment,
delay, reminder, and pulse schedule that follows, and unwinding it later is painful.

## Merchant configuration

Complete before checking provisioning:

1. Enter legal name, trading name, support email, statement descriptor, website, location, industry,
   service type, and description.
2. Upload the logo using the app's own upload control. A share link from a cloud drive is not a logo
   URL and will break for buyers.
3. Enter the approved enrollment funnel address.
4. Enable only the evidence modules the merchant will actually use.
5. Save, reload, and verify the logo and values persist.

The HighLevel logo and the ScaleSafe logo are separate settings. Verify both — buyers see both.

## Terms and consent

1. Choose the terms source: the platform's merchant terms, approved custom terms, or the merchant's
   own terms document at a secure address.
2. Have the owner open the resulting merchant terms page on their screen and confirm it shows the
   correct merchant.
3. Enable only the acknowledgments that genuinely apply to what is being sold. Never enable every
   available clause by default — an acknowledgment the buyer did not meaningfully agree to weakens
   the record rather than strengthening it.
4. Verify the public funnel shows the correct logo, terms link, price, policies, and
   acknowledgments.

Do not build duplicate static terms pages into the snapshot. Signed packets are frozen records; test
changed terms with a new enrollment rather than editing an existing one.

## Plan entitlement and processors

Two different things gate a processor, and conflating them is why this step stalls.

**Entitlement** is what the merchant's plan permits, and it is read from the app's plan or
entitlement view. **Approved launch scope** is the narrower set this particular merchant has agreed
to actually go live with — decided by the owner with whoever provisioned the account, and recorded
in the intake before setup begins. A processor can be entitled and still out of scope.

Read entitlement from the app. Read launch scope from the intake record. If launch scope was never
recorded, that is the gap: ask the owner which processors they intend to launch with and write it
down before connecting anything, rather than treating entitlement alone as permission.

1. Confirm entitlement and any additional approval the processor requires.
2. Connect only processors the merchant owns, in scope. Separate approval, and the owner performs
   the connection in their own processor account.
3. Record the test or live state and the default processor.
4. Verify ownership before creating any offer.

Never handle processor credentials. Never place them into workflow bodies, custom values, notes,
screenshots, source control, or hosting configuration.

## Provisioning and required workflows

1. Open the app's provisioning or health view after setup and processor connection.
2. Verify the merchant record, authorization, required fields and values, processor, and trigger
   subscriptions.
3. Use only the app's own repair controls. Do not delete and recreate assets speculatively.
4. Confirm required snapshot workflows are published and use current triggers and the documented
   simple merge fields.
5. Prove each in-scope workflow end to end: trigger delivery, workflow execution, outbound message,
   and actual receipt.

Two workflows subscribing to the same trigger may be intentional. Verify purpose before removing
anything.

## Evidence connections

1. Confirm the native fulfillment source appears and is bound to this location.
2. Connect each available provider from inside the merchant's own ScaleSafe account.
3. Authorize the merchant's own provider account, never another merchant's.
4. Distinguish three different states, because they are routinely conflated: connected, event
   observed, and evidence published. Connected proves only that authorization succeeded.

## Before going live

Run `references/certification.md`. Consider setup complete only when identity, addresses, email,
terms, processor scope, provisioning, required workflows, checkout, evidence sources, and the
support owner are all documented and proven — with any open warnings written down rather than
dismissed.
