# ScaleSafe — Project Rules

## Project Identity

ScaleSafe is a GHL Marketplace app that helps coaches and service providers defend against chargebacks by collecting evidence throughout the client lifecycle.

- **Backend:** Express + TypeScript (Node 18)
- **Frontend:** Vue 3 + Vite (SPA served from `/ui`)
- **Database:** Supabase (PostgreSQL)
- **Deployment:** Railway (auto-deploys from GitHub `main`)
- **Auth:** GHL OAuth2 (install) + SSO postMessage handshake (iframe)

## Build Philosophy

**Always build for scale.** Every feature must work for merchant #1 and merchant #1000. Never shortcut because "there's only one merchant right now." If a scaling issue is identified, fix it properly — build the registry, the per-merchant storage, the graceful partial failure. This is a marketplace app, not a single-tenant prototype.

## Architecture Constraints

1. **GHL custom value IDs are per-merchant.** Each merchant's discovered IDs are stored in `merchants.custom_value_ids` JSONB column. The canonical registry is `CUSTOM_VALUE_REGISTRY` in `src/constants/ghl-fields.ts`. The file `src/constants/ghl-custom-value-ids.ts` contains PMG-specific IDs for reference only — never import from it in production code.
2. **All GHL field/value name mappings** live in `src/constants/ghl-fields.ts`. This imports from the IDs file.
3. **Standard T&C clauses** are defined in `src/constants/standard-clauses.ts`.
4. **GHL API calls** go through `src/clients/ghl.client.ts`. Never call GHL directly from controllers or services.
5. **Every database query filters by `location_id`** — multi-tenant from day one.
6. **Services never send communications** — they fire GHL custom workflow triggers; GHL workflows handle comms.
7. **Payment architecture:** ScaleSafe processes payments through merchant's connected NMI or Stripe accounts via GHL Custom Payment Provider. ScaleSafe never holds funds — transactions settle directly to the merchant's processor account. NMI is the processing rail. Stripe is the defense + optional processing rail (connected via Stripe Connect OAuth with direct charges).
8. **The 6 SS contact fields** the app manages are in `SS_CONTACT_FIELDS` in `ghl-fields.ts`. Do not add more without explicit approval.
9. **Offers Custom Object sync is disabled for beta.** Do not make it an onboarding requirement. The app still creates the GHL Product/Price records used by its checkout/payment-provider bridge.

## Never Do

- **Never invent GHL field IDs or custom value IDs.** Verify against current constants and the exact merchant's Provisioning Health or live GHL state.
- **Never commit `.env` files, credentials, or database connection strings.** Check for secrets before staging.
- **Never modify the Supabase schema without a migration file** in `supabase/migrations/`.
- **Never assume GHL uses camelCase.** GHL mixes snake_case and camelCase inconsistently (e.g., `sso_key` not `ssoKey`, `location_id` not `locationId` in some contexts). Always verify against working code or API docs.
- **Never add features, refactoring, or "improvements" beyond what was requested.**
- **Never touch:** OAuth flow, webhook handlers, or evidence/defense services unless explicitly asked. Do not reintroduce retired V1 Make.com dependencies.

## Docs Trust Warning

Documents in `/docs` may contain inaccuracies introduced by an external AI session. **Before implementing anything based on a `/docs` file:**

1. Verify GHL field names, IDs, and schemas against the constants files in `src/constants/`
2. If the claim is about live GHL state, verify the exact merchant through Provisioning Health, the current GHL UI, or a current authenticated GHL API/connector.
3. The constants files and live GHL data are the **source of truth**, not the docs

### Payment Processing (Custom Payment Provider)

- `processor_configs` table — NMI credentials (encrypted) + Stripe Connect tokens per merchant
- `ProcessorInterface` — shared checkout interface (charge, refund, saveCard, etc.)
- `ProcessorFactory` — resolves merchant + offer → correct processor client
- `nmi.client.ts` — NMI Collect.js + transact.php + Customer Vault (Phase B)
- `stripe.client.ts` — Stripe Payment Intents + Elements + Connect (Phase C)
- Stripe Defense Layer — 9 modules for evidence, disputes, Radar, health monitoring (Phases S1-S4)

## File Conventions

```
src/
  clients/         — External API clients (ghl.client.ts, supabase.client.ts, nmi.client.ts, stripe.client.ts)
  errors/          — Custom error classes (processor.error.ts)
  interfaces/      — TypeScript interfaces (processor.interface.ts)
  config.ts        — Environment config
  constants/       — GHL field IDs, custom value IDs, standard clauses, trigger keys
  controllers/     — Express route handlers (*.controller.ts)
  middleware/       — SSO auth, tenant context
  repositories/    — Supabase data access (*.repository.ts)
  routes/           — Express routers (*.routes.ts)
  services/         — Business logic (*.service.ts)
  types/            — TypeScript type definitions
  ui/               — Vue 3 frontend (separate package.json)
  utils/            — Logger, errors, helpers
```

## Changelog Rule

Every commit must have a corresponding entry in `CHANGELOG.md`. Update the changelog before committing. Use Keep a Changelog format (Added/Changed/Fixed/Security).

## Post-Deploy Verification

After a change touching provisioning, offers, or config sync:

1. Run the exact merchant's ScaleSafe Provisioning Health check.
2. Verify required ScaleSafe custom fields and values in that GHL location.
3. Verify offer data and client-facing names through the ScaleSafe UI.
4. Check Railway logs for failed sync requests.
5. Prove any affected workflow from ScaleSafe delivery through GHL execution and outbound communication.

Report mismatches before moving on. Do not use an Offers Custom Object as beta verification.

## Key Reference Docs

- `docs/FULL_ARCHITECTURE_MAP.md` — Every table, endpoint, service across all 10 phases
- `docs/SCALESAFE_APP_BLUEPRINT_v2.1.md` — Complete product spec
- `docs/CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md` — Payment infrastructure build plan (Phases A-E + S1-S4)
- `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md` — Current workflow scalar-field contract
- `docs/user-guide/INSTALLATION_GUIDE.md` — Current merchant installation order
- `docs/ghl-custom-values-reference.md` — Custom value IDs and names

## ScaleSafe Operator Skill

For merchant installation, onboarding, live operation, certification, or troubleshooting, read `.agents/skills/operate-scalesafe/SKILL.md` and only the reference file it selects. Follow its tenant boundary, approval gates, logs-first troubleshooting, and one-step-at-a-time guidance. Do not reconstruct an alternate setup process from archived specifications.

## Build & Test

```bash
npm run build          # TypeScript compile + Vite UI build
npx tsc --noEmit       # Type check only (fast)
npx jest               # Run all tests (124+ tests)
npx jest --testPathPattern=unit    # Unit tests only
npx jest --testPathPattern=integration  # Integration tests only
```

Note: `npm run build` has a known Windows issue with `mkdir -p` in the copy step. TypeScript and Vite both succeed; the final `cp` fails on Windows. This is cosmetic — the actual build artifacts are created.
