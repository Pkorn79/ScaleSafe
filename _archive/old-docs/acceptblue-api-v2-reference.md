# accept.blue API v2 Reference
Source: https://docs.accept.blue/api/v2
Saved: 2026-03-16

## AUTHENTICATION
- Basic Auth with source key as username
- Production: https://api.accept.blue/api/v2/
- Sandbox: https://api.sandbox.accept.blue/api/v2/

## KEY ENDPOINTS FOR SCALESAFE

### 1. CHARGE: POST /transactions/charge
- Creates authorization/charge
- Used by S6 (Charge Processor)
- Source key needs Charge permission
- Returns reference_number used for refunds

### 2. CREDIT/REFUND: POST /transactions/credit
- Credits money back to a payment method
- Can use: raw card data, magstripe, check, or SOURCE (previous transaction/token/payment method)
- Source key needs Refund permission (CC) or Check Refund permission (checks)
- Required fields: amount, plus card data OR source reference
- Returns same response schema as charge
- NOTE: To refund a PREVIOUS transaction, use "source" field with the original reference_number. This avoids needing to re-enter card data.

### 3. CAPTURE: POST /transactions/capture
- Captures auth into current batch
- Needs reference_number from original auth

### 4. ADJUST: POST /transactions/adjust
- Adjusts amount/details of unsettled transaction
- Source key needs PIN + Adjust permission
- Can only adjust once per transaction

## CHARGE REQUEST FIELDS
- amount (required, 0.01-20000000)
- card (14-16 digits, required for CC)
- expiry_month (1-12, required)
- expiry_year (2020-9999, required)
- amount_details: {tax, surcharge, shipping, tip, discount}
- name (≤255 chars)
- transaction_details: {description, clerk, terminal, client_ip, signature, invoice_number, po_number, order_number}
- billing_info: {first_name, last_name, street, street2, state, city, zip, country, phone}
- shipping_info: same structure
- custom_fields: {custom1 through custom20}
- customer: {send_receipt, email, fax, identifier, customer_id}
- transaction_flags: {allow_partial_approval, is_recurring, is_installment, is_customer_initiated, cardholder_present, card_present}
- avs_address, avs_zip, cvv2
- capture (default true)
- save_card (default false)

## CHARGE RESPONSE FIELDS
- status: "Approved" (capital A), "Declined", etc.
- status_code: "A", "D", etc.
- auth_amount, auth_code, reference_number
- transaction: {id, created_at, settled_date, amount_details, transaction_details, customer, status_details, billing_info, shipping_info, custom_fields, card_details}
- avs_result, avs_result_code, cvv2_result, cvv2_result_code
- card_type: "Visa", "Mastercard", "Amex", "Discover"
- last_4, card_ref

## CREDIT/REFUND REQUEST FIELDS
- card (14-16 digits, required for CC credits)
- expiry_month, expiry_year (required)
- amount (required, 0.01-20000000)
- avs_address, avs_zip, cvv2
- name (≤255 chars)
- customer, transaction_details, transaction_flags, custom_fields

## CUSTOMER MANAGEMENT
- POST /customers — create customer
- POST /customers (with reference_number) — create from transaction
- POST /customers/{id}/payment-methods — add payment method
- POST /customers/{id}/recurring-schedules — create recurring billing

## RECURRING SCHEDULES
- POST /customers/{id}/recurring-schedules — create
- PATCH /recurring-schedules/{id} — update
- DELETE /recurring-schedules/{id} — delete
- GET /recurring-schedules/{id}/transactions — get transactions
- Frequency options: daily, weekly, biweekly, monthly, bimonthly, quarterly, biannually, annually

## INVOICING
- GET /invoices/{id} — get invoice details
- PATCH /invoices/{id} — update invoice
- Invoice statuses: canceled, draft, sent, viewed, partial, paid

## STATUS CODES
- 200 — success
- 201 — created (customers, payment methods)
- 204 — deleted (recurring schedules)
- 400 — invalid request
- 401 — bad credentials
- 403 — no permission
- 404 — not found
- 409 — duplicate (payment methods)
- 415 — wrong content-type
- 422 — can't update (paid/cancelled invoices)
