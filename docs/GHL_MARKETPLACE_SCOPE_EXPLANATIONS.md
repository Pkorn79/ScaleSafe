# GoHighLevel Marketplace Scope Explanations

Status: The editable ScaleSafe Marketplace draft was reconciled, reduced from 29 scopes to 20, saved, and reloaded on July 18, 2026.

## Review Principle

ScaleSafe requests only the permissions required by current beta behavior. A scope is retained only when current code calls its API, an enabled webhook depends on it, or HighLevel requires it for an enabled Marketplace module.

Official references:

- [HighLevel scope directory](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html)
- [Marketplace Workflow Triggers and Actions](https://marketplace.gohighlevel.com/docs/marketplace-modules/WorkflowActionsAndTriggers/index.html)
- [HighLevel Custom Payments Integration](https://marketplace.gohighlevel.com/docs/marketplace-modules/Payments/)

## Final 20 Scopes

| Scope | Why ScaleSafe needs it | Current use |
| --- | --- | --- |
| `oauth.readonly` | Identify the locations where this app is installed. | Reads installed locations during multi-location OAuth and installation validation. |
| `oauth.write` | Obtain a token limited to the selected installed sub-account. | Exchanges an agency/company authorization for a location token. |
| `locations.readonly` | Read the installed merchant's sub-account details. | Loads business identity, timezone, support details, and location configuration. |
| `locations/customFields.readonly` | Verify the ScaleSafe workflow fields installed in the location. | Provisioning Health reads required contact-field definitions. |
| `locations/customFields.write` | Create or repair required ScaleSafe workflow fields. | Provisioning creates fields used by enrollment, payment, milestone, pulse, and workflow context. |
| `locations/customValues.readonly` | Verify ScaleSafe custom values used by Snapshot assets and workflows. | Reads URLs, merchant details, and workflow/module values. |
| `locations/customValues.write` | Create or update required ScaleSafe custom values. | Provisioning and Merchant Setup synchronize the values used by Snapshot workflows. |
| `contacts.readonly` | Find the correct client and receive selected contact activity. | Reads/matches contacts and receives selected note/task webhook events. |
| `contacts.write` | Create and update client records and ScaleSafe contact fields. | Enrollment, checkout, status synchronization, and merchant-authorized notes update the correct contact. |
| `conversations.readonly` | Locate a client's HighLevel conversation thread. | Finds the conversation attached to the client record. |
| `conversations/message.readonly` | Read timestamped inbound and outbound communications. | Displays communication history and records selected message events as evidence. |
| `conversations/message.write` | Send enrollment links and merchant-authorized client messages. | Sends messages through the merchant's HighLevel communication channels. |
| `calendars/events.readonly` | Receive appointment activity without changing calendars. | Appointment create/update/delete events can become client-engagement evidence. |
| `workflows.readonly` | Make ScaleSafe Marketplace workflow triggers available in HighLevel. | HighLevel requires this scope for the enabled ScaleSafe workflow trigger module. |
| `products.readonly` | Support HighLevel's enabled custom payment-provider flow. | HighLevel's custom-payment-provider module uses the product selected for checkout. |
| `products.write` | Create the GHL product paired with a ScaleSafe offer. | Offer creation posts the matching product to HighLevel. |
| `products/prices.readonly` | Support HighLevel's enabled custom payment-provider flow. | HighLevel passes the selected product price into the provider checkout. |
| `products/prices.write` | Create the GHL prices paired with ScaleSafe offer payment options. | Offer creation posts paid-in-full and installment price records when configured. |
| `payments/custom-provider.readonly` | View the ScaleSafe/WholePay provider connection state. | Required by HighLevel's custom payment-provider module for provider configuration status. |
| `payments/custom-provider.write` | Register, connect, repair, or remove the ScaleSafe/WholePay provider bridge. | ScaleSafe calls HighLevel's custom-provider registration and connection endpoints. |

## Removed Scopes

The following nine permissions were removed from the editable Marketplace draft on July 18, 2026 because current beta behavior does not use them:

- `locations.write`
- `marketplace-external-auth-migration.write`
- `objects/schema.readonly`
- `objects/schema.write`
- `objects/record.readonly`
- `opportunities.readonly`
- `opportunities.write`
- `payments/integration.readonly`
- `payments/integration.write`

Opportunity access was legacy. The old pipeline lookup and opportunity-creation methods are not called by the current enrollment flow. ScaleSafe milestones are app-owned.

## Enabled GHL Webhooks

The current draft has only these platform webhook events enabled:

- `AppointmentCreate`
- `AppointmentUpdate`
- `AppointmentDelete`
- `InboundMessage`
- `OutboundMessage`
- `NoteCreate`
- `NoteUpdate`
- `NoteDelete`
- `TaskCreate`
- `TaskComplete`
- `TaskDelete`

Seven Opportunity events and `PriceCreate` were disabled. The app does not need those events for its current beta behavior.

## Exact Scope Video Script

Record this as a separate video from the end-to-end product walkthrough. Keep the install link, client ID, client secret, SSO key, credentials, and webhook secrets hidden.

### Opening

**On screen:** HighLevel Marketplace > ScaleSafe > Advanced Settings > Auth. Show the `20 Scopes selected` count.

**Say:**

"This video explains why ScaleSafe requests each of its twenty GoHighLevel permissions and how the data is used. ScaleSafe is installed into a specific sub-account, and every merchant record is bound to that location. The app does not request permission to create or delete locations, manage custom objects or opportunities, edit funnels or courses, manage email campaigns, or read broad HighLevel orders and transactions."

### OAuth And Location

**On screen:** Scroll to OAuth and Locations. Do not expose install credentials.

**Say:**

"The `oauth.readonly` permission lets ScaleSafe identify the sub-accounts where the app is installed. `oauth.write` lets ScaleSafe exchange an agency authorization for a token limited to the selected installed sub-account. `locations.readonly` lets the app read that location's business name, timezone, and merchant details. ScaleSafe does not request `locations.write`, so it cannot create, modify, or delete sub-accounts."

### Custom Fields And Values

**On screen:** Show the four Custom Fields and Custom Values scopes, then briefly show ScaleSafe Settings > Provisioning Health.

**Say:**

"ScaleSafe uses `locations/customFields.readonly` and `locations/customFields.write` to verify, create, and repair the contact fields used by enrollment, payment, milestone, pulse, and workflow events. It uses `locations/customValues.readonly` and `locations/customValues.write` to verify and synchronize the merchant details, URLs, and settings used by the installed ScaleSafe Snapshot and workflows."

### Contacts

**On screen:** Show `contacts.readonly` and `contacts.write`, then a fictional client record in ScaleSafe.

**Say:**

"`contacts.readonly` lets ScaleSafe find the correct GoHighLevel contact and read the contact activity required for client matching and evidence. `contacts.write` lets ScaleSafe create or update the client during enrollment and synchronize ScaleSafe status and workflow fields back to that same contact. Contact data is always limited to the installed sub-account."

### Conversations And Messages

**On screen:** Show the three selected Conversations scopes, then the Messages tab for a fictional client.

**Say:**

"`conversations.readonly` lets ScaleSafe locate the client's conversation thread. `conversations/message.readonly` lets the app read timestamped inbound and outbound messages so service communications can appear in the client record and evidence timeline. `conversations/message.write` lets the merchant send enrollment links and other authorized client messages through HighLevel. ScaleSafe does not request general conversation write access."

### Appointments

**On screen:** Show `calendars/events.readonly`, then one appointment evidence record.

**Say:**

"`calendars/events.readonly` lets ScaleSafe receive appointment create, update, and delete events as client-engagement evidence. It is read-only. ScaleSafe does not book, reschedule, or cancel appointments. A scheduled appointment is recorded as engagement and is not treated as completed delivery unless the event status supports that conclusion."

### Workflows

**On screen:** Show `workflows.readonly`, then Marketplace > Modules > Workflows with the approved ScaleSafe triggers.

**Say:**

"`workflows.readonly` is required by HighLevel for Marketplace workflow triggers. ScaleSafe provides approved triggers for enrollment, receipts, payment events, pulse checks, milestones, refunds, subscription events, and defense events. The Snapshot workflows subscribe to those triggers and send the merchant's configured email or SMS actions. ScaleSafe does not request workflow write access."

### Products And Prices

**On screen:** Show the four Product scopes, then create or open a fictional ScaleSafe offer and its payment options.

**Say:**

"ScaleSafe's offer and payment-provider bridge uses HighLevel product and price records. `products.write` and `products/prices.write` let ScaleSafe create the matching product and paid-in-full or installment price records when a merchant creates an offer. `products.readonly` and `products/prices.readonly` support HighLevel's custom payment-provider flow so the selected product and price can be passed into checkout. ScaleSafe does not request product collection permissions."

### Custom Payment Provider

**On screen:** Show the two Custom Provider scopes, then Marketplace > Modules > Payment Providers and the WholePay provider entry. Do not expose keys.

**Say:**

"`payments/custom-provider.readonly` lets HighLevel display the connection status for the ScaleSafe and WholePay payment-provider integration. `payments/custom-provider.write` lets ScaleSafe register, connect, repair, and remove that provider bridge for the installed sub-account. These permissions do not expose processor credentials and do not grant ScaleSafe broad access to HighLevel orders, subscriptions, or transaction history."

### Webhook Boundary

**On screen:** Open Advanced Settings > Webhooks and slowly show the enabled toggles.

**Say:**

"The enabled HighLevel webhooks are limited to appointment events, inbound and outbound messages, and selected note and task activity. Those events support the client activity and evidence record. Opportunity and product-price webhooks are disabled because ScaleSafe does not need them for the current beta."

### Close

**On screen:** Return to the ScaleSafe dashboard or Provisioning Health.

**Say:**

"In summary, ScaleSafe uses these twenty permissions to bind the app to one installed sub-account, provision its workflow fields and values, manage client enrollment and communication records, capture appointment and message evidence, create offer products and prices, operate its custom payment-provider bridge, and deliver approved Marketplace workflow triggers. Unused permissions have been removed from the app draft."

## Recording Package

- End-to-end video: installation, connection, dashboard, offer, checkout, payment, client, evidence, and defense.
- Workflow proof: append this clip to the end-to-end video. It is part of the same user journey and does not belong in the scope video.
- Scope video: record the exact script above as the separate permission-justification video.

## Final Verification

Because existing installations retain the permissions granted when they were installed, reinstall or reauthorize the clean reviewer sub-account after the final draft is saved. Then verify SSO, offer creation, product/price creation, checkout, contacts, conversations, appointment evidence, workflow triggers, and payment-provider health without re-adding any removed scope.
