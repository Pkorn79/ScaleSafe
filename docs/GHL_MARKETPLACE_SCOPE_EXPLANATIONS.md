# GoHighLevel Marketplace Scope Explanations

Status: The editable ScaleSafe Marketplace draft was reconciled, reduced from 29 scopes to 20, saved, and reloaded on July 18, 2026.

Official references:

- [HighLevel scope directory](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html)
- [Marketplace Workflow Triggers and Actions](https://marketplace.gohighlevel.com/docs/marketplace-modules/WorkflowActionsAndTriggers/index.html)
- [HighLevel Custom Payments Integration](https://marketplace.gohighlevel.com/docs/marketplace-modules/Payments/)

## Final Scopes In Marketplace Page Order

| Order | Scope | Why ScaleSafe needs it |
| --- | --- | --- |
| 1 | `calendars/events.readonly` | Receive appointment activity as client-engagement evidence. |
| 2 | `contacts.readonly` | Find the correct client and read the contact activity used for matching and evidence. |
| 3 | `contacts.write` | Create and update client records and ScaleSafe workflow fields. |
| 4 | `conversations.readonly` | Locate a client's HighLevel conversation thread. |
| 5 | `conversations/message.readonly` | Read timestamped inbound and outbound communications. |
| 6 | `conversations/message.write` | Send enrollment links and merchant-authorized client messages. |
| 7 | `locations/customFields.readonly` | Verify the ScaleSafe workflow fields installed in the location. |
| 8 | `locations/customFields.write` | Create or repair required ScaleSafe workflow fields. |
| 9 | `locations.readonly` | Read the installed merchant's sub-account details. |
| 10 | `locations/customValues.readonly` | Verify ScaleSafe custom values used by Snapshot assets and workflows. |
| 11 | `locations/customValues.write` | Create or update required ScaleSafe custom values. |
| 12 | `oauth.write` | Obtain a token limited to the selected installed sub-account. |
| 13 | `oauth.readonly` | Identify the locations where the ScaleSafe app is installed. |
| 14 | `payments/custom-provider.readonly` | View the ScaleSafe and WholePay provider connection state. |
| 15 | `payments/custom-provider.write` | Register, connect, repair, or remove the payment-provider bridge. |
| 16 | `products.readonly` | Support HighLevel's custom payment-provider checkout using the selected product. |
| 17 | `products.write` | Create the HighLevel product paired with a ScaleSafe offer. |
| 18 | `products/prices.readonly` | Support HighLevel checkout using the selected product price. |
| 19 | `products/prices.write` | Create the HighLevel prices paired with ScaleSafe payment options. |
| 20 | `workflows.readonly` | Make the approved ScaleSafe Marketplace workflow triggers available in HighLevel. |

## Exact Scope Video Script

Stay on **HighLevel Marketplace > ScaleSafe > Advanced Settings > Auth** and scroll straight down the page. Keep the install link and app credentials hidden.

### Opening

**On screen:** Show `20 Scopes selected`.

**Say:**

"This video explains the twenty GoHighLevel permissions requested by ScaleSafe and how each permission is used inside the app."

### Calendars

**On screen:** Calendars > `calendars/events.readonly`.

**Say:**

"ScaleSafe uses `calendars/events.readonly` to receive appointment activity. This allows scheduled, updated, completed, cancelled, and no-show appointment information to become timestamped client-engagement evidence."

### Contacts

**On screen:** Contacts > `contacts.readonly` and `contacts.write`.

**Say:**

"`contacts.readonly` lets ScaleSafe find and match the correct GoHighLevel contact and read the contact activity used in the client and evidence records. `contacts.write` lets ScaleSafe create or update that client during enrollment and synchronize enrollment, payment, milestone, pulse, and program status fields back to the contact."

### Conversations

**On screen:** Conversations > the three selected scopes.

**Say:**

"`conversations.readonly` lets ScaleSafe locate the client's HighLevel conversation thread. `conversations/message.readonly` lets ScaleSafe read timestamped inbound and outbound messages for the client communication and evidence timeline. `conversations/message.write` lets the merchant send enrollment links and other authorized client messages through HighLevel."

### Custom Fields

**On screen:** Custom Fields > the two selected scopes.

**Say:**

"`locations/customFields.readonly` lets ScaleSafe verify the custom fields installed for its workflows. `locations/customFields.write` lets ScaleSafe create or repair the fields used to pass enrollment, payment, milestone, pulse, and program information into HighLevel."

### Locations

**On screen:** Locations > `locations.readonly` and the two selected Custom Values scopes.

**Say:**

"`locations.readonly` lets ScaleSafe read the business identity, timezone, and merchant details for the sub-account where the app is installed. `locations/customValues.readonly` lets ScaleSafe verify the merchant settings, URLs, and workflow values supplied with the ScaleSafe Snapshot. `locations/customValues.write` lets ScaleSafe create and update those required values during provisioning and Merchant Setup."

### OAuth

**On screen:** OAuth > `oauth.write` and `oauth.readonly`.

**Say:**

"`oauth.write` lets ScaleSafe exchange the authorized agency installation for a token limited to the selected sub-account. `oauth.readonly` lets ScaleSafe identify the sub-accounts where the app has been installed. Together, these permissions bind each ScaleSafe session and merchant record to the intended GoHighLevel location."

### Payments

**On screen:** Payments > the two selected Custom Provider scopes.

**Say:**

"`payments/custom-provider.readonly` lets HighLevel display the connection status for the ScaleSafe and WholePay payment-provider integration. `payments/custom-provider.write` lets ScaleSafe register, connect, repair, and remove that provider bridge for the installed sub-account."

### Products

**On screen:** Products > the four selected scopes.

**Say:**

"ScaleSafe pairs each offer with HighLevel product and price records for its checkout and payment-provider flow. `products.readonly` and `products/prices.readonly` let HighLevel use the selected product and price during checkout. `products.write` and `products/prices.write` let ScaleSafe create the matching product and paid-in-full or installment price records when the merchant creates an offer."

### Workflows

**On screen:** Workflows > `workflows.readonly`.

**Say:**

"`workflows.readonly` is required by HighLevel for ScaleSafe's approved Marketplace workflow triggers. These triggers carry enrollment, receipt, payment, pulse, milestone, subscription, refund, and defense events into the workflows installed with the ScaleSafe Snapshot."

### Close

**On screen:** Leave the Workflows scope visible.

**Say:**

"These twenty permissions support ScaleSafe installation, provisioning, offers, checkout, client records, communications, evidence collection, payments, and HighLevel workflow automation."

## Recording Package

- Append the workflow proof clip to the end-to-end product walkthrough.
- Record the scope explanation above as a separate video.
