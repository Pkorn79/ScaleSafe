# accept.blue Webhooks v1 Reference
Source: https://docs.accept.blue/webhooks/v1
Saved: 2026-03-16

## SETUP
1. Set up server with publicly accessible HTTPS URL
2. Create webhook endpoint in Control Panel (merchant gateway portal)
3. Enable the endpoint
4. Note the secret token for signature verification

## EXISTING SCALESAFE WEBHOOKS
- Webhook 1566 → S7 Post-Payment Handler | Signature: [REMOVED]
- Webhook 1620 → S10 Installment Logger | Signature: [REMOVED]

## SIGNATURE VERIFICATION
- Header: X-Signature
- Method: HMAC-SHA256 of request body using endpoint's signature key
- Must verify to confirm payload came from accept.blue

## TRANSACTION EVENTS

### 1. Transaction Succeeded
- type: "succeeded"
- subType: "charge" | "credit" | "refund"
- event: "transaction"
- data: full transaction response object
- USE: Fires when charge, credit, OR REFUND succeeds

### 2. Transaction Updated
- type: "updated"
- subType: "adjust" | "void"
- event: "transaction"
- USE: Fires when transaction amount/details changed or voided

### 3. Transaction Declined
- type: "declined"
- subType: "charge" | "adjust" | "credit" | "refund" | "void"
- event: "transaction"
- USE: Fires when any transaction type is declined

### 4. Transaction Error
- type: "error"
- subType: "charge" | "adjust" | "credit" | "refund" | "void"
- event: "transaction"
- USE: Fires when processing error occurs

### 5. Transaction Status Update (ACH only)
- type: "status"
- subType: "settled" | "reserve" | "originated" | "pending" | "voided" | "returned" | "error" | "cancelled" | "unknown"
- event: "transaction"
- USE: ACH status changes only

## BATCH EVENTS

### 6. Batch Closed
- type: "closed"
- event: "batch"
- data: {id, opened_at, auto_close_date, closed_at, platform, sequence_number}

## EVENT DATA STRUCTURE
All events include:
- type (string) — event type
- subType (string) — event subtype
- event (string) — "transaction" or "batch"
- id (string) — idempotent key (use for dedup)
- timestamp (datetime) — when event occurred
- data (object) — full response object

## KEY INSIGHT FOR REFUND TRACKING
When a merchant processes a refund in the accept.blue gateway portal:
1. accept.blue fires a webhook with type: "succeeded", subType: "refund"
2. S7 (Post-Payment Handler) already receives ALL transaction webhooks via Webhook 1566
3. S7 needs a route that catches subType "refund" or "credit" and logs to evidence_refund_activity in Supabase
4. Alternatively, create a new webhook endpoint in accept.blue pointing to S12 (Refund/Cancel Handler)

## BEST PRACTICES
- Verify X-Signature on every webhook
- Track event id for idempotency (prevent duplicate processing)
- Respond with 2xx quickly
- Failed deliveries are retried
- All registered endpoints receive ALL events — filter by type/subType in your handler
