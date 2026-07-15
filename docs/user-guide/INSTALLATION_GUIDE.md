# ScaleSafe Installation Guide

This runbook installs ScaleSafe into one GoHighLevel sub-account. Repeat it independently for every merchant location. A merchant installation never uses another merchant's location, processor credentials, or evidence.

## Before Installation

Record these values in the onboarding worksheet:

- GHL agency and sub-account names.
- GHL location ID.
- Merchant legal/display name, support email, timezone, and website.
- Merchant checkout subdomain or approved funnel domain.
- Intended processors and whether each is test or live.
- Whether Zoom or another evidence connection is in launch scope.

Do not place a merchant location ID, processor credential, or provider token in Railway. Railway contains app-level credentials only. Merchant setup is stored against the GHL location in ScaleSafe.

## Install The Marketplace App And Snapshot

1. Sign in to GHL and open the exact merchant sub-account.
2. Open Marketplace and install ScaleSafe for that sub-account.
3. Select the intended sub-account when GHL asks where to install it.
4. Review the attached Snapshot resources, type `confirm` when GHL requests confirmation, and finish the installation.
5. Return to the same sub-account and open ScaleSafe from its custom menu item.

Expected result:

- ScaleSafe opens without an agency-wide account chooser.
- The dashboard belongs only to the selected location.
- A new location starts with its own offers, clients, payments, evidence, and settings.

Stop if ScaleSafe displays data from another location. Do not continue setup or attempt to repair it by selecting another account.

## Complete Merchant Setup

1. In ScaleSafe, open **Settings**.
2. Complete **Merchant Setup** before running Provisioning Health.
3. Enter the merchant business/support information and the approved enrollment-funnel URL or subdomain.
4. Save and confirm the page reports that changes are saved.
5. Open **Settings > Payments** and configure only the processors the merchant will use.

Processor ownership:

- Stripe reviewer testing uses the connected Stripe test account.
- NMI live credentials and MID routing are owner-controlled.
- Whop uses the merchant's connected Whop account and hosted checkout.
- FanBasis remains disabled until separately approved and certified.

Never paste processor secrets into a GHL workflow, custom value, screenshot, or support note.

## Run Provisioning Health

After Merchant Setup and processor configuration:

1. Open **Settings > Provisioning Health**.
2. Run or refresh the check.
3. Confirm the merchant record, GHL OAuth connection, workflow authentication, required custom fields/values, and active processor configuration.
4. Confirm trigger subscriptions exist for the workflows included in the merchant's beta scope.
5. Confirm pulse/reminder diagnostics only when those features are enabled.
6. Save a sanitized screenshot and record every warning in the install worksheet.

A warning is not automatically a checkout blocker. Classify it by the exact health message and test the affected workflow. Do not delete or recreate GHL assets without owner approval.

## Connect Evidence Sources

1. Open **Settings > Evidence Connections**.
2. GHL Fulfillment should appear as the native location-bound source.
3. Connect Zoom or another released provider from inside this merchant's ScaleSafe account.
4. Complete provider authorization as the merchant.
5. Confirm health distinguishes **Connected** from **Event observed** and **Evidence published**.

Each merchant authorizes their own provider account. No per-merchant provider value is added to Railway.

## Certification Smoke Test

Run the smoke test in this order:

1. Create one Stripe test paid-in-full offer with a public program name and a distinct internal name.
2. Create one fictional client.
3. Send the enrollment link.
4. Complete enrollment and Stripe test payment.
5. Confirm the payment, enrollment, signed packet, receipt, and welcome workflow.
6. Confirm the client Evidence tab links consent and payment to the exact program.
7. Run one milestone or GHL appointment evidence test if included in scope.
8. Compile one test defense and confirm unsafe/missing evidence produces **Needs Review** rather than an unquestioned ready state.

Record browser, Railway, Supabase, GHL, and processor results using `DEEP_DIVE_TEST_PLAN.md`.

## Final Handoff

The location is ready only when:

- Provisioning Health has no unexplained blocker.
- The intended processors are identified as test or live.
- Required workflows have one successful proof.
- The checkout and evidence smoke test passes.
- Open warnings have an owner, workaround, or explicit scope exclusion.
- No credentials or private client data appear in the handoff document.
