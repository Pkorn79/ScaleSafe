**SCALESAFE**

**APP BLUEPRINT v2.1**

*Comprehensive Build Specification*

*For Claude Code Implementation*

March 25, 2026

Directed by Philip Korniotes

*This document is the single source of truth for building ScaleSafe as a
GHL Marketplace app. It describes every function, every data flow, every
event type, and every component. Claude Code builds from this spec.*

TABLE OF CONTENTS

PART 1: WHAT SCALESAFE DOES

ScaleSafe is a chargeback defense platform for high-ticket service
businesses that use GoHighLevel. It works with any payment processor the
merchant already uses. ScaleSafe automatically collects evidence of
service delivery from the moment a client enrolls, stores it in a
structured database, and when a chargeback occurs, uses AI to compile a
professional defense packet.

ScaleSafe is NOT limited to any single vertical. It serves coaching
businesses, consulting firms, agencies, course creators, professional
service providers, and any business selling services delivered over time
that faces chargeback risk.

**NOTE:** *This spec is payment-processor-agnostic. The app uses GHL\'s
Products and Prices API to create payment configurations. GHL handles
all payment processing through whatever processor the merchant has
connected (NMI, Stripe, Square, PayPal, etc.). ScaleSafe never touches
payment processing directly.*

1\. Merchant Onboarding

When a new merchant installs ScaleSafe from the GHL Marketplace, the app
automatically provisions their account. This includes creating their
evidence database structure, setting default configuration values,
registering custom workflow triggers, and preparing all GHL components
(pipeline, custom fields, forms, workflows) via Snapshot.

**Onboarding Steps:**

-   GHL OAuth callback exchanges code for access + refresh tokens and
    stores them per location\_id

-   App creates merchant record in Supabase with location\_id, tokens,
    and config defaults

-   GHL Snapshot auto-installs: Milestones Pipeline, all custom fields
    (SS- and Offer- prefixes), evidence forms (SYS2-07 through SYS2-11),
    workflows (no-show logger, module progress, pulse cadence,
    onboarding prep), and custom values

-   App registers custom workflow triggers for the location: Chargeback
    Detected, Defense Ready, Evidence Milestone, Client At Risk, Payment
    Failed

-   Merchant sees welcome dashboard with setup checklist

Onboarding Error Handling

The app must handle onboarding failures gracefully:

-   Snapshot push failure: retry with exponential backoff, alert
    merchant if still failing after 3 attempts

-   Missing scopes: detect declined OAuth scopes, show merchant exactly
    which permissions are needed and why

-   Custom Object name collision: check for existing \'Offers\' object,
    use it if schema matches, alert if incompatible

-   GHL plan limitations: detect if plan doesn\'t support Custom
    Objects, display clear upgrade guidance

2\. Offer Management

Merchants create and manage multiple service offers (programs, packages,
courses). Each offer defines the terms of a specific service engagement
and becomes the foundation for enrollment agreements and chargeback
defense.

**Offer Details Captured:**

-   Program name, description, and delivery method (1-on-1, group,
    hybrid, self-paced, done-for-you)

-   Pricing: total price, payment structure (pay-in-full or
    installments), number of installments, installment amount, billing
    frequency

-   Duration and deliverables: number of sessions, modules, or
    milestones included

-   Refund policy: window (days), conditions, partial/full/prorated/none

-   Terms & conditions: merchant can use ScaleSafe standard clauses
    (toggled on/off) or provide their own T&C document URL

-   Milestone definitions: names and descriptions of each program
    milestone for the sign-off system

**What Happens When Merchant Clicks Save:**

