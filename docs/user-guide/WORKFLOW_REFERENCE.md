# ScaleSafe Workflow Reference

Status: Working verification matrix.

Each workflow is documented across the complete system, not only the button a merchant clicks.

| Workflow | Merchant Action | Expected ScaleSafe Result | Expected External Result | Evidence or Audit Result | Verification |
| --- | --- | --- | --- | --- | --- |
| Open dashboard | Open ScaleSafe from a GHL sub-account | Dashboard loads for the current location only | No external mutation | Read-only | Verified |
| Review offer catalog | Open Offers | Active and archived offers display with tracking, processor, payment type, links, and actions | No external mutation | Read-only | Verified |
| Review client record | Search for a client and open the profile | Overview, Programs, Payments, Evidence, Messages, and Files remain tied to that contact | No external mutation | Linked and unlinked evidence states are visible | Verified read-only |
| Review payment ledger | Open Payments and apply filters | Ledger shows source and processor transaction IDs without changing payment state | No external mutation | Read-only | Verified |
| Run reconciliation | Open Payments > Reconciliation and choose Run Check | Current processor-integrity warnings are recalculated | Reads the configured diagnostic sources; no money action | Reconciliation result is recorded without automatic repair | Verified live |
| Add client note | Open a client, choose Add Note, and save | One note is stored for the selected client | GHL records the note and sends its webhook echo | Client-level note/custom-event evidence is created | Verified live |
| Send direct client message | Open a client, choose Send Message, select a program and channel, and send | One outbound communication is created for the selected enrollment | GHL sends and echoes the message | Communication carries the exact enrollment; general messages may remain client-level | Contract/UI verified; one post-fix live outbound proof remains |
| Send enrollment link | Select a client and offer, then send | Enrollment link is generated for the selected client and offer | GHL workflow sends the configured message | Delivery attempt and enrollment state are recorded | Verified live |
| Assign offer | Select Assign Offer, choose an offer, and confirm | Client is directly enrolled without consent pages or payment | No payment or enrollment-link workflow | Enrollment exists without checkout consent/payment proof | Preview verified; action not run |
| Full enrollment | Client completes the enrollment funnel | Enrollment, consent, program, and payment records are linked | Processor handles payment and GHL sends welcome workflow | Enrollment and payment evidence are created | Verified live with Stripe and Whop |
| Quick checkout | Client uses a quick checkout link | Client and payment are linked to the selected offer | Processor records the payment | Payment and enrollment evidence are created | Verified live; dual-option PIF state fix awaits deployment readback |
| Quick Manual Sale | Merchant charges from the client profile | Payment is collected before consent completion | Processor records charge; enrollment link is sent | Paid-pending enrollment becomes enrolled after consent | Verified live with Stripe, NMI, and Whop paths |
| Client-only manual charge | Open QMS and leave Offer / Program unassigned | Payment is recorded against the client only | Processor records the charge | No enrollment packet or welcome workflow; payment remains unassigned | Preview verified; action not run |
| Whop QMS | Select a Whop offer in QMS and create checkout | Hosted Whop checkout loads inside the QMS modal | Whop collects payment | ScaleSafe records the payment after confirmation and can send paid enrollment consent | Preview verified; checkout not created |
| Refund | Merchant refunds an eligible payment | Refund state appears once | Processor confirms the refund | Refund evidence and workflow are recorded once | Verified live for Stripe, NMI, and Whop |
| Pause subscription | Merchant pauses an eligible recurring plan | Plan changes to paused after processor success | Supported processor pauses membership/subscription | Pause evidence and workflow are recorded | Pending current pass |
| Resume subscription | Merchant resumes a paused plan | Plan returns to active after processor success | Supported processor resumes membership/subscription | Resume evidence and workflow are recorded | Pending current pass |
| Cancel subscription | Merchant cancels an eligible plan | Plan changes to cancelled after processor success | Supported processor cancels membership/subscription | Cancellation evidence is recorded | Pending current pass |
| Complete milestone | Merchant records milestone completion | Correct enrollment and milestone are updated | GHL sends the correct program-specific sign-off request | Milestone evidence is enrollment-scoped | Verified live |
| Pulse check-in | Client submits a pulse form | Dashboard displays response and follow-up status | GHL sends the configured pulse communication | Pulse evidence is linked to the exact enrollment | Verified live end to end |
| Compile defense | Merchant selects a transaction and reason code | Packet compiles or is held for review | Stripe submission remains separate until confirmed | Exhibits are scoped to the disputed enrollment | Verified live; missing delivery correctly produced Needs Review |
| Review defense packet | Open a case and review Letter, Exhibits, History, and Outcome | Packet status, deadline, PDF, editable letter, versions, and outcome controls display | No external mutation | Read-only | Verified with one UI inconsistency logged |
| Review active disputes | Open Stripe Risk Health > Active Disputes | Only actionable disputes with real Stripe IDs appear with status-appropriate actions | No external mutation | Read-only | Terminal dispute filtering verified; manual-row guard fixed locally and awaits deploy readback |
| Refresh Stripe risk audit | Open Stripe Risk Health and choose Refresh | Stripe-only health and normalized audit scores refresh | Reads connected Stripe account | Updated health/audit snapshot | Verified live |
| External evidence | Connected provider sends verified activity | Event appears under the resolved client and program | Provider connection remains tenant-bound | Defense-ready external evidence is materialized | GHL Fulfillment/history verified; one real Zoom participant proof remains |

## Verification Standard

A workflow is marked verified only when the test records:

- The exact merchant action.
- The client and offer used.
- The processor or integration used.
- The expected ScaleSafe state.
- The expected external state.
- The evidence or audit record created.
- The workflow delivery result when applicable.
- A screenshot or stable record identifier.
