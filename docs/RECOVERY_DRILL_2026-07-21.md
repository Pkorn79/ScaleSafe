# ScaleSafe Recovery Drill - 2026-07-21

## Result

**PASS.** ScaleSafe completed a real encrypted off-platform backup and restored that exact snapshot into an isolated Supabase scratch project. Database counts, Storage inventory, encrypted archive hashes, and representative private PDFs were verified.

## Backup Proof

- Snapshot ID: `20260721T175646Z`
- Completed: `2026-07-21T17:57:12Z`
- Source schema version: `102`
- Off-platform destination: private Backblaze B2 bucket `scalesafe-recovery-pk-2026`
- Protection: age encryption, B2 server-side encryption, 90-day Object Lock retention, and whole-bucket lifecycle cleanup after the retention window
- Completion marker: present and healthy
- Storage captured: `105` objects, `21,011,034` bytes
- Verification: encrypted archive SHA-256 manifest passed and off-platform download comparison passed
- Automated schedule: `scalesafe-backup.timer` enabled and a systemd-run backup completed successfully
- Repository HEAD observed during closeout: `67d9ea3f40d8882b0bbcd32163f0736261257597`

## Restore Proof

- Scratch project: `ScaleSafe Restore Test`
- Scratch project reference: `dcatalmzhgoxwokvxvoa`
- Restore completed: `2026-07-21T20:09:09Z`
- Restore command result: `RESTORE VERIFIED`
- Restored schema version: `102`
- Critical table counts:
  - `defense_packets`: `16`
  - `enrollment_packets`: `0`
  - `enrollments`: `173`
  - `external_evidence_events`: `1`
  - `merchants`: `3`
  - `payment_events`: `325`
- Restored Storage:
  - `scalesafe-files`: `43` objects
  - `scalesafe-private-files`: `61` objects
  - `scalesafe-public-assets`: `1` object
  - Total: `105` objects
- Content verification: `rclone check --download` reported no differences for every restored bucket, and the complete object inventory matched the source archive.

## Manual Verification

- Queried one merchant, enrollment, payment event, and published connector-evidence record successfully.
- Opened and rendered a restored five-page defense packet PDF from `scalesafe-private-files`.
- Opened and rendered a restored two-page enrollment packet PDF from `scalesafe-private-files`.
- The scratch project was never connected to Railway, GHL, Stripe, NMI, Whop, email, or production webhooks. No application worker or outbound integration was pointed at it.

## Operators

- Owner/operator: Philip Korniotes
- Assisted verification: Codex

## Closeout

The recovery launch blocker is closed. The protected VPS restore credential file was shredded and the temporary scratch project was permanently deleted at `2026-07-21T20:24:42Z`. Its temporary database credentials, Storage credentials, and signed file links are no longer usable. The production backup timer and encrypted B2 retention remain in service.
