# GoHighLevel Marketplace Scope Explanations

Status: Code-backed scope review completed July 17, 2026. The dedicated reviewer installation currently holds 29 granted scopes. Before submission, confirm that the editable Marketplace draft still matches that installed grant.

## Review Principle

ScaleSafe should request only the permissions required by current beta behavior. An attached Marketplace Snapshot does not, by itself, justify a runtime API scope. A scope belongs in the app only when current code calls the covered API, receives a selected webhook that requires it, or HighLevel requires it for a current Marketplace module.

Official references:

- [HighLevel scope directory](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html)
- [Marketplace Workflow Triggers and Actions](https://marketplace.gohighlevel.com/docs/marketplace-modules/WorkflowActionsAndTriggers/index.html)
- [Custom Marketplace Triggers](https://marketplace.gohighlevel.com/docs/marketplace-modules/CustomTriggers/index.html)
- [HighLevel webhook directory](https://marketplace.gohighlevel.com/docs/category/webhook/)

## Current 29-Scope Reconciliation

The reviewer installation's stored OAuth grant was read from the production merchant record on July 17, 2026. It contains:

| Classification | Scopes |
| --- | --- |
| Retain - current code-backed use | `calendars/events.readonly`, `contacts.readonly`, `contacts.write`, `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write`, `locations.readonly`, `locations/customFields.readonly`, `locations/customFields.write`, `locations/customValues.readonly`, `locations/customValues.write`, `oauth.readonly`, `oauth.write`, `opportunities.readonly`, `opportunities.write`, `payments/custom-provider.write`, `products.write`, `products/prices.write`, `workflows.readonly` |
| Conditional - prove before keeping | `payments/custom-provider.readonly` |
| Remove unless a missed live dependency is proven | `locations.write`, `marketplace-external-auth-migration.write`, `objects/record.readonly`, `objects/schema.readonly`, `objects/schema.write`, `payments/integration.readonly`, `payments/integration.write`, `products.readonly`, `products/prices.readonly` |

This is a reconciliation of the installed authorization grant, not proof that the current unsaved Marketplace draft has not changed. After editing scopes, reauthorize the clean reviewer installation and repeat the fresh-install certification.

## Code-Backed Scopes To Retain

| Scope | Current ScaleSafe use | Reviewer explanation | Code proof |
| --- | --- | --- | --- |
| `oauth.readonly` | Resolve the sub-accounts in which the Marketplace app is installed. | ScaleSafe reads the app's installed locations so installation and agency-to-location authorization remain bound to the intended sub-account. | `src/clients/ghl.client.ts` calls `/oauth/installed-locations` and `/oauth/installedLocations`. |
| `oauth.write` | Exchange an agency/company token for a location token. | ScaleSafe exchanges the authorized agency token for a token limited to the selected installed sub-account. | `src/clients/ghl.client.ts#getLocationToken` calls `/oauth/locationToken`. |
| `locations.readonly` | Read merchant/sub-account identity and configuration. | ScaleSafe reads the installed location's business details to provision and display the correct merchant account. | `src/services/merchant.service.ts#fetchLocationInfo` calls `/locations/:locationId`. |
| `contacts.readonly` | Read and match clients, notes, and contact records. | ScaleSafe reads the correct contact so enrollment, payment, communication, and evidence records remain attached to that client. | Contact reads and duplicate searches are used throughout `src/controllers/dashboard.controller.ts`, `src/services/enrollment.service.ts`, and related services. |
| `contacts.write` | Create/update contacts and add contact notes. | ScaleSafe creates or updates client records, writes workflow context fields, and adds merchant-authorized notes. | `/contacts`, `/contacts/upsert`, `/contacts/:id`, and `/contacts/:id/notes` calls appear in enrollment, checkout, dashboard, and payment services. |
| `locations/customFields.readonly` | Inspect required ScaleSafe workflow fields. | ScaleSafe verifies that required custom fields exist and diagnoses missing workflow setup. | `src/services/merchant.service.ts` reads `/locations/:locationId/customFields`. |
| `locations/customFields.write` | Create or repair required ScaleSafe workflow fields. | ScaleSafe provisions the custom fields used to pass offer, payment, milestone, pulse, and enrollment data into HighLevel workflows. | `src/services/merchant.service.ts` creates and repairs location custom fields. |
| `locations/customValues.readonly` | Read ScaleSafe custom values used by Snapshot assets and workflows. | ScaleSafe verifies the location's workflow URLs, support details, and module settings. | `src/services/merchant.service.ts` reads `/locations/:locationId/customValues`. |
| `locations/customValues.write` | Create/update ScaleSafe custom values. | ScaleSafe provisions and updates the custom values required by the installed Snapshot and workflow links. | `src/services/merchant.service.ts` creates and updates location custom values. |
| `conversations.readonly` | Find conversation threads for a client. | ScaleSafe finds the client's HighLevel conversation so service communications can be shown in the client record and considered as evidence. | `src/services/communication.service.ts` and `src/controllers/dashboard.controller.ts` call `/conversations/search`. |
| `conversations/message.readonly` | Read inbound and outbound messages. | ScaleSafe reads timestamped messages so merchant/client communications can be recorded in the evidence timeline where enabled. | `src/services/communication.service.ts` reads `/conversations/:conversationId/messages`; inbound/outbound message webhooks are also enabled for evidence capture. |
| `conversations/message.write` | Send enrollment links and merchant-authorized email/SMS. | ScaleSafe sends enrollment links and messages through the merchant's HighLevel conversation channels. | `src/services/enrollment-link-delivery.service.ts`, `src/controllers/send-link.controller.ts`, and `src/controllers/dashboard.controller.ts` post to `/conversations/messages`. |
| `workflows.readonly` | Enable ScaleSafe Marketplace workflow triggers. | HighLevel requires this scope for Marketplace Workflow Triggers and Actions. ScaleSafe uses those triggers for enrollment, receipts, payment events, pulse checks, milestones, and defense events. | HighLevel's Marketplace module requirement plus ScaleSafe trigger subscription and delivery services. |
| `calendars/events.readonly` | Receive appointment create/update/delete events. | ScaleSafe records appointment activity as client-engagement evidence. A scheduled appointment is not treated as completed service delivery. | `src/services/ghl-fulfillment.service.ts` checks this scope and the app consumes appointment webhooks. |
| `products.write` | Create a GHL product when a ScaleSafe offer is created. | ScaleSafe currently creates a HighLevel product record for each offer used by its checkout/payment-provider bridge. | `src/services/offer.service.ts#create` posts to `/products/`. |
| `products/prices.write` | Create GHL price records for offer payment options. | ScaleSafe currently creates the matching HighLevel paid-in-full or installment price records for an offer. | `src/services/offer.service.ts#create` posts to `/products/:productId/price`. |
| `opportunities.readonly` | Read pipelines used when recording enrollment opportunities. | ScaleSafe reads the location's pipelines before creating the enrollment opportunity record. | `src/services/merchant.service.ts#findPipeline` calls `/opportunities/pipelines`. |
| `opportunities.write` | Create an opportunity during enrollment. | ScaleSafe currently creates a HighLevel opportunity for an enrolled client. | `src/services/enrollment.service.ts` posts to `/opportunities/`. |
| `payments/custom-provider.write` | Register and connect ScaleSafe as a GHL custom payment provider. | ScaleSafe registers, connects, repairs, and removes its custom payment-provider bridge for the installed sub-account. | `src/services/payment-provider.service.ts` calls the HighLevel custom-provider write endpoints. |

## Important Product Dependency

Do not remove `products.write`, `products/prices.write`, `opportunities.readonly`, or `opportunities.write` from the live app merely because Products and Opportunities are not primary merchant-facing ScaleSafe features. Current code still uses them.

They can be removed only after the runtime dependency is intentionally refactored and a fresh-install certification proves that offer creation, enrollment, checkout mapping, and workflows still work without them.

## Conditional Scopes Requiring A Decision

| Scope | Current state | Decision before submission |
| --- | --- | --- |
| `invoices.readonly` | ScaleSafe contains invoice-event normalization, but invoice evidence is not yet proven as a required beta path. | Retain only if invoice webhooks are selected and invoice activity is included in the beta claim and live certification. Otherwise remove the scope and invoice claims. |
| `payments/orders.readonly` | ScaleSafe can normalize selected GHL order/payment events, but primary payment processing occurs through ScaleSafe's Stripe, NMI, and Whop paths. | Retain only if native GHL order webhook compatibility is intentionally part of beta and tested. |
| `payments/custom-provider.readonly` | The current runtime writes provider setup but no current code-backed GET requirement was found. | Keep only if HighLevel's live provider installation flow demonstrably requires it. Record that proof in the fresh-install test. |

## Scope Families Not Used By Current Beta Code

These should be deselected unless the exact live scope export reveals a current code path or selected webhook that was missed:

- Businesses and Companies.
- Calendar creation, calendar groups, calendar resources, and appointment write access.
- General conversation write, conversation reports, and live-chat typing.
- Courses API read/write. Course evidence currently comes through authenticated evidence connectors, not the GHL Courses API.
- Custom Menu Link API scopes.
- Email builder, schedule, template, campaign, and statistics scopes. ScaleSafe message activity uses Conversations.
- Forms API scopes. ScaleSafe's custom form webhook bridge is not the GHL Forms API.
- Funnel API scopes. The Snapshot supplies funnel assets; ScaleSafe does not currently read or edit them through the Funnels API.
- Product read and product collection scopes. Current code creates products/prices but does not read products or manage collections.
- Invoice write scopes.
- Payment transaction, subscription, coupon, order write, or other broad payment scopes unless a specific current route is proven.
- Snapshot API scopes. Attaching a Snapshot in Marketplace is configuration, not a runtime Snapshot API call.

## Scope Explanation Video Runbook

Record one short screen walkthrough and connect each retained permission to a visible use:

1. Install ScaleSafe into one test sub-account and open it from that location. Explain `oauth.readonly`, `oauth.write`, and `locations.readonly`.
2. Open Merchant Setup and Provisioning Health. Show the required custom fields/values without exposing secrets. Explain the four custom-field/custom-value scopes.
3. Create a test offer. Show the ScaleSafe offer and explain that current code also creates its GHL product and price records.
4. Create or enroll a fictional test client. Show the client record and explain contact read/write plus the current enrollment opportunity.
5. Send one enrollment link or test message. Show the received message and explain conversation/message permissions.
6. Show one published ScaleSafe workflow trigger and its delivery. Explain `workflows.readonly`.
7. Show one test appointment appearing as appointment evidence. Explain `calendars/events.readonly` and state that scheduled does not mean attended.
8. Show Custom Payment Provider health. Explain `payments/custom-provider.write` without exposing credentials or webhook secrets.

Do not show the live Marketplace scope checklist in a way that exposes app credentials. Do not claim invoice or native GHL order support in the video unless those conditional scopes have passed live certification.

## Final Submission Check

1. Export or transcribe every selected live scope exactly.
2. Match each selected scope to one retained or explicitly approved conditional row above.
3. Deselect every unmatched scope.
4. Save the Marketplace draft.
5. Reauthorize/install it in the clean ScaleSafe test sub-account.
6. Run the fresh-install, offer, enrollment, messaging, appointment, workflow, and payment-provider checks before recording the final video.
