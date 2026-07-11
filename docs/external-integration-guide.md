# ScaleSafe External Evidence Connections

ScaleSafe accepts enrollment-scoped activity from custom software, automation tools, and webhook-capable services. External events are authenticated, assigned to the credential's GHL sub-account, resolved to one exact enrollment, and then normalized into defense-ready evidence.

## Connection Options

- **Canonical API:** the sender builds ScaleSafe's standard event body and posts it to `POST https://dashboard.scalesafe.app/api/v1/evidence/events`.
- **Raw webhook:** the source sends its native JSON to the operator-installed secret endpoint. An HQ-approved mapping converts it to the canonical event shape.
- **Legacy endpoint:** `/webhooks/external` remains available during beta, but now requires the merchant webhook secret and routes through the same enrollment-safe intake ledger.

CSV import, generic polling, and named provider integrations are not part of the first release.

## Setup

During beta, ScaleSafe/WholePay performs setup once in the internal ScaleSafe HQ console:

1. Select the exact GHL sub-account.
2. Create a disabled Canonical API or Raw Webhook draft.
3. Install the one-time credential in the outside system or provide it to the merchant's developer.
4. Preview sample payloads without creating evidence.
5. Approve each external resource-to-offer mapping.
6. Choose the identity strategy.
7. Run an exact tenant and enrollment test.
8. Activate only after the test publishes as test-only diagnostic activity.

The merchant's **Settings > Evidence Connections** page is read-only. It shows connection health, recent evidence, and affected programs. Merchants do not create credentials, map resources, replay events, or repair individual records.

## Documentation

- [Canonical API](external-evidence-api.md)
- [Raw webhook mapping](external-webhook-mapping.md)
- [Event taxonomy](external-evidence-event-taxonomy.md)
- [Security and troubleshooting](external-evidence-security-and-troubleshooting.md)
- [Defense evidence contract](external-evidence-defense-contract.md)

No integration may choose a GHL location through its payload. The credential determines the merchant and sub-account.