-   App creates a GHL Product via POST /products/ (name = program name,
    productType = \'DIGITAL\')

-   App creates GHL Prices on that Product: one-time price (type:
    \'one\_time\', amount = PIF price) AND/OR recurring price (type:
    \'recurring\', amount = installment amount, interval, intervalCount,
    totalCycles = number of payments)

-   App stores complete offer record in Supabase with the GHL
    product\_id and price\_ids

-   App syncs offer to GHL Custom Object for CRM visibility

-   App generates enrollment funnel link with offer ID as URL parameter

-   Merchant gets the link. Done. Share it with clients.

**NOTE:** *The merchant fills out ONE form. The app creates the GHL
Product, sets up pricing, and generates the link automatically. No extra
steps. Open Decision: Should the enrollment funnel be a single template
(Snapshot) where Page 4 dynamically loads the Product based on URL offer
ID, or clone per offer? Template preferred.*

3\. Client Enrollment

The enrollment flow is a 4-page funnel that captures client information,
presents the offer, collects legally binding consent, and THEN processes
payment. The consent-before-payment sequence is non-negotiable.

**Enrollment Funnel Pages:**

-   **Page 1 - Client Information:** Name, email, phone. Creates or
    updates GHL contact record. Captures IP address and device
    fingerprint from the browser.

-   **Page 2 - Offer Review:** Displays full offer details fetched from
    the offer record. Client sees exactly what they are purchasing:
    program name, price, payment structure, duration, deliverables,
    refund policy.

-   **Page 3 - Terms & Consent:** Presents T&C (either ScaleSafe
    compiled clauses or merchant custom URL). Client must actively check
    consent checkbox. Captures: consent timestamp, IP address, device
    info, browser fingerprint, T&C version hash. This is the most
    legally critical page.

-   **Page 4 - Payment:** GHL native order form with the
    ScaleSafe-created Product attached. Client chooses PIF or
    installments. GHL processes payment through whatever processor the
    merchant has connected. ScaleSafe never touches payment processing.
    On success: GHL creates Order + Transaction, fires webhook to
    ScaleSafe, which completes enrollment. On failure: GHL displays
    error, allows retry.

**Multi-Offer Support:**

A single client can enroll in multiple offers from the same merchant.
Each enrollment creates a separate pipeline opportunity and separate
evidence trail. The system tracks each enrollment independently.

4\. Enrollment Packet Generation

Immediately after a successful enrollment, the app generates a
standalone Enrollment Packet. This is a PDF document that captures
everything from the enrollment moment. It is a separate deliverable from
the evidence packet and the defense packet.

**Enrollment Packet Contains:**

-   Client name, email, phone, enrollment date/time

-   Offer details: program name, price, payment structure, duration,
    deliverables, refund policy

-   Full T&C text (or reference to merchant custom T&C URL) as presented
    at time of consent

-   Consent record: timestamp, IP address, device fingerprint, browser
    info, T&C version hash

-   Payment confirmation: transaction ID, amount, last 4 digits,
    processor reference

The enrollment packet can be retrieved at any time by the merchant. It
serves as a snapshot of exactly what the client agreed to and when. This
is critical evidence even before any service delivery begins.

5\. Evidence Collection Engine

ScaleSafe continuously collects evidence of service delivery. Every
interaction between the merchant and client that can prove value was
delivered gets logged with timestamps, details, and context. Evidence
flows in from multiple sources: GHL forms submitted by merchants, GHL
workflows triggered by events, external platform webhooks, and payment
processor notifications.

Evidence Types:

  -------- ----------------------- ---------------------------- -------------------------------------------------------------------------------------------------------
  **\#**   **Evidence Type**       **Source**                   **What It Captures**
  1        Enrollment Consent      Enrollment Funnel Pg 3       T&C acceptance, timestamp, IP, device, browser, T&C version hash
  2        Enrollment Payment      Enrollment Funnel Pg 4       Transaction ID, amount, method, last 4, processor ref, timestamp
  3        Session Delivery        GHL Form SYS2-07             Session date, duration, topics covered, delivery method, notes, no-show flag
  4        Module Completion       GHL Form SYS2-08             Module name, completion date, assessment score (if applicable), time spent
  5        Pulse Check-In          GHL Form SYS2-09             Check-in date, client sentiment (1-5), client feedback text, follow-up needed flag
  6        Payment Confirmation    GHL Form SYS2-10 / Webhook   Recurring payment received, amount, date, running total, payments remaining
  7        Cancellation Request    GHL Form SYS2-11             Cancellation date, reason, refund eligibility, status at cancellation
  8        Session Attendance      GHL Workflow WF-01           Scheduled session date, attended/no-show status, follow-up action taken
  9        Module Progress         GHL Workflow WF-02           Module started, progress percentage, last activity date
  10       Milestone Completion    Pipeline Stage Change        Milestone name, number, completion date, description of work completed
  11       Milestone Sign-Off      Sign-Off Page                Client digitally signs acknowledging milestone completion: signature, IP, timestamp, work summary
  12       Service Access          External Webhook             Third-party platform login/access: Kajabi, Skool, Teachable, etc. Login timestamp, platform, duration
  13       External Session        External Webhook             Sessions tracked in Calendly, Zoom, etc. Date, duration, recording URL
  14       Course Completion       External Webhook             Full course/program completed in external platform. Completion date, certificate if any
  15       Assignment Submission   External Webhook             Client submitted homework, assignment, or deliverable. Timestamp, title, grade if any
  16       Communication Log       GHL Activity / Webhook       Emails sent, SMS sent, calls logged between merchant and client. Type, date, direction, summary
  17       Resource Delivery       App / Webhook                Documents, recordings, materials delivered to client. Type, title, delivery date, access confirmed
  18       Refund Activity         Payment Webhook              Refund processed: amount, date, reason, partial/full, who initiated
  19       Failed Payment          Payment Webhook              Payment attempt failed: date, reason code, retry scheduled flag
  20       Subscription Change     App / Payment Webhook        Pause, resume, cancel, card update. Action, date, reason, who initiated
  21       Custom Event            External Webhook             Catch-all for merchant-defined events not covered above. Custom type, timestamp, metadata JSON
  -------- ----------------------- ---------------------------- -------------------------------------------------------------------------------------------------------

**NOTE:** *Communication logging (Type 15) is P0 priority, not
post-launch. Inbound client messages showing engagement and satisfaction
are Tier 1 chargeback evidence. The app should pull GHL Conversation
history to capture both outbound and inbound communications.*

**Evidence Storage:**

All evidence is stored in Supabase with merchant isolation
(location\_id). Each record includes: evidence type, timestamp,
contact\_id, location\_id, offer\_id, structured data fields, and raw
payload. The evidence\_timeline view provides a unified chronological
view across all evidence types for a given client.

**IP and Device Capture Beyond Enrollment:**

IP address and device fingerprint must be captured not just at
enrollment but also during Milestone Sign-Offs and Service Access
logins. Linking the enrollment IP/device to later usage IP/device proves
the same person who purchased is the person using the service. This is
critical for fraud dispute defense (Visa CE 3.0).

6\. Automated Outbound Communications

ScaleSafe triggers outbound communications to both merchants and clients
based on events. These communications serve two purposes: operational
(keeping people informed) and evidentiary (proving the merchant was
actively engaged). All outbound communications are logged as evidence.

Client-Facing Communications:

-   Enrollment confirmation: Welcome email/SMS with program details,
    what to expect, first session info

-   Session reminders: Automated reminders before scheduled sessions
    (configurable timing)

-   No-show follow-up: After a missed session, automated outreach asking
    to reschedule (proves merchant tried to re-engage)

-   Milestone achieved notification: Congratulations message when client
    reaches a program milestone

-   Pulse check-in requests: Periodic check-ins asking client how things
    are going (SS\--Pulse-Check-Cadence workflow)

-   Payment receipt: Confirmation after each successful payment

-   Payment failed notice: Alert that payment did not go through, with
    instructions to update payment method

-   Payment method update request: Link/instructions for updating card
    on file

-   Milestone sign-off request: Link to sign-off page when merchant
    triggers milestone completion

-   Re-engagement outreach: When client has been inactive, automated
    messages encouraging them to continue

Merchant-Facing Communications:

-   New enrollment notification: Client enrolled in \[program\] -
    includes client name, offer, payment details

-   Payment received notification: Recurring payment received for
    \[client\] - amount, running total

-   Payment failed alert: \[Client\] payment failed - includes failure
    reason, retry schedule

-   Refund processed notification: Refund of \[amount\] for \[client\] -
    details and evidence logged

-   Client at risk alert: \[Client\] showing disengagement signals - see
    details below

-   Chargeback detected alert: URGENT - chargeback filed by \[client\]
    for \[amount\] - defense compilation starting

-   Defense packet ready notification: Defense packet compiled for
    \[client\] chargeback - link to download

-   Client no-show notification: \[Client\] missed their session -
    follow-up sent automatically

-   Milestone sign-off completed: \[Client\] signed off on
    \[milestone\] - evidence logged

**NOTE:** *All communications are sent via GHL workflows. The app fires
custom workflow triggers; GHL handles the actual email/SMS delivery.
This lets merchants customize templates.*

7\. Disengagement Detection and At-Risk Client Alerts

ScaleSafe monitors client engagement patterns and flags clients who
appear to be disengaging. This is critical for two reasons: (1) it gives
the merchant a chance to re-engage the client before they chargeback,
and (2) the re-engagement attempts themselves become evidence of
good-faith service delivery.

**Disengagement Signals:**

-   Missed sessions: Client no-shows 2+ consecutive sessions

-   No module progress: No course/module activity for X days
    (configurable per offer)

-   No login activity: No third-party platform access logged for X days

-   Negative pulse check: Client rates satisfaction below threshold
    (configurable)

-   Payment failures: Failed payment + other disengagement signals
    compound the risk score

-   No communication response: Client not responding to outreach
    attempts

**What Happens When a Client Is Flagged:**

-   App fires Client At Risk custom workflow trigger to GHL

-   Merchant receives at-risk alert with specific signals listed

-   Automated re-engagement sequence fires (email/SMS asking client if
    everything is okay)

-   All outreach attempts are logged as evidence (proves merchant tried
    to help)

-   If client re-engages: risk flag cleared, evidence of re-engagement
    logged

8\. Payment Lifecycle Tracking

ScaleSafe OBSERVES and LOGS payment events. It does NOT control payment
processing, subscriptions, or billing. The merchant\'s processor (via
GHL) handles all payment operations. ScaleSafe listens for GHL payment
webhooks and records everything as evidence.

