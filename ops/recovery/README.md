# ScaleSafe Recovery Toolkit

This package implements the deterministic part of ScaleSafe disaster recovery. It is designed for the separate Linux VPS or command-center host, not Railway and not a merchant sub-account.

Nothing here restores, deletes, rotates, or changes production automatically.

## Recovery Layers

1. **Supabase managed backup:** Pro provides one database backup per day with seven days of retention.
2. **Independent daily snapshot:** `backup.sh` exports roles, schema, data, migration history, critical row counts, bucket metadata, and every private Storage object.
3. **Public-key encryption:** the backup host receives only an `age` public recipient. The private recovery identity stays offline.
4. **Immutable off-site copy:** encrypted archives go to a separate S3-compatible account with versioning and Object Lock or equivalent retention protection.
5. **Scratch restore proof:** `restore-scratch.sh` refuses the production project reference, requires a blank project, verifies hashes, restores the database and files, and compares critical counts and object inventories.

Supabase database backups contain Storage metadata but not the underlying files. Supabase Storage also does not provide object versioning. The separate Storage archive is therefore required, not optional.

Official references:

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase Storage S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)
- [Supabase Storage object downloads](https://supabase.com/docs/guides/storage/management/download-objects)

## Beta Recovery Objective

- Recovery point objective: no more than 24 hours of data loss.
- Recovery time objective: restore a usable scratch environment within eight hours.
- Backup cadence: daily off-platform snapshot plus Supabase managed daily backup.
- Health threshold: alert when the latest complete off-platform snapshot is more than 30 hours old.
- Restore testing: one full drill before the first real beta merchant, then monthly.

Do not close the recovery launch finding merely because the timer is installed. It closes only after a complete snapshot and a scratch restore are both proven.

## What Is Backed Up

The database archive contains:

- Supabase role, schema, and data dumps.
- Supabase migration history dumps.
- The ScaleSafe schema version.
- Critical table counts for payments, enrollments, evidence, defense, triggers, and connector intake.
- Storage bucket definitions and source object inventory.
- The deployed Git SHA when supplied.

The Storage archive contains every object visible through the production Supabase S3 endpoint, including enrollment packets, defense packets, evidence files, logos, and other private artifacts.

## Security Boundaries

- Never place backup or restore credentials in Railway.
- Never commit `backup.env`, `restore.env`, an age identity, or an rclone credential file.
- The backup VPS receives the age public recipient only.
- Keep the age private identity in two offline encrypted locations.
- Give the destination credential List, Get, and Put access but deny Delete. Enable bucket versioning and Object Lock or the provider equivalent.
- Use a different cloud account for the destination when practical.
- Restrict `/etc/scalesafe-recovery/backup.env` and the service user's rclone configuration to mode `0600`.
- A snapshot is valid only when `COMPLETE.json` exists. The backup writes it after encrypted archives upload and verify.
- The scripts never prune backups. Retention changes and deletion remain owner-approved operations.

## Host Prerequisites

Use a dedicated, patched Linux host with an encrypted disk. Install:

- Docker Engine
- Supabase CLI
- PostgreSQL client (`psql`)
- `rclone`
- `age`
- `jq`
- standard GNU tools (`tar`, `sha256sum`, `flock`, `diff`)

The host needs protected free disk space a little greater than twice the current Storage size because files are staged only long enough to create the public-key encrypted archive. `BACKUP_MAX_LOCAL_GB` deliberately stops the job before the original full-snapshot design outgrows the host. Replace it with a chunked/incremental design before raising that limit materially.

## One-Time Owner Setup

### 1. Create the destination

Create a private S3-compatible bucket in a separate account. Enable:

- Server-side encryption.
- Versioning.
- Object Lock or equivalent immutable retention.
- Access logging.
- A lifecycle appropriate for payment and dispute evidence. A reasonable beta starting point is 90 daily snapshots, with longer monthly archives retained separately.

Configure an rclone remote for the destination as the `scalesafe-backup` Linux user. The example expects `offsite:scalesafe-production`.

### 2. Create the offline age identity

Run this on the offline recovery workstation, not the VPS:

```bash
age-keygen -o scalesafe-age-identity.txt
age-keygen -y scalesafe-age-identity.txt
```

Store the identity offline. Put only the printed `age1...` public recipient into `backup.env`.

### 3. Create Supabase source credentials

In Supabase:

1. Open **Storage > Configuration > S3**.
2. Enable the S3 protocol.
3. Generate a server-side access key and secret.
4. Record the direct Storage endpoint and region.
5. Open **Connect** and copy the Session pooler database URL, using the rotated database password.

These credentials bypass Storage RLS and belong only on the protected backup host.

### 4. Install the package

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin scalesafe-backup
sudo usermod -aG docker scalesafe-backup
sudo install -d -m 0700 -o scalesafe-backup -g scalesafe-backup /opt/scalesafe-recovery
sudo install -d -m 0700 -o scalesafe-backup -g scalesafe-backup /etc/scalesafe-recovery
sudo install -d -m 0700 -o scalesafe-backup -g scalesafe-backup /var/lib/scalesafe-recovery
sudo install -m 0750 -o scalesafe-backup -g scalesafe-backup backup.sh verify-latest.sh /opt/scalesafe-recovery/
sudo install -m 0640 -o scalesafe-backup -g scalesafe-backup critical-counts.sql storage-buckets.sql /opt/scalesafe-recovery/
sudo install -m 0600 -o scalesafe-backup -g scalesafe-backup backup.env.example /etc/scalesafe-recovery/backup.env
```

Populate `/etc/scalesafe-recovery/backup.env`, then set `BACKUP_DESTINATION_CONFIRMED_IMMUTABLE=true` only after verifying the destination policy.

### 5. Run and verify the first backup

```bash
sudo -u scalesafe-backup /opt/scalesafe-recovery/backup.sh /etc/scalesafe-recovery/backup.env
sudo -u scalesafe-backup /opt/scalesafe-recovery/verify-latest.sh /etc/scalesafe-recovery/backup.env
```

The second command returns machine-readable JSON. A nonzero exit means the backup is absent, incomplete, or stale.

### 6. Enable the timer

```bash
sudo install -m 0644 systemd/scalesafe-backup.service systemd/scalesafe-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scalesafe-backup.timer
systemctl list-timers scalesafe-backup.timer
```

Review the first scheduled run:

```bash
systemctl status scalesafe-backup.service
journalctl -u scalesafe-backup.service --since yesterday
```

## Scratch Restore Drill

Run restores from the recovery workstation that holds the age identity, not from the automated backup VPS.

1. Create a brand-new Supabase scratch project in the same region.
2. Do not connect Railway, GHL, Stripe, NMI, Whop, email, or production webhooks to it.
3. Enable the same non-default Postgres extensions used by production.
4. Generate temporary scratch Storage S3 credentials.
5. Copy `restore.env.example` to a temporary `restore.env` and fill it in.
6. Set `RESTORE_CONFIRMATION=RESTORE_TO_SCRATCH_ONLY`.
7. Choose an explicit completed snapshot ID from the backup destination.
8. Run:

```bash
./restore-scratch.sh /secure/path/restore.env 20260714T031700Z
```

The script refuses to run when:

- The target project reference equals production.
- The target database URL contains the production reference.
- The scratch database already contains ScaleSafe tables.
- The snapshot has no completion marker.
- Any encrypted archive hash differs.
- Critical table counts or Storage inventories differ after restore.

After the script passes, manually verify in the isolated scratch project:

- A merchant and enrollment can be queried.
- A payment event links to the correct enrollment.
- A signed enrollment packet downloads and its PDF opens.
- A defense packet downloads and its PDF opens.
- One connector evidence row links to the expected enrollment.
- No outbound job, processor action, or GHL workflow can run.

Record the snapshot ID, source schema version, target project reference, start/end time, count verification, sample file hashes, tester, and result. Delete the scratch project only after the proof is retained.

## Guardian Integration

Guardian never calls `verify-latest.sh` and never reads `backup.env`. The
`scalesafe-backup` identity runs the verifier and publishes a strict, hashed,
sanitized document into `/var/lib/scalesafe-backup-status`. Guardian receives
group read access only.

Human restore proof is written separately to the root-owned
`/var/lib/scalesafe-restore-proof` drop. The backup identity cannot read,
replace, or fabricate that proof.

`install-guardian-status-bridge-disabled.sh` copies the status writers and
disabled status units without changing the active backup service or timer.
It refuses an existing enabled unit before its first installation write.
`audit-guardian-status-bridge-disabled.sh` verifies that the active service
still invokes the original `backup.sh`, the status units remain disabled, and
Guardian cannot access recovery credentials or tooling.
An unhealthy or rejected backup verification publishes a failed status and
returns nonzero to the backup wrapper.

The network-facing Backblaze check runs separately as
`scalesafe-guardian-b2`. It uses a key restricted to the single recovery bucket
with exactly `listFiles`, `readFiles`, and `readFileRetentions`; downloads and
hashes only encrypted archives; and cannot decrypt, write, delete, or alter
retention.

OpenClaw receives only sanitized incident envelopes after deterministic
Guardian checks fail. It cannot invoke backup or restore tooling.

## Incident Choice

- **Bad deployment, no data loss:** redeploy or roll back Railway; do not restore data.
- **Recent database mutation:** use the closest Supabase managed restore point and account for downtime.
- **Deleted Storage object:** recover the object from the encrypted off-platform snapshot; a database restore alone cannot recover it.
- **Supabase project/account compromise:** create a clean project and use the off-platform database plus Storage restore.
- **Unknown compromise scope:** preserve logs and snapshots first; do not overwrite production until incident scope is understood.
