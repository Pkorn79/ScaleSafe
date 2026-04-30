# External Integration Guide for ScaleSafe

## Overview

**Current V2 direction:** ScaleSafe will not use Make.com for current or future external integration architecture. This guide describes direct/app-native webhook integrations that post to the ScaleSafe app endpoint. Older Make.com references in historical or archived docs are V1 artifacts and must not be used for new work.

External integrations allow ScaleSafe to automatically capture and synchronize data from various learning management systems, payment platforms, scheduling tools, and other third-party services. These integrations use webhooks to send structured event data to ScaleSafe, enabling real-time tracking of session attendance, module completion, milestone milestones, payment updates, and participant feedback.

By connecting external platforms to ScaleSafe, you can maintain a unified view of all client progress without manual data entry, streamline workflow across multiple tools, and ensure accurate tracking of deliverables and evidence for your program.

## Webhook Configuration

### Webhook URL

All external events should be sent to:

```
https://scalesafe-production.up.railway.app/webhooks/external
```

Use the ScaleSafe app endpoint directly. Do not route new external integrations through Make.com.

### Required Fields

### Required ScaleSafe Header

When an external platform or direct integration adapter posts events to ScaleSafe, include this HTTP header:

| Header | Value |
|--------|-------|
| `x-scalesafe-webhook-secret` | Merchant-specific secret from ScaleSafe Settings > Workflow Webhooks |

ScaleSafe currently accepts unsigned external posts only while `REQUIRE_WEBHOOK_SECRET=false` during rollout. Once enforcement is enabled, missing or invalid headers return `401`, and a valid secret for a different `location_id` returns `403`.

Every webhook payload must include the following top-level fields:

| Field | Type | Description |
|-------|------|-------------|
| source | string | The platform or tool sending the data (e.g., "calendly", "teachable", "zoom", "zapier") |
| event_type | string | The type of event being reported (see Supported Event Types below) |
| location_id | string | The GHL location ID associated with this event (274dtgl30b7x2HG8hn69 for PMG) |
| contact_email | string | Email address of the participant |
| contact_name | string | Full name of the participant |
| contact_id | string | GHL contact ID if available |
| data | object | Event-specific fields (structure varies by event_type) |

Example base structure:

```json
{
  "source": "calendly",
  "event_type": "session_completed",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "john.doe@example.com",
  "contact_name": "John Doe",
  "contact_id": "ghl_contact_id_here",
  "data": {
    // event-specific fields
  }
}
```

## Supported Event Types

### 1. session_completed

Fired when a participant attends and completes a live or virtual training session.

**Data fields:**
- session_type (string): Type of session (e.g., "group_training", "one_on_one", "webinar", "workshop")
- group_name (string): Name or identifier of the training group
- session_date (string): Date of the session (ISO 8601 format: YYYY-MM-DD)
- session_number (integer): Sequential session number (e.g., 1, 2, 3)
- topics (array of strings): Main topics covered in the session
- duration (integer): Duration in minutes
- notes (string): Optional notes from the facilitator

**Example:**
```json
{
  "source": "zoom",
  "event_type": "session_completed",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "jane.smith@example.com",
  "contact_name": "Jane Smith",
  "contact_id": "ghl_123abc",
  "data": {
    "session_type": "group_training",
    "group_name": "Cohort A - Q1 2026",
    "session_date": "2026-03-24",
    "session_number": 3,
    "topics": ["Advanced Strategies", "Implementation Best Practices"],
    "duration": 90,
    "notes": "Great participation from all attendees"
  }
}
```

### 2. no_show

Fired when a participant was scheduled for a session but did not attend.

**Data fields:**
- session_type (string): Type of session
- group_name (string): Name or identifier of the training group
- session_date (string): Date of the scheduled session (ISO 8601 format)
- session_number (integer): Sequential session number
- topics (array of strings): Topics that would have been covered
- duration (integer): Scheduled duration in minutes
- notes (string): Optional reason for absence or follow-up notes

**Note:** The `attendance` status for this contact will be automatically set to "No-Show" in the evidence tracking system.

**Example:**
```json
{
  "source": "calendly",
  "event_type": "no_show",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "bob.johnson@example.com",
  "contact_name": "Bob Johnson",
  "contact_id": "ghl_456def",
  "data": {
    "session_type": "one_on_one",
    "group_name": "Private Coaching",
    "session_date": "2026-03-23",
    "session_number": 1,
    "topics": ["Goal Setting", "Action Planning"],
    "duration": 60,
    "notes": "Client cancelled 2 hours before meeting"
  }
}
```

