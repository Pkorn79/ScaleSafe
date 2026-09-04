# Phase 3.4 External Certification Report

**Status:** Passed in an isolated environment. Production is not authorized.

**Owner authorization:** 2026-07-31, "ok, go" for the prepared external
certification runbook.

## Frozen Candidate

- ScaleSafe branch: `codex/beta-remediation`
- ScaleSafe candidate: `7b818e38472604cf72563a051bf3f1612841bf58`
- Guardian branch: `codex/phase3-independent-alerting-prep`
- Guardian pre-remediation candidate:
  `8047161846eb6e9b94c6d9092d22281d76b9ece1`
- Guardian final reviewed commit:
  `d6a2b0103bc3730ff2a48641bde53e6f3a7e6d85`
- ScaleSafe archive SHA-256:
  `CEA27092B7C84CF48B05E795CE7D7E789A9762D64FCC2B5C7200F6DDA80D0E6E`
- Guardian pre-remediation archive SHA-256:
  `741D283193BDDBC86EC632CACE3D10145893A933D75A2572E5D860EFDA662049`
- Migration 105 SHA-256:
  `7C7E1642215AFFD4D4B55DFEE79D4E80DB04D8DC419747CE97B8699875CC4210`

The shared protocol-v1 files were byte-identical at freeze. Their SHA-256
values were:

| File | SHA-256 |
|---|---|
| `alert-delivery.schema.json` | `9909485DD8608CEDE16C1ED40100C5180F710018EAB9839D701F9CAC1B28E015` |
| `error-response.schema.json` | `D548413AE0A37F5A6049F2CCD9C71D9550639979F4F08D5E88C3AA3D8C67D709` |
| `ingestion-response.schema.json` | `F9DE57BE4A9DEBDEECA135B0A54F1C4D1C465F6C0C68FB5D4A73782DA0FBA6C5` |
| `README.md` | `D74DA1F925A3C6CD78BC02CF8D17B0A67682D02C950C67DE701BCCDD0246B44A` |
| `recovery-verification.schema.json` | `72E7DCB7FC3310CC85E40446E76C48AFAE4F1286F4D9BA9844DC62845F8A7316` |
| `run.schema.json` | `F907A174B4D1EA54496B035E094D8990A1609810992C40FEA855B706CE47BA52` |
| `snapshot.schema.json` | `E4260CA28F8AE31A2A5A40883004F258F126BA7B54DE09304F88C64E97E3016F` |
| `test-vectors.json` | `138EF5B614CF5873F4E13B6DE89DC777E3AB000DF4B7B51EFEF0E8D791C47270` |

## Local Gates

- Guardian: 94 of 94 tests passed.
- ScaleSafe focused Guardian contracts: 74 of 74 tests passed.
- ScaleSafe full regression: 1,614 of 1,614 tests passed across 196 suites.
- TypeScript typecheck and production build passed.
- `npm audit --omit=dev`: zero ScaleSafe production vulnerabilities.
- Both candidates passed staged `git diff --check`.
- Fable follow-up verdict: **CLOSED (code-side)** with no new reachable P0/P1.

## Disposable Database Gate

**Passed.** The exact archived candidate was exercised against the isolated,
loopback-only Supabase PostgreSQL workspace at schema 104.

- All 16 protocol/database vectors passed, including exact retry, logical
  duplicate, sequence conflict, rate-limit, tenant-selector, and notification
  proof cases.
- The first deep verifier run against predecessor candidate `28dc04c` correctly
  failed on an invalid verifier fixture: a `/runs` receipt claimed zero accepted
  observations, which migration 105's constraint rejects. The transaction was
  rolled back; the database remained schema 104 and no migration-105 table
  persisted. Failed log SHA-256:
  `176FE4AB5852FACC86A8B93C09490BCF58214144A869498C04EA5165F0DA0FC5`.
- Follow-up commit `7b818e3` changes only that fixture from `0` to `1` and adds
  a regression assertion tied to its logical ID. The full test, typecheck, and
  build gates passed again before a new archive was created.
- The corrected deep verifier returned
  `MIGRATION_105_BEHAVIOR_VERIFIED` at schema 105 inside the transaction, then
  explicitly rolled back. The post-check returned schema 104 and
  `guardian_ingestion_receipts = absent`.
- Passing log SHA-256:
  `474CE3809DCDA341A8CE1090F315725F6CBFF2BFB5E322FBFE41A250648EC722`.

## Provider Gate

**Passed after one bounded remediation.** The certification used the isolated
ScaleSafe app and loopback-only schema-104 database. No production ScaleSafe
route, tenant, migration, or Railway service was used.

- Better Stack accepted the clean-run heartbeat during the approved provider
  window. Its certification heartbeat remains paused after testing.
- GHL accepted sanitized warning and critical envelopes. Warning routed to
  email; critical routed to email and SMS.
- The first concurrent test exposed a real workflow limitation: a second event
  for the shared operational contact could be skipped while the first workflow
  execution remained active.
- Guardian now applies a configurable, bounded five-second delay between alert
  handoffs in the same run. The change is limited to six runtime/config/test
  files plus two supporting documentation files and rejects values outside zero
  through 60 seconds.
- The corrected candidate passed 95 of 95 Guardian tests locally and on the VPS.
- SHA-256 comparison confirmed that all six executed runtime/config/test files
  on the paced VPS candidate were byte-identical to the final reviewed commit.
- The paced live run accepted three alerts with no retry, uncertainty, or
  failure: one warning and two critical alerts. The owner confirmed all three
  emails and both required SMS messages.
- Five recipient proofs were recorded through the proof recorder. Only hashed
  provider references were retained; no recipient address, phone number, or
  message body was stored.

The extra critical alert was legitimate operational evidence, not a delivery
defect. The daily encrypted backup was healthy, but its sanitized status file
had exceeded Guardian's two-hour freshness budget.

## Reconciliation And Action-Denial Gate

**Passed.**

- All three accepted delivery transitions advanced to `notified` only after the
  required recipient-channel proofs existed.
- A follow-up run kept the known incident open without sending duplicate email
  or SMS.
- The backup-status bridge was enabled with explicit owner approval. It runs as
  the restricted `scalesafe-backup` user every 30 minutes and only refreshes the
  sanitized status document.
- The bridge completed successfully and the next Guardian run reported all 11
  observations healthy, zero anomalies, zero new incidents, and zero delivery
  attempts.
- `scalesafe-guardian.timer` and
  `scalesafe-guardian-openclaw.timer` remained disabled and inactive throughout.
- No repair executor or production mutation path was enabled.

## Closeout

Phase 3.4's isolated external-provider, recipient-delivery, deduplication,
reconciliation, recovery-status, and action-denial gates are complete. Fable's
independent read-only review returned **PASS WITH NON-BLOCKING NOTES**, with no
P0 or P1 findings. Its two documentation notes were corrected before the
Guardian branch commit was created.

Migration 105 remains unapplied in production. No Railway deployment,
production flag, recurring Guardian/OpenClaw timer, `main` merge, or push is
authorized.
