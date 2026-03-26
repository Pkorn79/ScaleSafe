# ScaleSafe — Merchant Operating Manual
Version 1.0 | March 2026

NOTE: Many of the settings described in this manual will eventually be managed through the ScaleSafe Merchant Portal (currently in development). Until that portal is live, merchants interact with the system through the GHL back-end and the tools described below.

## 1. WHAT IS SCALESAFE?

ScaleSafe is a chargeback defense system built for high-ticket coaching businesses. It runs inside your GHL (GoHighLevel) account and automatically collects evidence of service delivery throughout your client relationships. When a chargeback happens, ScaleSafe has already built your defense file — session logs, milestone sign-offs, pulse checks, payment records, and T&C consent.

The system works by connecting three layers:
- GHL — where your contacts, offers, forms, workflows, and pipeline live
- Make.com — the automation engine that processes data between systems
- Supabase — where all evidence is stored in a structured, auditable database

Everything is designed to be portable. When you set up ScaleSafe in a new GHL sub-account (via snapshot), you configure a handful of location-level custom values and the system adapts to your business.

## 2. KEY AREAS IN YOUR GHL BACK-END

### CONTACTS
Your client records. Each enrolled client gets custom fields populated with their offer details (program name, payment type, milestone names, T&C consent, etc.). Look for fields prefixed with "Offer" (e.g., "Offer Program Name", "Offer Payment Type") and "SS" (e.g., "SS Subscription Start", "Current Milestone Name").

### OPPORTUNITIES (Pipeline)
The "Client Milestones" pipeline tracks each client's progress through your program. Stages are: New Client → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8. Each stage corresponds to a milestone in the offer. When a client moves stages, that movement gets logged as evidence.

### CUSTOM VALUES (Settings → Custom Values)
Location-level configuration keys that tell ScaleSafe how to connect to your external services. These are the "SS" prefixed values that need to be set for your account.

### CUSTOM OBJECTS (Settings → Objects)
The "Offers" custom object stores your offer library — each offer defines a program with its price, payment terms, milestone names, descriptions, and T&C clauses.

### WORKFLOWS
Several GHL workflows fire in response to form submissions and contact events. Key ones include:
- WF-02 (Module Progress Logger) — logs module completion to the evidence sheet
- WF-01 (No-Show Session Logger) — tracks when clients miss sessions
- Various SYS2- workflows for pulse checks, payment updates, etc.

### FORMS
Evidence collection forms that coaches/staff fill out during service delivery:
- SYS2-07 (Session Log) — records each coaching session
- SYS2-08 (Module Progress) — logs completion of program modules
- SYS2-06 (Milestone Sign-Off) — captures milestone delivery and client acknowledgment
- SYS2-09 (Pulse Check) — periodic client satisfaction snapshots
- SYS2-10 (Payment Update) — payment event tracking
- SYS2-11 (Cancellation) — cancellation requests

## 3. THE OFFER SYSTEM

Offers are the foundation of ScaleSafe. An "offer" is a complete package definition for a coaching program:

### WHAT AN OFFER CONTAINS:
- Program name and description
- Pricing: PIF (paid-in-full) price, installment amount, frequency, number of payments
- Up to 8 milestones, each with: name, what you deliver, what the client does
- T&C clauses (compiled from the clause library plus any custom clauses)
- Refund policy reference

### HOW OFFERS WORK:
1. You create an offer record in the Offers custom object (or through the enrollment flow)
2. When a client enrolls, the offer data gets copied onto their contact record and opportunity
3. The milestones from the offer populate the pipeline stages for that client
4. T&C consent is captured during enrollment and logged as evidence

### MANAGING OFFERS:
Currently, offers are created through the Make.com automation (Scenario S3 — Offer Creation). In the future, the merchant portal will provide a user-friendly offer builder.

## 4. CLIENT ENROLLMENT FLOW

When a new client enrolls, here's what happens behind the scenes:

1. OFFER SELECTION — The enrollment process references an existing offer
2. DATA COPY — Offer details (program, price, milestones, T&C) are copied to the contact's custom fields
3. OPPORTUNITY CREATED — A pipeline card is created in "Client Milestones" at the "New Client" stage
4. PAYMENT INITIATED — If installments, the subscription is created in accept.blue
5. T&C CONSENT CAPTURED — The client's agreement to terms is logged and timestamped
6. EVIDENCE SHEET INITIALIZED — A row or set of entries begins populating in the evidence sheet

The enrollment process involves Make.com scenarios S4 (Client Enrollment Prep), S5 (Offer Data Fetch), S6 (Charge Processor), and S7 (Post-Payment Handler) working in sequence.

## 5. CUSTOM VALUES YOU NEED TO SET

These are the location-level settings that connect ScaleSafe to your specific services. In GHL, go to Settings → Custom Values.

### PAYMENT PROCESSING (accept.blue):
- SS Accept.blue API Key — Your accept.blue API key for processing payments
- SS Accept.blue Tokenization Key — Used for secure card tokenization on enrollment forms
- SS Accept.blue Webhook Signature — Validates that payment webhooks are genuinely from accept.blue

### GOOGLE DRIVE:
- SS Drive Merchant Folder ID — The Google Drive folder ID for your merchant's top-level folder
- SS Drive Evidence Folder ID — The subfolder where evidence documents are stored
- SS Drive Defense Folder ID — The subfolder where compiled defense packages are saved