**Payment Events Tracked:**

-   Initial enrollment payment (PIF or first installment)

-   Recurring installment payments

-   Failed payment attempts with decline reason codes

-   Refunds (full, partial) with reason tracking

-   Subscription status changes (pause, resume, cancel) --- observed,
    not controlled

**Contact Fields Updated:**

5 key fields on GHL contacts: ss\_enrollment\_status,
ss\_evidence\_score, ss\_last\_evidence\_date, ss\_chargeback\_status,
ss\_defense\_status. Payment details are tracked in Supabase evidence
tables, not duplicated across GHL fields. Use GHL native features for
payment status visibility.

**Dunning / Failed Payment Awareness:**

When a payment fails, ScaleSafe logs it as evidence and fires the
Payment Failed trigger. GHL workflows handle client notification.
ScaleSafe tracks the failure pattern for disengagement scoring and
defense context. The actual retry is handled by the processor/GHL, not
ScaleSafe.

9\. Evidence PDF Generation

On demand, the app generates a formatted Evidence PDF that compiles all
evidence for a specific client enrollment. This is a comprehensive
document showing every piece of evidence collected, organized
chronologically. The Evidence PDF can be generated at any time, not just
during a chargeback. Merchants can use it for their own records,
compliance audits, or proactive dispute prevention.

**The Evidence PDF includes:**

-   Enrollment details and consent record

-   Complete payment history with amounts and dates

-   All session records (delivered + no-shows with follow-up)

-   Module/course completion records

-   Milestone completions and client sign-offs

-   Pulse check-in history

-   Third-party platform access logs

-   Communication log (outreach attempts, responses)

-   Any custom events logged

10\. AI Defense Compiler

When a chargeback is filed, this is the core value proposition. The AI
pulls ALL evidence, the enrollment packet, and the dispute details, then
generates a professional defense letter tailored to the specific reason
code.

**Bank Dispute Upload:**

The merchant uploads the actual Notice of Dispute from their bank. The
app reads the specific claim and reason code to tailor the defense. A
fraud dispute (Visa 10.4) needs fundamentally different evidence than a
\'services not provided\' dispute (13.1).

**Reason Code Mapping:**