### 3. module_completed

Fired when a participant completes a self-paced online module or course.

**Data fields:**
- module_name (string): Name of the module or course
- completion_date (string): Date of completion (ISO 8601 format: YYYY-MM-DD)
- score (number): Completion score or percentage (0-100)
- time_spent (integer): Total time spent in the module (in minutes)

**Example:**
```json
{
  "source": "teachable",
  "event_type": "module_completed",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "sarah.williams@example.com",
  "contact_name": "Sarah Williams",
  "contact_id": "ghl_789ghi",
  "data": {
    "module_name": "Advanced Marketing Fundamentals",
    "completion_date": "2026-03-22",
    "score": 88,
    "time_spent": 240
  }
}
```

### 4. milestone_signed

Fired when a participant signs off on or approves a project milestone or deliverable.

**Data fields:**
- milestone_name (string): Name of the milestone
- summary (string): Brief description of what was delivered
- approved (boolean): Whether the milestone was approved (true) or rejected (false)

**Example:**
```json
{
  "source": "zapier",
  "event_type": "milestone_signed",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "michael.brown@example.com",
  "contact_name": "Michael Brown",
  "contact_id": "ghl_012jkl",
  "data": {
    "milestone_name": "Strategy Document Approval",
    "summary": "Client approved final marketing strategy document with all revisions completed",
    "approved": true
  }
}
```

### 5. pulse_check

Fired when a participant completes a satisfaction survey or pulse check feedback form.

**Data fields:**
- satisfaction (integer): Overall satisfaction rating (1-10 scale)
- nps_score (integer): Net Promoter Score response (-10 to +10 scale)
- going_well (string): What is going well in the program
- concerns (string): Any concerns or challenges the participant has
- testimonial_willing (boolean): Whether the participant agreed to provide a testimonial

**Example:**
```json
{
  "source": "zapier",
  "event_type": "pulse_check",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "emily.davis@example.com",
  "contact_name": "Emily Davis",
  "contact_id": "ghl_345mno",
  "data": {
    "satisfaction": 9,
    "nps_score": 8,
    "going_well": "The one-on-one coaching sessions have been incredibly valuable. I'm seeing direct results in my business.",
    "concerns": "Would prefer more flexibility in scheduling. Sometimes the fixed times don't work with my client meetings.",
    "testimonial_willing": true
  }
}
```

### 6. payment_update

Fired when a payment is made, refunded, or when payment terms are updated.

**Data fields:**
- reason (string): Reason for the payment event (e.g., "payment_received", "refund_issued", "plan_upgrade", "failed_payment")
- amount (number): Payment amount in dollars
- frequency (string): Payment frequency (e.g., "one_time", "monthly", "quarterly")
- consent (boolean): Whether the participant consented to the payment or terms update

**Example:**
```json
{
  "source": "stripe",
  "event_type": "payment_update",
  "location_id": "274dtgl30b7x2HG8hn69",
  "contact_email": "david.miller@example.com",
  "contact_name": "David Miller",
  "contact_id": "ghl_678pqr",
  "data": {
    "reason": "payment_received",
    "amount": 2499.99,
    "frequency": "one_time",
    "consent": true
  }
}
```

## Tool-Specific Setup

### Calendly Integration

1. Log into your Calendly account
2. Navigate to **Integrations** â†’ **Webhooks**
3. Click **Add Webhook**
4. Set the webhook URL to: `https://scalesafe-production.up.railway.app/webhooks/external`
5. Select the events you want to track:
   - **Invitee Created** â†’ maps to `session_completed` (once confirmed)
   - **Invitee Cancelled** â†’ maps to `no_show`
6. For each webhook event, Calendly will send participant details automatically
7. Transform the Calendly payload to match the ScaleSafe schema using a direct adapter or Zapier

### Teachable / Kajabi / Thinkific Integration

1. Log into your learning platform
2. Navigate to **Integrations** or **Webhooks** settings
3. Create a new webhook with URL: `https://scalesafe-production.up.railway.app/webhooks/external`
4. Select the events to track:
   - **Course Completed** â†’ maps to `module_completed`
   - **Lesson Completed** â†’ maps to `module_completed`
   - **Quiz Passed** â†’ can map to `module_completed` with score data
