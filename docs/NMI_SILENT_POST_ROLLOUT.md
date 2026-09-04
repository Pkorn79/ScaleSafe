# NMI Silent Post Hardening And Rollout

## Current application containment

The legacy shared callback is safe only when `processor_subscription_id` resolves to exactly one active NMI enrollment in ScaleSafe. The application now:

- stops before loading credentials when zero or multiple enrollment bindings exist;
- never tries one tenant's credentials after another;
- queries NMI with the bound tenant's credentials and the callback transaction ID, stored subscription ID, `source=recurring`, and `action_type=sale`;
- accepts only the exact transaction returned by NMI;
- derives amount, final status, source, action, success, response code, and response text only from the Query API response;
- refuses pending, unknown, non-sale, non-recurring, inconsistent, terminal-enrollment, and invalid-amount results;
- returns `503` when NMI, an essential database lookup, or payment-state persistence fails so NMI can retry;
- resolves duplicate delivery and insert races through the existing payment-event uniqueness boundary before initiating dunning.

No migration, NMI setting, live credential, or deployment is part of this patch.

## Structural limitation

NMI subscription IDs are scoped to an NMI gateway, while the legacy callback URL carries no ScaleSafe tenant or processor-configuration identity. Two independent gateways can therefore produce the same subscription ID. Application code cannot safely choose between those tenants. The contained endpoint records and acknowledges that collision without processing it.

The failed-payment ledger also prevents duplicate dunning at the application boundary, but it is not a durable notification outbox. A process crash after the ledger insert and before all dunning side effects finish can leave those side effects incomplete. Retrying the callback will not repeat them, which favors no duplicate customer messages over automatic recovery.

## Required tenant-bound rollout

1. Add an immutable NMI binding that records enrollment ID, merchant ID, location ID, processor-config ID, and subscription ID. Enforce uniqueness on `(processor_config_id, processor_subscription_id)`.
2. Add a versioned callback URL containing an opaque, signed binding token. Validate the token before any tenant record or credential is loaded, then require every stored identity in the binding to match.
3. Generate the tenant-bound `redirect_url` for every new or resumed NMI subscription. Keep the legacy endpoint in containment mode during transition.
4. Inventory existing subscriptions. Test NMI's supported subscription-update path in an isolated gateway before changing any callback URL. Update existing subscriptions only after that test and an owner-approved rollout plan. Subscriptions that cannot be updated remain on containment plus reconciliation until replaced.
5. Add a durable outbox keyed to the unique payment event. Dunning, workflow, and notification work should claim outbox rows idempotently and expose incomplete delivery for retry and operator review.
6. Reconcile legacy diagnostic rows marked `ignored_ambiguous_subscription`, `handler_error`, or pending beyond the retry window against tenant-bound NMI history.
7. Remove the shared legacy callback only after all active subscriptions are tenant-bound and a full billing cycle shows no legacy traffic.

## Acceptance gates

- collision tests prove that zero tenant credentials are loaded;
- callback fields cannot alter amount, status, source, action, or failure text;
- provider and database outages return non-2xx and later retry successfully;
- concurrent duplicate deliveries produce one payment event and at most one dunning outbox item;
- cross-tenant integration tests use colliding subscription and transaction IDs across two NMI configurations;
- staging observes at least one full recurring billing cycle before production cutover.

NMI Query API reference: https://docs.nmi.com/reference/query