The app maintains a lookup table mapping common chargeback reason codes
to evidence priorities and defense strategies. This is a core product
asset.

  --------------------------------- -------------------- ----------------------------------------------------------------------------------- ------------------------------------------------------------
  **Reason Code Category**          **Example Codes**    **Key Evidence Needed**                                                             **Defense Strategy**
  Fraud (\'I didn\'t authorize\')   Visa 10.4, MC 4837   IP/device match enrollment vs usage, signed T&C, prior undisputed transactions      Prove same person enrolled and used service. Link IPs.
  Services Not Provided             Visa 13.1, MC 4855   Session logs with dates, module completions, milestone sign-offs, platform access   Itemize every touchpoint with dates. Show delivery volume.
  Not As Described                  Visa 13.3, MC 4853   Offer terms at enrollment, T&C consent, what was delivered                          Compare promised vs delivered. Show client reviewed terms.
  Credit Not Processed              Visa 13.6, MC 4860   Refund policy from T&C, communication log, cancellation records                     Show policy was agreed to. Show merchant followed it.
  Authorization                     Visa 10.1            Consent proof, transaction receipts                                                 Hardest to win. Focus on consent capture evidence.
  --------------------------------- -------------------- ----------------------------------------------------------------------------------- ------------------------------------------------------------

**Defense Compilation Process:**

-   Chargeback alert received (merchant uploads dispute notice)

-   App fires Chargeback Detected trigger (merchant notified
    immediately)

-   Merchant enters dispute details: reason code, amount, deadline,
    case/ARN number

-   App pulls complete evidence timeline from Supabase

-   App retrieves Enrollment Packet

-   App selects defense strategy and evidence prioritization based on
    reason code

-   Claude API generates defense letter from proven template, customized
    with specific evidence (dates, amounts, sessions, sign-offs)

-   Defense Packet bundled: defense letter + enrollment packet +
    evidence PDF

-   PDF saved to Supabase storage

-   App fires Defense Ready trigger (merchant gets download link)

**Prior Undisputed Transactions:**

When compiling defense, explicitly list all prior successful payments
from the same customer that were NOT disputed, with dates and amounts.
This is a dedicated section in the defense letter --- one of the
strongest evidence types available.

**Defense Template Library:**

Instead of generating every letter from scratch, the app uses proven
templates organized by reason code category. Claude customizes the
template with specific evidence. This is faster, more reliable, and
enables learning from wins and losses. Templates are iterated based on
defense outcome data.

**Defense Packet Output:**

The final defense packet is a bundled document: (1) AI-written defense
letter tuned to reason code, (2) enrollment packet with consent proof,
(3) complete evidence PDF, (4) payment history with undisputed
transactions highlighted. Ready to submit to processor or bank.

11\. Defense Readiness Score

Each active client gets a Defense Readiness Score (0-100) showing how
strong their defense would be RIGHT NOW if a chargeback was filed. This
motivates merchants to log evidence and gives confidence ScaleSafe is
working.

*Example: \'Client John Smith: Defense Readiness 82/100. Strong
enrollment consent, 6 session records, 3 milestone sign-offs. Missing:
no pulse check-ins in last 30 days. Log a check-in to reach 90+.\'*

**Score Components:**

-   Enrollment consent quality (T&C, IP, device capture): 0-20 points

-   Payment history (number of undisputed transactions): 0-15 points

-   Service delivery proof (sessions, modules, milestones): 0-25 points

-   Client engagement (pulse checks, sign-offs, communications): 0-20
    points

-   Re-engagement documentation (if applicable): 0-10 points

-   Recency (how fresh is the latest evidence): 0-10 points

12\. System Health Monitoring

The app monitors its own health and the health of all external
connections. This is critical for a production system handling financial
evidence.

-   Health check endpoint (/health): Tests connectivity to Supabase, GHL
    API, and returns system status

-   Structured error logging: Every failed operation logged with full
    context (request, response, merchant, timestamp)

-   Failed webhook retry queue: If a Supabase write fails, the event is
    queued for retry (prevents evidence loss)

-   Daily reconciliation job: Compares payment processor transactions
    against evidence records to catch any missed events

-   Alert notification system: Critical failures trigger alerts
    (configurable: Slack, email, SMS)

13\. Merchant Dashboard

The dashboard lives within the GHL sub-account. Keep it focused ---
configuration and defense, not duplicating data GHL already shows.

-   Offer management: create, edit, view enrollment links

-   Defense Readiness scores per active client (the key differentiator
    view)

-   At-risk clients list with specific disengagement signals

-   Defense history: past chargebacks, packets generated, win/loss
    tracking with Total Value Saved metric

-   Configuration: evidence toggles, notification preferences,
    disengagement thresholds

-   System health status

**NOTE:** *Use GHL native features (contact fields, smart lists,
pipeline) for payment status and contact management. Don\'t rebuild what
GHL already does.*

PART 2: ARCHITECTURE

Three-Layer Architecture

ScaleSafe operates across three layers that work together:

-   **Layer 1 - GHL (The Face):** Everything the merchant and client
    sees and interacts with. Contact records, pipeline, forms,
    workflows, notifications, funnel pages. GHL handles all UI and
    communication delivery.

-   **Layer 2 - ScaleSafe App (The Brain):** Node.js/TypeScript +
    Express.js backend deployed as a GHL Marketplace app. Handles all
    business logic: evidence processing, payment tracking, defense
    compilation, health monitoring. Receives webhooks, calls APIs,
    writes to database.

-   **Layer 3 - Supabase (The Memory):** PostgreSQL database + file
    storage. Stores all evidence records, merchant configs, defense
    packets, enrollment packets. Row-level security isolates merchant
    data by location\_id.

Technology Stack

  ----------------- ----------------------------------------- -----------------------------------------------------------
  **Component**     **Technology**                            **Purpose**
  Backend           Node.js + TypeScript + Express.js         API endpoints, webhook handlers, business logic
  Frontend          Vue 3 (GHL app UI)                        Merchant dashboard, configuration, offer management
  Database          Supabase (PostgreSQL)                     Evidence storage, merchant config, defense packets
  File Storage      Supabase Storage                          PDFs (enrollment packets, evidence docs, defense packets)
  AI                Anthropic Claude API                      Defense letter generation, evidence analysis
  PDF Generation    Node.js PDF library (pdfkit or similar)   Enrollment packets, evidence PDFs, defense letters
  Authentication    GHL OAuth 2.0                             Merchant authentication, API access per location
  Hosting           TBD (Railway, Render, or similar)         App deployment
  Version Control   GitHub                                    Source code, CI/CD
  ----------------- ----------------------------------------- -----------------------------------------------------------

How Payments Work --- The Full Picture

ScaleSafe is NOT a payment processor and does NOT handle payments. Here
is exactly how payments flow:

**Offer Creation (merchant side):**

Merchant creates offer in ScaleSafe app → App calls GHL POST /products/
to create Product → App calls POST /products/{id}/price to create prices
(one-time and/or recurring with interval, intervalCount, totalCycles) →
Product ID and Price IDs stored on offer record in Supabase → Enrollment
link generated with offer ID.

**Enrollment Payment (client side):**

Client goes through funnel Pages 1-3 (info, offer review, consent) →
Page 4 is GHL native order form with Product attached → GHL handles card
collection and processing through merchant\'s connected processor → GHL
creates Order + Transaction → GHL fires webhook → ScaleSafe receives
webhook and completes enrollment.

**Recurring Payments:**

GHL + merchant\'s processor handle all recurring billing based on Price
configuration (interval, totalCycles). ScaleSafe listens for GHL payment
webhooks and logs each payment as evidence. ScaleSafe never initiates
charges.

**GHL Products API --- Confirmed Capabilities:**

-   POST /products/ --- Create Product (required: name, locationId,
    productType)

-   POST /products/{productId}/price --- Create Price (required: name,
    type, currency, amount, locationId)

-   Price type \'one\_time\': single payment

-   Price type \'recurring\': interval (day/week/month/year),
    intervalCount, totalCycles (stops after N payments)

-   setupFee: optional one-time fee on first payment. trialPeriod: days
    of free trial

-   Full CRUD on both Products and Prices

**Timezone Handling:**

All timestamps stored as UTC in Supabase. Display converted based on
merchant location settings.

Data Flow Architecture

Every event in ScaleSafe follows one of these patterns:

Pattern A: GHL Form Submission

Merchant fills out a GHL form (session log, module progress, pulse
check, cancellation, payment update) -\> GHL workflow fires -\> Workflow
sends webhook to ScaleSafe app -\> App validates payload, identifies
merchant (location\_id) and contact -\> App logs evidence to Supabase
-\> App updates GHL contact fields if needed -\> App fires any relevant
custom workflow triggers back to GHL

Pattern B: Enrollment Funnel

Client visits enrollment link -\> Page 1: client info captured, contact
created in GHL -\> Page 2: offer details fetched and displayed -\> Page
3: T&C consent captured (timestamp, IP, device, browser, hash) -\> Page
4: GHL native order form charges via merchant\'s processor -\> GHL fires
order webhook -\> ScaleSafe creates enrollment, copies offer to contact,
creates opportunity, generates enrollment packet, logs all evidence,
notifies merchant

Pattern C: Payment Webhook

GHL fires payment event (order created, subscription charged, payment
failed, refund) -\> ScaleSafe receives webhook -\> Parses event type -\>
Looks up contact -\> Logs payment evidence to Supabase -\> Fires
relevant custom workflow triggers -\> GHL workflows handle notifications
to merchant and client

Pattern D: External Platform Webhook

External platform (Calendly, Zoom, Kajabi, Teachable, Skool, etc.) fires
webhook to ScaleSafe -\> App validates API key in header -\> App maps
external event to evidence type (session\_completed, module\_completed,
course\_completed, login\_detected, assignment\_submitted,
custom\_event) -\> App looks up contact by email -\> App logs evidence
to Supabase -\> App fires Evidence Milestone trigger if applicable

Pattern E: Chargeback / Defense

Chargeback detected (manual trigger by merchant or automated
notification) -\> App fires Chargeback Detected trigger -\> App pulls
complete evidence timeline from Supabase -\> App retrieves enrollment
packet -\> App assembles AI context package -\> Claude API generates
defense letter -\> Defense letter + enrollment packet + evidence PDF
bundled into defense packet -\> PDF saved to Supabase storage -\> App
fires Defense Ready trigger -\> Merchant downloads defense packet

Pattern F: Scheduled / Background

Daily reconciliation job compares payment records vs evidence records
-\> Disengagement detection runs periodically, scoring each active
client -\> Health checks verify all external connections -\> Failed
webhook retry queue processes pending events -\> Alerts fire for any
anomalies detected

Pattern G: GHL Workflow Automation (Pure GHL)

Some automations run entirely in GHL without touching the app: No-show
logger (WF-01) triggers on missed appointment, logs to contact and fires
webhook to app -\> Module progress logger (WF-02) triggers on form
submission -\> Pulse check cadence (SS\--Pulse-Check-Cadence) sends
periodic check-in requests on configurable schedule -\> Client
onboarding prep (WF-D1) fires after enrollment, sets up initial pipeline
and sends welcome sequence

PART 3: COMPLETE EVENT CATALOG

Every event that can occur in ScaleSafe, what triggers it, what data
flows, and what actions result.

  ------------------------------- -------------------------------- -------------------------------------------------- ------------------------------------------------------------------------------------------ ------------------------------
  **Event**                       **Trigger**                      **Data In**                                        **Actions**                                                                                **Evidence Logged**
  New Merchant Install            GHL Marketplace install          OAuth code, location\_id                           Token exchange, DB provision, Snapshot install, register triggers                          None (system event)
  Offer Created                   Merchant saves offer form        All offer fields                                   Create GHL Product + Prices, save to Custom Object + Supabase, generate link               None (config event)
  Offer Updated                   Merchant edits offer             Changed offer fields                               Update Custom Object + Supabase                                                            None (config event)
  Client Enrollment Started       Client hits Page 1               Name, email, phone                                 Create/update GHL contact, capture IP + device                                             None yet
  Offer Review Viewed             Client reaches Page 2            Offer ID                                           Fetch and display offer details                                                            None yet
  Consent Captured                Client accepts T&C on Page 3     Consent timestamp, IP, device, browser, T&C hash   Store consent record                                                                       Enrollment Consent
  Enrollment Payment Success      GHL order webhook after Page 4   Transaction ID, amount, method, last 4             Create enrollment, copy offer to contact, create opportunity, generate enrollment packet   Enrollment Payment
  Enrollment Payment Failed       GHL payment error on Page 4      Error message, decline code                        GHL displays error, allows retry                                                           Failed Payment
  Recurring Payment Success       Processor charges installment    Amount, date, transaction ID                       Update payment fields, log evidence, notify merchant                                       Payment Confirmation
  Recurring Payment Failed        Processor charge fails           Decline reason, attempt number                     Update status to Past Due, start dunning, notify client + merchant                         Failed Payment
  Refund Processed                Processor issues refund          Amount, type (full/partial), reason                Update payment fields, log evidence, notify merchant                                       Refund Activity
  Session Logged                  Merchant submits SYS2-07         Session date, duration, topics, notes              Log evidence, update contact fields                                                        Session Delivery
  Session No-Show                 GHL WF-01 fires                  Scheduled date, contact ID                         Log no-show, trigger follow-up outreach                                                    Session Attendance (no-show)
  Module Progress Logged          Merchant submits SYS2-08         Module name, progress %, completion status         Log evidence, update pipeline if complete                                                  Module Completion
  Pulse Check Submitted           Client responds to SYS2-09       Satisfaction score (1-5), feedback text            Log evidence, flag if score below threshold                                                Pulse Check-In
  Milestone Reached               Pipeline stage change            Milestone number, name, description                Log evidence, trigger sign-off request if configured                                       Milestone Completion
  Milestone Signed Off            Client signs on sign-off page    Signature, IP, timestamp, work summary             Log evidence, notify merchant                                                              Milestone Sign-Off
  Cancellation Requested          Merchant submits SYS2-11         Reason, date, refund eligibility                   Log evidence, update status, trigger refund if applicable                                  Cancellation Request
  Subscription Paused             Merchant action in app           Pause date, reason                                 Pause processor schedule, update status, log evidence                                      Subscription Change
  Subscription Resumed            Merchant action in app           Resume date                                        Resume processor schedule, update status, log evidence                                     Subscription Change
  Subscription Cancelled          Merchant action in app           Cancel date, reason                                Cancel processor schedule, update status, trigger cancellation flow                        Subscription Change
  External Session Completed      Calendly/Zoom webhook            Date, duration, platform, recording URL            Map to contact, log evidence                                                               External Session
  External Login Detected         Kajabi/Skool/Teachable webhook   Timestamp, platform, user email                    Map to contact, log evidence                                                               Service Access
  External Course Completed       Platform webhook                 Completion date, course name, certificate          Map to contact, log evidence                                                               Course Completion
  External Assignment Submitted   Platform webhook                 Timestamp, title, grade                            Map to contact, log evidence                                                               Assignment Submission
  Custom Event                    Any webhook with custom type     Type name, timestamp, metadata JSON                Map to contact, log evidence                                                               Custom Event
  Chargeback Detected             Manual or processor alert        Amount, reason code, deadline                      Fire trigger, start defense compilation                                                    System event
  Defense Packet Generated        AI compilation completes         Defense letter, evidence PDF, enrollment packet    Bundle PDFs, store, notify merchant                                                        System event
  Client Flagged At Risk          Disengagement detection          Risk signals, score, last activity                 Fire trigger, start re-engagement, notify merchant                                         System event
  Health Check Failed             Scheduled health check           Failed service, error details                      Log error, fire alert                                                                      System event
  Reconciliation Mismatch         Daily reconciliation job         Missing evidence for payment events                Flag for review, attempt backfill                                                          System event
  ------------------------------- -------------------------------- -------------------------------------------------- ------------------------------------------------------------------------------------------ ------------------------------

PART 4: COMPONENT INVENTORY

Every component that needs to exist in the app, categorized by type.

App Services (Backend)

  --------------------------- -------------------------------------------------------------------- ----------------------------------------------------------------------------------------
  **Service**                 **Responsibility**                                                   **Key Methods**
  merchant.service.ts         Onboarding, config, token management, error recovery                 provision(), getConfig(), refreshTokens(), handleSnapshotFailure()
  offer.service.ts            CRUD + GHL Product/Price creation + Supabase + Custom Object         create(), update(), createGHLProduct(), createGHLPrices(), generateLink()
  enrollment.service.ts       Pages 1-3 handlers + post-payment webhook                            prepEnrollment(), captureConsent(), handlePaymentWebhook(), generateEnrollmentPacket()
  payment.service.ts          Payment event observation and evidence logging (NOT processing)      handlePaymentEvent(), logPaymentEvidence(), updateDisengagementScore()
  evidence.service.ts         Evidence logging across all 21 types + readiness scoring             logEvidence(), getTimeline(), getByContact(), calculateReadinessScore()
  defense.service.ts          AI defense, reason code mapping, template library                    compileDefense(), selectStrategy(), generateLetter(), bundlePacket(), trackOutcome()
  pdf.service.ts              PDF generation: enrollment packets, evidence PDFs, defense letters   generateEnrollmentPacket(), generateEvidencePDF(), generateDefenseLetter()
  notification.service.ts     Fire GHL custom workflow triggers                                    fireEvent(), notifyMerchant(), notifyClient()
  disengagement.service.ts    Client risk scoring and at-risk detection                            scoreEngagement(), flagAtRisk(), checkDisengagement()
  external.service.ts         External platform webhook processing                                 handleExternalEvent(), mapContact(), validateApiKey()
  reconciliation.service.ts   Daily payment vs evidence reconciliation                             runReconciliation(), findMismatches(), backfill()
  health.service.ts           System health monitoring and alerting                                checkHealth(), logError(), retryFailed(), sendAlert()
  communication.service.ts    GHL conversation history for evidence                                pullConversations(), logInboundMessages(), logOutboundMessages()
  --------------------------- -------------------------------------------------------------------- ----------------------------------------------------------------------------------------

API Endpoints

  -------------------------------------- ---------------- ----------------------------------------------------------
  **Endpoint**                           **Method**       **Purpose**
  /auth/callback                         GET              GHL OAuth callback - exchanges code for tokens
  /auth/refresh                          POST             Token refresh (also runs on schedule)
  /api/merchants/:locationId/config      GET/PUT          Merchant configuration
  /api/offers                            POST             Create new offer
  /api/offers/:id                        GET/PUT/DELETE   Offer CRUD
  /api/offers/:id/enrollment-link        GET              Generate enrollment funnel link
  /api/enrollment/prep                   POST             Page 1 - create/update contact
  /api/enrollment/offer/:id              GET              Page 2 - fetch offer details
  /api/enrollment/consent                POST             Page 3 - record consent
  /webhooks/ghl/payment                  POST             GHL payment events (order, subscription, failed, refund)
  /webhooks/ghl/forms                    POST             GHL form/workflow events
  /webhooks/external                     POST             External platform events
  /api/evidence/:contactId               GET              Get evidence timeline for a contact
  /api/evidence/:contactId/pdf           GET              Generate and download evidence PDF
  /api/enrollment-packet/:enrollmentId   GET              Download enrollment packet
  /api/defense/compile                   POST             Trigger defense compilation
  /api/defense/:id                       GET              Get defense packet
  /api/defense/:id/download              GET              Download defense packet PDF
  /api/dashboard/overview                GET              Merchant dashboard data
  /api/dashboard/at-risk                 GET              At-risk clients list
  /api/dashboard/evidence-health         GET              Evidence completeness scores
  /health                                GET              System health check
  /api/admin/reconciliation              POST             Trigger manual reconciliation
  -------------------------------------- ---------------- ----------------------------------------------------------

Supabase Tables

  --------------------------------- ------------ ----------------------------------------------------------------------------------------------------------------
  **Table**                         **Status**   **Key Fields**
  merchants                         FRESH        location\_id (PK), ghl\_access\_token, ghl\_refresh\_token, config JSONB, created\_at. NO accept.blue columns.
  payment\_customer\_map            FRESH        customer\_id, contact\_id, location\_id, offer\_id, payment\_type. Processor-agnostic.
  idempotency\_keys                 FRESH        event\_id, source, created\_at (prevents duplicate processing)
  defense\_packets                  FRESH        id, location\_id, contact\_id, status, evidence\_snapshot, defense\_letter\_url
  evidence\_service\_access         FRESH        id, location\_id, contact\_id, platform, login\_timestamp
  evidence\_sessions                FRESH        id, location\_id, contact\_id, session\_date, duration, topics, no\_show
  evidence\_modules                 FRESH        id, location\_id, contact\_id, module\_name, progress, completed\_at
  evidence\_cancellation            FRESH        id, location\_id, contact\_id, reason, date, refund\_eligibility
  evidence\_refund\_activity        FRESH        id, location\_id, contact\_id, amount, type, reason, date
  evidence\_consent                 FRESH        id, location\_id, contact\_id, offer\_id, timestamp, ip, device, browser, tc\_hash
  evidence\_enrollment\_payment     FRESH        id, location\_id, contact\_id, offer\_id, transaction\_id, amount, method
  evidence\_payment\_confirmation   FRESH        id, location\_id, contact\_id, amount, date, running\_total, remaining
  evidence\_failed\_payment         FRESH        id, location\_id, contact\_id, amount, reason\_code, retry\_scheduled
  evidence\_milestones              FRESH        id, location\_id, contact\_id, milestone\_number, name, completed\_at
  evidence\_signoffs                FRESH        id, location\_id, contact\_id, milestone\_number, signature, ip, timestamp
  evidence\_pulse\_checkins         FRESH        id, location\_id, contact\_id, score, feedback\_text, date
  evidence\_attendance              FRESH        id, location\_id, contact\_id, session\_date, status (attended/no\_show), followup
  evidence\_communication           FRESH        id, location\_id, contact\_id, type (email/sms/call), direction, date, summary
  evidence\_external\_sessions      FRESH        id, location\_id, contact\_id, platform, date, duration, recording\_url
  evidence\_course\_completion      FRESH        id, location\_id, contact\_id, platform, course\_name, completed\_at
  evidence\_assignments             FRESH        id, location\_id, contact\_id, title, submitted\_at, grade
  evidence\_resource\_delivery      FRESH        id, location\_id, contact\_id, resource\_type, title, delivered\_at
  evidence\_subscription\_changes   FRESH        id, location\_id, contact\_id, action (pause/resume/cancel), date, reason
  evidence\_custom\_events          FRESH        id, location\_id, contact\_id, event\_type, timestamp, metadata JSONB
  enrollment\_packets               FRESH        id, location\_id, contact\_id, offer\_id, pdf\_url, created\_at
  offers\_mirror                    FRESH        id, location\_id, ghl\_product\_id, ghl\_price\_ids JSONB, all offer fields, created\_at
  reason\_code\_strategies          FRESH        id, reason\_code, category, evidence\_priorities JSONB, template\_id, win\_rate
  defense\_templates                FRESH        id, reason\_code\_category, template\_text, version, last\_updated
  defense\_outcomes                 FRESH        id, defense\_packet\_id, outcome (won/lost), amount\_saved, notes
  evidence\_timeline (VIEW)         FRESH        Unified view joining ALL evidence tables, ordered by timestamp
  --------------------------------- ------------ ----------------------------------------------------------------------------------------------------------------

GHL Components (Installed via Snapshot)

  ----------------------------------- ---------------- --------------------------------------------------------------------------------------------------------------------
  **Component**                       **Type**         **Purpose**
  Client Milestones Pipeline          Pipeline         8-stage visual tracker for client progress through program milestones
  Offers Custom Object                Custom Object    Stores program definitions with all offer fields
  SS- prefix contact fields (5 key)   Custom Fields    ss\_enrollment\_status, ss\_evidence\_score, ss\_last\_evidence\_date, ss\_chargeback\_status, ss\_defense\_status
  Offer- prefix contact fields        Custom Fields    Copied from offer on enrollment: program name, price, terms, etc.
  SS- prefix custom values (9+)       Custom Values    Location-level config: API keys, folder IDs, toggles
  Evidence Module Toggles (5)         Custom Values    Enable/disable specific evidence collection types
  T&C Clause Toggles (9+2)            Custom Values    Standard clause on/off switches + custom clause slots
  SYS2-07 Session Log Form            Form             Merchant logs delivered session details
  SYS2-08 Module Progress Form        Form             Merchant logs module/course progress
  SYS2-09 Pulse Check Form            Form             Periodic client satisfaction check
  SYS2-10 Payment Update Form         Form             Manual payment event logging
  SYS2-11 Cancellation Form           Form             Cancellation request with reason tracking
  WF-01 No-Show Logger                Workflow         Fires on missed appointment, logs to app
  WF-02 Module Progress Logger        Workflow         Fires on SYS2-08 submission, sends to app
  WF-D1 Client Onboarding Prep        Workflow         Post-enrollment setup: pipeline, welcome sequence
  SS\--Pulse-Check-Cadence            Workflow         Periodic check-in outreach on configurable schedule
  Chargeback Detected trigger         Custom Trigger   App fires when chargeback alert received
  Defense Ready trigger               Custom Trigger   App fires when defense packet compiled
  Evidence Milestone trigger          Custom Trigger   App fires on significant evidence event
  Client At Risk trigger              Custom Trigger   App fires when disengagement detected
  Payment Failed trigger              Custom Trigger   App fires on payment failure
  Enrollment Funnel (4 pages)         Funnel           Client-facing enrollment flow with consent capture
  Milestone Sign-Off Page             Funnel Page      Client-facing milestone acknowledgment page
  ----------------------------------- ---------------- --------------------------------------------------------------------------------------------------------------------

PART 5: WHAT EXISTS vs WHAT\'S NEW

Correlation map showing what has already been built (in Make.com or GHL)
and can be migrated/adapted, vs what is entirely new.

Already Built (Migrate to App)

  ------------------------------------------ ----------------------------------- -------------------------------------------------------------------------
  **Feature**                                **Current State**                   **Migration Notes**
  OAuth token exchange + refresh             Make.com scenario                   Rebuild as Express middleware. Logic is straightforward.
  Offer CRUD                                 Make.com S3 + GHL Custom Object     Rebuild as offer.service.ts. Add Supabase mirror.
  Enrollment flow (Pages 1-4)                GHL Funnel + Make.com S4/S5/S6/S7   Funnel pages stay in GHL. Backend logic moves to enrollment.service.ts.
  Evidence Logger (10 routes)                Make.com S8                         Rebuild as evidence.service.ts. Same logic, better architecture.
  Evidence PDF Generator                     Make.com S8b                        Rebuild as pdf.service.ts using Node.js PDF library.
  Post-Payment Handler                       Make.com S7 (4 routes)              Rebuild as payment.service.ts. Remove processor-specific code.
  External Integration Handler               Make.com S9                         Rebuild as /webhooks/external endpoint + external.service.ts.
  AI Defense Compiler                        Make.com S11 (12 modules)           Rebuild as defense.service.ts. Same Claude API integration.
  Merchant Provisioning                      Make.com S1                         Rebuild as merchant.service.ts. Simplify with Snapshot approach.
  All GHL forms (SYS2-07 to SYS2-11)         GHL Forms                           Keep as-is. Update webhook URLs to point to app.
  All GHL workflows (WF-01, WF-02, etc.)     GHL Workflows                       Keep as-is. Update webhook URLs to point to app.
  Pipeline + Custom Fields + Custom Values   GHL                                 Keep as-is. Package into Snapshot for auto-install.
  Enrollment Funnel (4 pages)                GHL Funnel                          Keep in GHL. Update JS to call app endpoints instead of Make.com.
  Milestone Sign-Off Page                    GHL Funnel Page                     Keep in GHL. Update JS to call app endpoint.
  T&C Clause Library                         Make.com Datastore                  Migrate to Supabase or app config.
  AB Customer Map                            Make.com Datastore                  Migrate to Supabase payment\_customer\_map table.
  19 payment custom fields                   GHL Contact Fields                  Keep. App will populate them (currently empty).
  ------------------------------------------ ----------------------------------- -------------------------------------------------------------------------

New (Build Fresh)

  ------------------------------------------- ------------------ -------------------------------------------------------------------------------
  **Feature**                                 **Priority**       **Complexity**
  Enrollment Packet generation                P0 - Core          Medium - PDF generation from enrollment data
  Disengagement detection + at-risk scoring   P0 - Core          Medium - Periodic job + scoring logic
  Automated outbound comm triggers            P0 - Core          Low - Fire GHL custom triggers on events
  Communication logging                       P0 - Core          Low - Log inbound/outbound comms as Tier 1 evidence
  Reason code mapping + defense templates     P0 - Core          Medium - Lookup table mapping codes to evidence priorities + proven templates
  Dunning / failed payment recovery           P1 - Launch        Medium - Retry logic + status tracking
  Subscription management (observe + log)     P1 - Launch        Low - Observe GHL subscription events, log as evidence (no control)
  Daily reconciliation job                    P1 - Launch        Medium - Compare payment records vs evidence
  Evidence health scoring                     P1 - Launch        Low - Count evidence types per client vs expected
  Defense Readiness Score                     P1 - Launch        Medium - 0-100 score per client showing defense strength
  Win/loss tracking + Total Value Saved       P1 - Launch        Low - Track defense outcomes with financial metrics
  Merchant dashboard (Vue 3)                  P1 - Launch        High - Full frontend with readiness scores + value saved
  Health monitoring + alerting                P1 - Launch        Medium - Background checks + notification routing
  Failed webhook retry queue                  P1 - Launch        Medium - Queue + retry logic with backoff
  Resource delivery tracking                  P1 - Launch        Low - Log delivery events as evidence
  Client risk scoring (predictive)            P2 - Post-Launch   High - ML/rules-based prediction
  Multi-staff support                         P3 - Future        Medium - Role-based access within merchant account
  White-label funnel styling                  P3 - Future        Medium - Custom CSS/branding per merchant
  Data retention policy automation            P3 - Future        Low - Scheduled cleanup per merchant config
  ------------------------------------------- ------------------ -------------------------------------------------------------------------------

Rework Required

  --------------------------- ------------------------------------------------------------------------------------------------ ---------------------------------------------------
  **Item**                    **What Changes**                                                                                 **Why**
  Payment handling            Observe-only via GHL webhooks. ScaleSafe creates GHL Products/Prices, never processes payments   Processor-agnostic; GHL handles checkout natively
  Evidence timeline view      Expand to join ALL evidence tables (currently only 5 of 21+)                                     New evidence types added + communication logging
  Post-Payment Handler        Rebuild as webhook listener for GHL payment events, log as evidence                              Observe + log, never control payments
  Customer mapping            Rename ab\_customer\_map to payment\_customer\_map, generalize fields                            Not accept.blue-specific anymore
  Funnel page JS              Update API endpoints from Make.com webhooks to app URLs                                          Make.com -\> App migration
  GHL workflow webhook URLs   Point all webhooks to app endpoints                                                              Make.com -\> App migration
  Merchant provisioning       Add Snapshot-based install, custom trigger registration, auto-create GHL Products                GHL Marketplace app pattern
  --------------------------- ------------------------------------------------------------------------------------------------ ---------------------------------------------------

PART 6: BUILD PLAN

6 phases. Each builds on the previous. Each can be tested independently.

Phase 1: Infrastructure + Merchant Onboarding

-   Deploy Node.js app to hosting (Railway/Render)

-   Push to GitHub with CI/CD

-   Configure GHL Marketplace app (OAuth callback, scopes, webhooks)

-   Verify OAuth flow end-to-end

-   Run Supabase migrations for all new evidence tables

-   Build merchant.service.ts with onboarding error handling

-   GHL Snapshot package: pipeline, fields, forms, workflows, values

-   Register custom workflow triggers per location on install

-   Basic merchant welcome page

-   Test: install on test sub-account, verify full provisioning with
    error recovery

**Deliverable:** Running app that handles OAuth, provisions merchants
with error recovery, responds to health checks.

Phase 2: Offers + Enrollment + Evidence Foundation

-   Build offer.service.ts with GHL Product/Price auto-creation on save

-   Build enrollment.service.ts: Pages 1-3 handlers + payment webhook
    handler

-   Build consent capture with full forensics (IP, device, browser, T&C
    hash)

-   Configure Page 4 as GHL order form with dynamic Product loading

-   Build enrollment packet PDF generation

-   Build evidence.service.ts: handlers for all 21 evidence types

-   Build /webhooks/ghl and /webhooks/external endpoints

-   Build evidence timeline query + expand Supabase view

-   Build communication.service.ts for GHL conversation history

-   Multi-offer support + IP/device capture on sign-offs and logins

-   Test: full enrollment -\> all evidence types -\> verify timeline

**Deliverable:** Complete enrollment flow producing packets, all
evidence types flowing, communication logging active.

Phase 3: Payment Lifecycle + Disengagement

-   Build payment.service.ts: observe and log GHL payment webhooks (NOT
    process)

-   Build disengagement.service.ts: scoring engine + periodic checks

-   Build configurable disengagement thresholds per offer

-   Build all notification triggers (enrollment, payment, no-show,
    at-risk, etc.)

-   Log all outbound communications as evidence

-   Build Defense Readiness Score calculator

-   Test: simulate payment events, disengagement scenarios, verify
    scores and alerts

**Deliverable:** Full payment observation, proactive disengagement
monitoring, Defense Readiness scores.

Phase 4: AI Defense Compiler

-   Build reason code lookup table and strategy mapping

-   Build defense template library (templates per reason code category)

-   Build defense.service.ts: evidence assembly + Claude API integration

-   Build bank dispute upload (merchant enters reason code, amount,
    deadline, ARN)

-   Build prior undisputed transaction highlighting in defense letters

-   Build defense packet bundling (letter + enrollment packet + evidence
    PDF)

-   Build win/loss outcome tracking

-   Test: full evidence trail -\> trigger defense -\> verify
    reason-code-specific output

**Deliverable:** AI-generated defense packets with reason-code-specific
strategies, ready for submission.

Phase 5: Merchant Dashboard + Health

-   Build Vue 3 dashboard: offer management, Defense Readiness view,
    at-risk clients, defense history

-   Build configuration UI: evidence toggles, notification preferences,
    thresholds

-   Build win/loss tracking with Total Value Saved metric

-   Build health.service.ts and reconciliation.service.ts

-   Build failed webhook retry queue with backoff

-   Build alert system (Slack/email on critical failures)

-   Test: full merchant experience from dashboard + failure recovery

**Deliverable:** Complete merchant UI within GHL. Production-grade
reliability with monitoring.

Phase 6: Testing + Launch

-   End-to-end test with real GHL sub-account

-   Full cycle: enrollment -\> evidence -\> chargeback -\> defense

-   Multi-merchant test (2+ sub-accounts)

-   Defense letter quality review (iterate prompts 3-5 cycles based on
    output)

-   Load test webhook handling

-   GHL Marketplace submission prep: screenshots, description, pricing

-   Documentation: merchant setup guide

**Deliverable:** App ready for GHL Marketplace submission and first
merchant installs.

PART 7: OPEN DECISIONS

Decisions that need to be made before or during the build. Each decision
is documented with options and recommendation.

  -------- ------------------------------------ ------------------------------------------------------------------------------------------------------------ ------------------------------------------------------------------------ ------------
  **\#**   **Decision**                         **Options**                                                                                                  **Recommendation**                                                       **Impact**
  1        RESOLVED: GHL Products for offers    ScaleSafe auto-creates GHL Products + Prices when merchant saves an offer. Page 4 = native GHL order form.   Confirmed. No custom payment provider needed.                            Phase 2-3
  2        Hosting platform                     Railway, Render, Fly.io, Vercel                                                                              Railway or Render (simple Node.js deployment with auto-scaling)          Phase 1
  3        PDF library                          pdfkit, puppeteer, react-pdf                                                                                 pdfkit for server-side generation (lightweight, no browser needed)       Phase 3
  4        Pricing model                        A: Flat monthly. B: Free + per-defense-packet fee. C: Tiered by client count                                 Philip leaning toward B (free + per-defense fee). Build billing hooks.   Phase 6
  5        Disengagement thresholds             Fixed defaults vs configurable per offer                                                                     Configurable per offer with sensible defaults                            Phase 4
  6        Defense prompt strategy              Single prompt vs reason-code-specific prompts                                                                RESOLVED: Reason-code-specific with defense template library             Phase 4
  7        Evidence retention period            30 days, 1 year, forever, configurable                                                                       Configurable per merchant with 2-year default                            Phase 6
  8        Multi-offer enrollment tracking      Separate pipeline per offer vs single pipeline with tags                                                     Separate opportunity per offer in same pipeline                          Phase 2
  9        Custom trigger registration method   On install vs on first use                                                                                   On install during provisioning                                           Phase 1
  10       RESOLVED: Communication logging      Promoted to P0. Log inbound messages as Tier 1 evidence.                                                     GHL activity feed API + webhook capture                                  Phase 2
  -------- ------------------------------------ ------------------------------------------------------------------------------------------------------------ ------------------------------------------------------------------------ ------------

PART 8: GLOSSARY

Terms used throughout this document, defined for clarity.

  ------------------------- -----------------------------------------------------------------------------------------------------------------------------
  **Term**                  **Definition**
  Merchant                  A business that installs and uses ScaleSafe. Could be a coach, consultant, agency, course creator, or any service provider.
  Client                    A customer of the merchant who enrolls in a service program.
  Offer                     A service program definition: name, price, terms, deliverables. A merchant can have multiple offers.
  Enrollment                The act of a client signing up for a specific offer. Includes consent + payment.
  Enrollment Packet         PDF document generated at enrollment time capturing all enrollment details and consent. Standalone deliverable.
  Evidence                  Any logged record proving service was delivered or engagement occurred. 21 types defined.
  Evidence PDF              Comprehensive document compiling all evidence for a specific client enrollment. Generated on demand.
  Defense Packet            Bundle generated during a chargeback: AI defense letter + enrollment packet + evidence PDF.
  Evidence Timeline         Chronological view of all evidence for a client, unified across all evidence types.
  Custom Workflow Trigger   App-registered event that GHL workflows can listen for and act on.
  Snapshot                  GHL package that pre-installs pipeline, fields, forms, workflows when merchant installs the app.
  Disengagement             Pattern of declining client participation that may indicate chargeback risk.
  Dunning                   Automated sequence for recovering failed payments: notifications + retry attempts.
  Reconciliation            Daily job comparing payment processor records against evidence records to catch gaps.
  Defense Readiness Score   0-100 score per client measuring strength of available defense evidence. Drives dashboard alerts.
  Reason Code Mapping       Lookup table mapping processor reason codes to evidence priorities and defense strategies.
  Defense Template          Proven defense letter template per reason code. Claude customizes with client-specific evidence.
  Total Value Saved         Cumulative dollar value of chargebacks successfully defended. Key merchant dashboard metric.
  GHL Product               Product record created via GHL Products API. Links an offer to a purchasable item with pricing.
  Location ID               GHL sub-account identifier. Used as the primary key for multi-tenant isolation.
  ------------------------- -----------------------------------------------------------------------------------------------------------------------------
