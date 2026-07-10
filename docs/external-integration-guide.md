# ScaleSafe External Evidence Connections

ScaleSafe accepts enrollment-scoped activity from custom software, automation tools, and webhook-capable services. External events are authenticated, assigned to the credential's GHL sub-account, resolved to one exact enrollment, and then normalized into defense-ready evidence.

## Connection Options

- **Canonical API:** the sender builds ScaleSafe's standard event body and posts it to `POST https://dashboard.scalesafe.app/api/v1/evidence/events`.
- **Raw webhook:** the source sends its native JSON to the secret endpoint generated in **Settings > Evidence Connections**. A saved mapping converts it to the canonical event shape.
- **Legacy endpoint:** `/webhooks/external` remains available during beta, but now requires the merchant webhook secret and routes through the same enrollment-safe intake ledger.

CSV import, generic polling, and named provider integrations are not part of the first release.

## Setup

1. Open the correct GHL sub-account.
2. In ScaleSafe, open **Settings > Evidence Connections**.
3. Create a Canonical API or Raw Webhook connection.
4. Record the credential when it is displayed. ScaleSafe stores only its hash unless HMAC verification requires encrypted retrieval.
5. For raw webhooks, configure resource mappings from the outside course, product, calendar, or service to a ScaleSafe offer.
6. Preview a sample payload.
7. Run a synthetic connection test against a selected enrollment.
8. Confirm the event reports as a test and does not appear as client evidence.

## Documentation

- [Canonical API](external-evidence-api.md)
- [Raw webhook mapping](external-webhook-mapping.md)
- [Event taxonomy](external-evidence-event-taxonomy.md)
- [Security and troubleshooting](external-evidence-security-and-troubleshooting.md)
- [Defense evidence contract](external-evidence-defense-contract.md)

No integration may choose a GHL location through its payload. The credential determines the merchant and sub-account.