5. Ensure the webhook includes:
   - Student email address
   - Student name
   - Course/module name
   - Completion date
   - Score (if available)
6. Set up a middleware (direct integration adapter) to normalize the payload to ScaleSafe format

### Zoom Integration

1. Log into Zoom with admin credentials
2. Go to **App Marketplace** â†’ **Webhooks**
3. Create a new webhook application
4. Set webhook URL to: `https://scalesafe-production.up.railway.app/webhooks/external`
5. Subscribe to the following events:
   - **Webinar Ended** â†’ triggers `session_completed`
   - **Meeting Ended** â†’ triggers `session_completed`
6. Zoom will send participant attendance data
7. Use your direct integration adapter to:
   - Extract attendee email and name from Zoom payload
   - Map meeting/webinar details to `session_type`, `group_name`, `topics`
   - Calculate `duration` from meeting start/end times
   - Send formatted payload to ScaleSafe webhook

### Zapier General Pattern

Zapier can connect virtually any platform to ScaleSafe:

1. **Trigger Setup:**
   - Choose your source app (Google Forms, Stripe, Slack, etc.)
   - Select the event type (form submission, payment received, etc.)

2. **Action Setup:**
   - Select **Webhooks by Zapier** â†’ **POST**
   - Set URL: `https://scalesafe-production.up.railway.app/webhooks/external`
   - Set method: POST
   - Set Content Type: application/json

3. **Payload Mapping:**
   - Map source fields to ScaleSafe required fields:
     - `source` â†’ hardcode the app name (e.g., "google_forms")
     - `event_type` â†’ set based on the action type
     - `contact_email` â†’ map from source contact email field
     - `contact_name` â†’ map from source name field
     - `location_id` â†’ hardcode "274dtgl30b7x2HG8hn69"
     - `data` â†’ map event-specific fields

4. **Test and Activate:**
   - Send a test event
   - Verify payload arrives at the webhook
   - Activate the Zap

### Direct API Integration

If you're building a custom application:

1. **Prepare your payload** according to the schema above
2. **Send a POST request** to: `https://scalesafe-production.up.railway.app/webhooks/external`
3. **Headers:**
   ```
   Content-Type: application/json
   x-scalesafe-webhook-secret: <merchant webhook secret>
   ```
4. **Example cURL:**
   ```bash
   curl -X POST https://scalesafe-production.up.railway.app/webhooks/external \
     -H "Content-Type: application/json" \
     -H "x-scalesafe-webhook-secret: <merchant webhook secret>" \
     -d '{
       "source": "custom_app",
       "event_type": "session_completed",
       "location_id": "274dtgl30b7x2HG8hn69",
       "contact_email": "user@example.com",
       "contact_name": "User Name",
       "contact_id": "ghl_id",
       "data": {
         "session_type": "group_training",
         "group_name": "Cohort A",
         "session_date": "2026-03-24",
         "session_number": 1,
         "topics": ["Topic 1"],
         "duration": 60,
         "notes": ""
       }
     }'
   ```

5. **Expected response:**
   - Status 200-299: Payload accepted and processed
   - Status 4xx/5xx: Check payload structure and required fields

## Appendix: S13 Service Access Tracking

### Overview

S13 Service Access Tracking monitors participant engagement with digital learning platforms and self-paced course content. The webhook captures platform-specific activity data to verify deliverable completion and measure course consumption.

### Webhook Configuration

**Webhook URL:**
```
https://scalesafe-production.up.railway.app/webhooks/external
```

**Required Fields for S13 Access Events:**
- source: Service platform name
- event_type: "service_access" or "module_completed"
- location_id: "274dtgl30b7x2HG8hn69"
- contact_email: Participant email
- contact_name: Participant full name
- contact_id: GHL contact ID if available
- data.platform: Specific platform (kajabi, skool, ghl_memberships, teachable)
- data.access_date: Date of access (ISO 8601)
- data.content_accessed: Name of course, lesson, or module
- data.time_spent: Minutes spent (optional)
- data.completion_status: "started", "in_progress", "completed"

### Platform-Specific Setup

#### Kajabi

