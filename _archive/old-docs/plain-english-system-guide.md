# ScaleSafe — Plain English System Guide
What Each Piece Does, In Normal Words
Last Updated: 2026-03-11

## HOW SCALESAFE WORKS (THE BIG PICTURE)

ScaleSafe protects coaching businesses from losing chargebacks. When a client pays for a coaching program and later disputes the charge with their bank, the coach needs evidence to prove the client got what they paid for. ScaleSafe automatically collects that evidence from the moment the client enrolls, stores it neatly, and when a chargeback happens, uses AI to compile a professional defense packet.

Think of it like a security camera system for your coaching business — it's always recording proof that you delivered what you promised.

## THE SCENARIOS (WHAT EACH ONE DOES)

### Merchant Provisioning — "New Merchant Setup"
What it does: When a new coaching business signs up to use ScaleSafe, this creates their dedicated evidence tracking spreadsheet, sets up their folder structure, and gets everything ready for them to start using the system.
When it runs: Once, when a new merchant is first set up.

### Offer Creation — "New Coaching Program Setup"
What it does: When a coach creates a new coaching program (called an "offer") — like "12-Week Business Mastery" — this saves all the details about that program: the price, what's included, how many sessions, the refund policy, etc. This information becomes the foundation of any future chargeback defense.
When it runs: Each time a coach sets up a new program/offer.

### Client Enrollment Prep — "Get Client Ready to Pay"
What it does: When a client is about to enroll in a coaching program, this pulls together all the offer details so the payment page knows what to show — the price, the program name, the terms, etc.
When it runs: When a client clicks to enroll and lands on the payment page.

### Offer Data Fetch — "Look Up Program Details"
What it does: When the payment page loads, it needs to know the details of the specific coaching program. This fetches that information from storage so the page can display the right price, terms, and program name.
When it runs: Every time someone opens a payment page.

### Charge Processor — "Process the Payment"
What it does: This is the cashier. When a client enters their credit card and clicks "Pay," this sends the card info to the payment gateway (accept.blue), processes the charge, and reports back whether it worked or failed.
When it runs: Every time a client submits a payment.

### Post-Payment Handler — "After Payment Bookkeeping"
What it does: After accept.blue confirms a payment went through, this records the transaction details — the amount, the transaction ID, the date, etc. — into the client's record and the evidence sheet. This is one of the most important evidence pieces in a chargeback defense ("yes, they really did pay, here's proof").
When it runs: Automatically triggered by accept.blue after each successful payment.

### Evidence Logger — "The Evidence Collector"
What it does: This is the workhorse. Every time something important happens in the coaching relationship — a session is completed, a milestone is reached, a module is finished, a check-in happens — this logs it to the evidence spreadsheet with timestamps and details. It has 10 different "routes" (like 10 different filing clerks) that each handle a different type of evidence.

The 10 types of evidence it collects:
1. Milestone completions (client hit a major program goal)
2. Coaching sessions delivered
3. Course modules completed
4. Pulse check-ins (regular "how are you doing?" touchpoints)
5. Payment confirmations
6. Session attendance + no-shows
7. Module progress logs
8. Enrollment consent records
9. Enrollment payment records
10. Milestone sign-offs (client acknowledged completing a milestone)

When it runs: Every time any of these events happens.

### Evidence PDF Generator — "Print the Evidence Report"
What it does: Takes all the collected evidence from the spreadsheet and formats it into a professional PDF document that can be submitted to the bank as part of a chargeback defense.
When it runs: When a defense packet needs to be generated.

### External Integration Catcher — "Outside App Connector"
What it does: If a merchant uses other tools (like Calendly, Zoom, Kajabi, etc.) and wants that data to count as evidence too, this is the "front door" that receives that data and routes it to the Evidence Logger. It's basically an adapter that lets outside apps feed evidence into ScaleSafe.
When it runs: Whenever an external app sends data to ScaleSafe.

### Installment Logger — "Payment Plan Tracker"
What it does: When a client is on a payment plan (like paying $500/month for 6 months instead of $3,000 upfront), this tracks each installment payment as it comes in. It records whether each payment succeeded or failed, and logs it as evidence. This is critical because one of the most common chargebacks on coaching programs is "I didn't authorize this recurring charge."
When it runs: Every time an installment payment is processed by accept.blue.

### AI Defense Compiler — "The AI Lawyer"
What it does: When a chargeback actually happens, this is the big gun. It takes ALL the collected evidence — every session, every payment, every milestone, every sign-off — and sends it to Claude (Anthropic's AI). Claude reads through everything and writes a professional chargeback defense letter that argues why the charge was legitimate, citing specific evidence with dates and details. The output is a ready-to-submit defense packet.
When it runs: When a chargeback is filed and the merchant needs to fight it.

## WHAT "TESTING" MEANS

When I say "we need to test the AI Defense Compiler," I mean: we need to pretend a chargeback happened and see if the whole chain works. Specifically:

1. We'd create a fake evidence trail (or use real test data from PMG)
2. Trigger the AI Defense Compiler as if a chargeback just came in
3. See if Claude successfully reads all the evidence
4. Check that it produces a well-written defense letter
5. Make sure the letter gets saved to the right folder

It's like a fire drill — we're not waiting for a real chargeback, we're simulating one to make sure the system responds correctly.

## WHAT "MULTI-TENANT" MEANS

Right now, some parts of ScaleSafe are hardcoded to work only with your test merchant (PMG). "Making it multi-tenant" means making it work for ANY merchant who installs the ScaleSafe snapshot.

For example, the Installment Logger currently uses YOUR accept.blue API credentials directly. When a different coaching business installs ScaleSafe, it needs to use THEIR accept.blue credentials instead. "Making it multi-tenant" means adding a step at the beginning that says: "Who is this merchant? Let me grab THEIR credentials from storage before processing."

Think of it like a hotel key card system. Right now the system only has YOUR room key. Multi-tenant means it has a key rack with every guest's key, and it grabs the right one based on who's checking in.

## THE CODE PAGES

ScaleSafe uses custom code pages inside GHL (GoHighLevel) funnels. These are the actual web pages that clients see and interact with:

### Page 3
The enrollment/consent page. When a client is about to buy a coaching program, this page shows them the terms and conditions, what they're agreeing to, and collects their consent before they pay. This consent record becomes evidence.

### Page 4
The payment page. This is where the client enters their credit card information and pays. It talks to the Charge Processor to process the payment, shows success/failure messages, and logs enrollment evidence.

### Milestone Sign-Off Page
After a client completes a major milestone in their coaching program, this page lets them acknowledge and sign off on it. It's like getting a receipt signature — the client confirms "yes, I completed this milestone." This is powerful chargeback evidence.

## QUICK REFERENCE: SCENARIO NAMES

| Old Name | Plain English Name |
|----------|-------------------|
| Merchant Provisioning | New Merchant Setup |
| Offer Creation | New Coaching Program Setup |
| Client Enrollment Prep | Get Client Ready to Pay |
| Offer Data Fetch | Look Up Program Details |
| Charge Processor | Process the Payment |
| Post-Payment Handler | After Payment Bookkeeping |
| Evidence Logger | The Evidence Collector |
| Evidence PDF Generator | Print the Evidence Report |
| External Integration Catcher | Outside App Connector |
| Installment Logger | Payment Plan Tracker |
| AI Defense Compiler | The AI Lawyer |
