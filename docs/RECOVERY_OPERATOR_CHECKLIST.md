# ScaleSafe Recovery Operator Checklist

The recovery launch blocker closes only after both a real encrypted off-platform backup and a scratch restore pass. Script syntax and Supabase managed backups are necessary but not sufficient.

## One-Time Preparation

- [ ] Use a dedicated patched Linux recovery host with encrypted disk.
- [ ] Install Docker, Supabase CLI, PostgreSQL client, rclone, age, jq, tar, sha256sum, flock, and diff.
- [ ] Create the `scalesafe-backup` service account and locked directories from `ops/recovery/README.md`.
- [ ] Create a private S3-compatible destination in a separate account.
- [ ] Enable server-side encryption, versioning, Object Lock/equivalent immutable retention, and access logging.
- [ ] Give the destination credential List/Get/Put only; deny Delete.
- [ ] Generate the age identity offline and store two encrypted offline copies.
- [ ] Put only the age public recipient on the backup host.
- [ ] Create production Supabase database and Storage S3 source credentials for the backup host.
- [ ] Copy `ops/recovery/backup.env.example` to `/etc/scalesafe-recovery/backup.env`, fill it outside Git, and set mode `0600`.
- [ ] Confirm `BACKUP_DESTINATION_CONFIRMED_IMMUTABLE=true` only after verifying the destination policy.

## First Encrypted Backup

- [ ] Install `backup.sh`, `verify-latest.sh`, `critical-counts.sql`, and `storage-buckets.sql` under `/opt/scalesafe-recovery` using the documented ownership/modes.
- [ ] Run:

```bash
sudo -u scalesafe-backup /opt/scalesafe-recovery/backup.sh /etc/scalesafe-recovery/backup.env
```

- [ ] Record start/end time, production project reference, deployed Git SHA, schema version, snapshot ID, and operator.
- [ ] Confirm the off-site snapshot contains encrypted roles, schema, data, migration history, critical counts, Storage inventory, and Storage object archive.
- [ ] Confirm `COMPLETE.json` exists only after upload and hash verification.
- [ ] Run:

```bash
sudo -u scalesafe-backup /opt/scalesafe-recovery/verify-latest.sh /etc/scalesafe-recovery/backup.env
```

- [ ] Save the machine-readable success output and verify the snapshot is less than 30 hours old.
- [ ] Install and enable the systemd service/timer only after the manual backup passes.
- [ ] Observe one scheduled backup and save service/journal proof.

## Scratch Restore Drill

- [ ] Create a brand-new isolated Supabase scratch project in the same region.
- [ ] Do not connect Railway, GHL, Stripe, NMI, Whop, email, or production webhooks.
- [ ] Enable required Postgres extensions and create temporary scratch Storage S3 credentials.
- [ ] Copy `ops/recovery/restore.env.example` to a secure temporary file outside Git.
- [ ] Set the production and scratch project references accurately.
- [ ] Set `RESTORE_CONFIRMATION=RESTORE_TO_SCRATCH_ONLY`.
- [ ] Choose the exact completed snapshot ID from the first backup.
- [ ] Keep the age private identity only on the controlled restore workstation.
- [ ] Run:

```bash
./ops/recovery/restore-scratch.sh /secure/path/restore.env SNAPSHOT_ID
```

- [ ] Confirm the script accepted the target as scratch and found no pre-existing ScaleSafe tables.
- [ ] Confirm encrypted archive hashes match.
- [ ] Confirm critical table counts match the source manifest.
- [ ] Confirm the Storage object inventory matches.
- [ ] Query one merchant, enrollment, payment event, and connector evidence record.
- [ ] Open one restored enrollment packet PDF and one restored defense packet PDF.
- [ ] Verify sample restored file SHA-256 hashes against the snapshot manifest.
- [ ] Prove no outbound job, processor action, webhook, or GHL workflow can run in scratch.
- [ ] Record target project, start/end time, result, count comparison, sample hashes, and operator.
- [ ] Preserve the signed drill record before deleting the scratch project.

## Ongoing Operations

- [ ] Alert when the latest complete backup exceeds 30 hours.
- [ ] Review failed systemd jobs daily.
- [ ] Run a full scratch restore monthly.
- [ ] Review backup destination capacity and immutable-retention policy monthly.
- [ ] Rotate backup credentials on the approved schedule without placing them in Railway or Git.
- [ ] Never let Hermes/OpenClaw restore production, delete snapshots, change retention, or hold the offline age identity.

## Launch Blocker Closure Record

Fill this only after the real drill:

```text
Backup snapshot ID: 20260721T175646Z
Backup completed at: 2026-07-21T17:57:12Z
Schema version: 102
Source Git SHA: 67d9ea3f40d8882b0bbcd32163f0736261257597 (repository HEAD observed during closeout)
Verification result: PASS - COMPLETE.json healthy; encrypted SHA-256 manifest and off-platform download comparison passed
Scratch project reference: dcatalmzhgoxwokvxvoa (deleted after verification)
Restore started/completed: completed 2026-07-21T20:09:09Z
Database count comparison: PASS
Storage inventory comparison: PASS - 105 of 105 objects
Sample file hashes verified: PASS - full rclone download comparison plus readable enrollment and defense PDFs
Outbound integrations disabled: PASS - scratch was never connected to any application or external provider
Operator: Philip Korniotes with Codex-assisted verification
Owner approval: PASS; temporary restore credentials and scratch project deleted after proof was preserved
```

Full proof: `docs/RECOVERY_DRILL_2026-07-21.md`.