1. Log into Kajabi admin dashboard
2. Go to **Settings** â†’ **Integrations** â†’ **Webhooks**
3. Add webhook URL: `https://scalesafe-production.up.railway.app/webhooks/external`
4. Enable events:
   - Course Enrollment
   - Lesson Started
   - Lesson Completed
   - Course Completed
5. Kajabi will include student email, course name, and timestamps
6. Set source: "kajabi"

#### Skool

1. Log into Skool community dashboard
2. Navigate to **Settings** â†’ **API & Integrations**
3. Create a new webhook
4. Set URL: `https://scalesafe-production.up.railway.app/webhooks/external`
5. Subscribe to:
   - Member joined course
   - Member completed lesson
   - Member completed course
6. Skool payload includes member email and course details
7. Set source: "skool"

#### GHL Memberships

1. In GHL account, navigate to **Memberships**
2. Select the membership site
3. Go to **Settings** â†’ **Integrations**
4. Add webhook: `https://scalesafe-production.up.railway.app/webhooks/external`
5. Enable events:
   - Member Access
   - Course Progress Updated
   - Module Completed
6. GHL will send contact ID, email, course name, and completion data
7. Set source: "ghl_memberships"

#### Teachable

1. Log into Teachable
2. Go to **Settings** â†’ **Webhooks**
3. Add endpoint: `https://scalesafe-production.up.railway.app/webhooks/external`
4. Select events:
   - User Enrolled in Course
   - User Completed Course
   - User Completed Section
   - User Completed Lecture
5. Teachable includes email, name, course name, and completion percentage
6. Set source: "teachable"

## Troubleshooting

### Webhook Not Firing

**Problem:** Events are not being received at the ScaleSafe webhook.

**Solutions:**
1. Verify the webhook URL is exactly correct in the external platform settings
2. Check that you've subscribed to the correct event types in the source platform
3. Ensure the event you're testing actually occurs in the external platform (e.g., meeting actually ended for Zoom)
4. Check network firewall/proxy settings aren't blocking outbound requests to the ScaleSafe app endpoint
5. Review direct integration adapter logs to see if the webhook is being triggered

### Payload Validation Errors

**Problem:** Webhooks are firing but payloads are being rejected.

**Solutions:**
1. Ensure all required fields are present: source, event_type, location_id, contact_email, contact_name, contact_id, data
2. Verify `location_id` is exactly "274dtgl30b7x2HG8hn69"
3. Check that `event_type` is one of the 6 supported types: session_completed, no_show, module_completed, milestone_signed, pulse_check, payment_update
4. Validate that `data` contains the correct event-specific fields for the event_type
5. Ensure email addresses are valid format (contains @)
6. Verify numeric fields (duration, amount, session_number) are numbers, not strings

### Contact Not Found / Not Created

**Problem:** Webhook processed but participant not found in GHL.

**Solutions:**
1. Verify contact_email matches an existing contact in the GHL location (274dtgl30b7x2HG8hn69)
2. If contact_id is provided, ensure it's a valid GHL contact ID
3. If contact doesn't exist, the system may create a new contact automatically; check GHL Contacts list
4. Ensure no typos in email address in the external platform
5. Confirm the participant was added to the correct GHL location

### Data Not Appearing in Evidence Dashboard

**Problem:** Webhook accepted but event data not visible in ScaleSafe.

**Solutions:**
1. Check that the direct integration adapter has a handler for the incoming webhook (trigger configured)
2. Verify the direct integration adapter is activated and not disabled
3. Ensure the downstream GHL custom object or data store is configured to receive the data
4. Allow 5-10 minutes for data propagation through the system
5. Check GHL custom object records or data store to see if the record exists
6. Review integration execution history to trace the complete data flow

### Email or Name Mismatch

**Problem:** Participant information appears but with incorrect email or name.

**Solutions:**
1. Verify the email and name mapping in your middleware (Zapier/direct integration adapter)
2. Check the source platform to see what data it's actually sending in the webhook
3. Ensure custom fields in the source platform contain the correct data
4. Test with a known participant to debug the mapping
5. Update the Zapier/direct integration adapter if the source platform changed field names

### Rate Limiting

**Problem:** Webhooks work intermittently or are delayed.

**Solutions:**
1. The webhook URL is shared across multiple integrations; consider implementing exponential backoff in retries
2. The sending platform may have rate limits; ensure retries use reasonable backoff
3. Batch process bulk events if sending many webhooks in a short timeframe
4. Monitor integration execution metrics for bottlenecks