### AUTOMATION:
- SS Apps Script URL — The URL of the Google Apps Script that handles sheet operations

### PRE-EXISTING VALUES:
- Evidence Sheet ID — The Google Sheet ID where all evidence is logged
- Merchant Business Name — Your business's legal name (appears on defense documents)
- Merchant Support Email — The email address shown to clients for support
- Merchant Descriptor — Your payment descriptor (what appears on client bank statements)
- TC Document URL — Public URL for your terms and conditions page

### T&C CONFIGURATION (now per-offer):
Note: As of March 2026, T&C clause selection has moved from merchant-level custom values to per-offer configuration. Each offer defines its own clause selections.
- Custom Clause 1-2 Title/Text — Legacy custom clauses (now set per-offer)
- TC Has Own — Whether you're using your own T&C document vs. ScaleSafe's generated one

### EVIDENCE MODULES:
- Module Session Tracking — Enable/disable session logging
- Module Milestone Tracking — Enable/disable milestone sign-offs
- Module Pulse Check — Enable/disable satisfaction checks
- Module Payment Tracking — Enable/disable payment event logging
- Module Course Progress — Enable/disable course/module progress tracking

### INCENTIVE PROGRAM:
- Incentive Program Enabled — Toggle the engagement incentive system
- Incentive Tier 1/2 Description — What the incentive tiers mean
- Incentive Tier 1/2 Threshold — Engagement point thresholds for each tier

## 6. THE EVIDENCE DATABASE (SUPABASE)

Evidence is stored in Supabase — a structured, auditable database. Each evidence type has its own table.

### EVIDENCE TABLES:
- SYS2-07 Session — Coaching session records (date, duration, topics, notes)
- SYS2-08 Module — Module/course completion records
- SYS2-06 Milestone — Milestone delivery sign-offs
- SYS2-09 Pulse — Client satisfaction pulse checks
- SYS2-10 Payment — Payment events and updates

### HOW DATA GETS THERE:
When a form is submitted in GHL, a workflow fires and sends the data to the app's webhook endpoint. The app routes the data to the correct Supabase table based on which form triggered it. This happens automatically — no manual steps needed.

### WHAT TO KNOW:
- Don't manually edit evidence records — they form an audit trail
- Each record is timestamped and tied to a specific contact
- The data in Supabase is what gets compiled into a defense package when a chargeback occurs

## 7. THE MILESTONE PIPELINE

The "Client Milestones" pipeline in GHL is a visual tracker for where each client stands in your program.

### STAGES:
New Client → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8

Each stage corresponds to a milestone defined in the client's offer. Not every offer uses all 8 milestones.

### WHAT YOU DO:
- When you complete a milestone delivery, submit the milestone sign-off form
- The pipeline card moves to the next stage automatically (or you can move it manually)
- Each stage transition is logged as evidence

## 8. PAYMENT PROCESSING

ScaleSafe uses accept.blue as its payment processor. This handles:
- One-time payments (PIF — paid in full)
- Recurring subscriptions (installment plans)
- Card tokenization (secure card storage for recurring charges)

Your accept.blue API credentials are stored in the SS-prefixed custom values. When a client enrolls, the system uses these credentials to create charges or subscriptions. Payment events from accept.blue are sent back via webhook and logged as evidence.

## 9. T&C AND CLICKWRAP SYSTEM

ScaleSafe includes a terms and conditions system that captures legally defensible consent during enrollment.

### HOW IT WORKS:
- A library of standard clauses covers common coaching scenarios
- Clause selections are configured per-offer
- You can add custom clauses specific to each offer
- During enrollment, the client sees a clickwrap consent component
- Their acceptance is timestamped and logged as evidence

This consent record is one of the strongest pieces of evidence in a chargeback defense.

## 10. WHAT HAPPENS WHEN A CHARGEBACK HITS

### EVIDENCE ALREADY COLLECTED:
- T&C consent with timestamp and IP
- Session logs showing coaching was delivered
- Module progress showing the client engaged with the program
- Milestone sign-offs showing deliverables were completed
- Pulse check records showing the client expressed satisfaction
- Payment history showing the agreed-upon payment schedule
- Communication/touchpoint records

### DEFENSE PACKAGE:
The AI Defense Compiler compiles all evidence for the disputed client into a formatted defense document (PDF) that can be submitted to your payment processor or acquiring bank.

### YOUR ROLE:
The more consistently you log evidence during normal service delivery, the stronger your defense. Just use the forms during your normal workflow and the system handles the rest.

## 11. QUICK REFERENCE

### WHERE TO FIND THINGS:
- Your offers → GHL → Contacts → Custom Objects → Offers
- Client progress → GHL → Opportunities → Client Milestones pipeline
- Evidence logs → Supabase evidence database
- System settings → GHL → Settings → Custom Values (SS- prefixed values)
- Payment processing → accept.blue control panel

### KEY FORMS TO USE REGULARLY:
- SYS2-07: Log every coaching session
- SYS2-08: Log when a client completes a module
- SYS2-06: Record milestone sign-offs
- SYS2-09: Periodic satisfaction checks
- SYS2-10: Manual payment event notes

### GOLDEN RULE:
Log everything. The best chargeback defense is a consistent, timestamped trail of service delivery. ScaleSafe makes it easy — just use the forms, and the system does the rest.
