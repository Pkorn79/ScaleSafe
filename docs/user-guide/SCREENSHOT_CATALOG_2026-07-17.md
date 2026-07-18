# ScaleSafe Screenshot Catalog - July 17, 2026

Source folder: `docs/user-guide/assets/reviewer-2026-07-17/`

## Catalog

| File | What it shows | Publication status | Recommended placement | Caveat |
| --- | --- | --- | --- | --- |
| `01-offers-list.png` | One active reviewer offer with internal name, public program name, tracking ID, price, processor, and status | Public safe | Product site, Marketplace screenshot, Offers guide | Uses a clearly labeled reviewer fixture. |
| `02-dashboard.png` | Clean dashboard counts and empty attention panels | Public safe | Product overview, Dashboard guide | Clean account is intentionally sparse. |
| `03-enrollment-program.png` | One valid enrolled program card | Public safe | Clients and Enrollments guide | Cropped to exclude the client identity and stale test row. |
| `04-defense-workspace.png` | Defense workspace with no open cases | Public safe | Defense overview | Shows the entry point, not a generated packet. |
| `05-stripe-risk-health.png` | Stripe risk metrics and thresholds | Internal only | Internal test record | Synthetic test history produces misleading critical metrics. |
| `06-evidence-connections.png` | Native GHL connection plus Custom API and Zoom options | Public safe | Integrations page and guide | Named connections will expand in waves. |
| `07-payments-overview-sanitized.png` | Payment Management filters and summary controls | Public safe | Payments help | Sanitized crop intentionally omits transaction rows. |
| `08-offer-builder.png` | Offer-builder fields and pricing configuration | Internal only | Operator reference | Initial load shows `Unsaved changes`. |
| `08-offer-builder-overview.png` | Wider offer-builder overview | Internal only | Operator reference | Same dirty-state caveat. |
| `09-public-enrollment-welcome.png` | Blank public client information step | Public safe | Enrollment-flow walkthrough | No client data is entered. |
| `10-public-offer-review.png` | Offer summary, price, milestone responsibilities, refund policy, and support | Public safe | Homepage/product page, Marketplace journey, enrollment guide | Continue is disabled until the milestone acknowledgment is selected. |
| `10-merchant-terms-page.png` | Public terms page generated for the reviewer merchant | Internal only | Merchant setup reference | It is not ScaleSafe's platform Terms of Service. |

## PMG Public-Site Assets

Source folder: `website/public/images/product/`

| File | What it shows | Publication status | Recommended placement | Caveat |
| --- | --- | --- | --- | --- |
| `dashboard-operations.png` | Active PMG dashboard with open disputes, pulse follow-up, defense activity, and operating totals | Public approved | Homepage hero, product overview, VSL | Uses the active test environment and should not be described as a typical merchant result. |
| `client-programs-high-ticket.png` | High-ticket client program record with payment, delivery, and program context | Public approved | Product page, client journey, VSL | Use to explain enrollment-level tracking rather than promise a particular outcome. |
| `evidence-pulse-linked.png` | Pulse response preserved as evidence under the related program | Public approved | Evidence page, pulse explanation, VSL | Reason-code labels are relevance metadata, not factual allegations. |
| `evidence-connections-live.png` | Live GHL and Zoom evidence connections and connection health | Public approved | Integrations page, setup guide, VSL | Only describe integrations shown as connected or currently supported. |
| `stripe-risk-health-live.png` | Stripe risk and account-health workspace populated with PMG test activity | Public approved with context | Stripe defense page, VSL | Test-heavy activity can produce unusual risk totals; caption it as an operating view, not a benchmark. |

## Existing Public Help And Legal Sources

| Public page | Source file | Current role |
| --- | --- | --- |
| `/privacy.html` | `marketing/privacy.html` | ScaleSafe Privacy Policy |
| `/terms.html` | `marketing/terms.html` | ScaleSafe Terms of Service |
| `/support.html` | `marketing/support.html` | Support contact and help routing |
| `/guide.html` | `marketing/guide.html` | Current user guide |
| `/faq.html` | `marketing/faq.html` | Current FAQ |
| `/troubleshooting.html` | `marketing/troubleshooting.html` | Current troubleshooting page |
| `/` | `marketing/index.html` | Current placeholder/product site |

All seven public URLs returned HTTP 200 on July 17, 2026. The legal URLs can remain stable during a complete visual/content rebuild. The guide, FAQ, troubleshooting, support, and homepage content should be rebuilt around the verified product flows and the sanitized media package.

## Next Capture Session

Create one fictional client in the reviewer sub-account, then capture the full story with consistent names and dates:

1. Offer and public enrollment.
2. Successful Stripe sandbox payment and enrollment.
3. Receipt and welcome communication.
4. Milestone completion and sign-off.
5. Pulse submission and merchant follow-up state.
6. Appointment and Zoom attendance evidence.
7. Enrollment-scoped evidence timeline.
8. Review-ready defense packet and exhibit list.

That single fictional journey will provide the missing screenshots for the new site, reviewer videos, user guide, FAQ, and workflow documentation without exposing real test records.
