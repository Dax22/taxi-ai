# Tracking release: operational handoff

## Status

This workspace is a development snapshot plus reviewed changes, NOT the proven live backend source. Do not deploy the entire snapshot over production. Neither source review nor an additive migration grants permission to interrupt active trips.

The isolated native PostgreSQL/PostGIS suite now runs through a private, same-user socket without Docker or production credentials. The added v20-to-v21 test preserves a synthetic in-progress trip and an accepted legacy invitation; it does not invent email verification. Run it on the production PostgreSQL major version as well once that version is established. This is not a rehearsal on a copy of the actual production dataset.

## 1. Obtain the real deployed source without broadening agent privileges

An operator with existing Docker access runs the following read-only exporter in the Tencent terminal. The output path must not already exist:

```bash
sudo python3 /home/ubuntu/taxi-ai-tracking-hardening-20261003/scripts/export-live-release.py \
  --output /home/ubuntu/taxi-ai-live-review-20261003
```

It reads the running container image identity, allowlisted text source, schema version, aggregate active-trip/legacy-invitation counts, and non-secret mode flags. It excludes environment files, database rows, tokens and credential values from the export. Source stays on the same server. The operator should review source for hardcoded secrets before any separate external sharing. It does not restart or recreate containers, grant Docker permissions, migrate data, send invitations, or modify accounts. It changes ownership only on its newly created export so the invoking owner can inspect it.

Then use:

```bash
python3 scripts/reconcile-live-release.py --export /home/ubuntu/taxi-ai-live-review-20261003
```

This reports changed-file conflicts and other live-only fixes that must be preserved. An absent image revision label is not a reason to guess a Git commit: the image ID and source-file digests identify the inspected runtime. A clean comparison is NOT a completed integration or deploy authorization. Resolve conflicts onto an exact live-source worktree; preserve public registration, proxy handling, persistence and provider configuration. Review the resulting diff and rerun tests against that integrated candidate.

## 2. Coordinate invitation and client transition

The server returns `INVALID_CLIENT_VERSION` with an explicit update/current-website instruction when an old client omits `recipientEmail`. It never falls back to first-claimant access.

Before cutover, inspect active trips and parcels using `scripts/tracking-transition-audit.mjs` against the established database with existing read-only operator access. It prints aggregate counts only. Do not revoke invitations, mark emails verified, or cancel deliveries automatically. Drain active jobs, confirm mailbox verification works, distribute the compatible signed native builds, and communicate that new invitations require the intended verified email. Recheck after writes are paused in the approved maintenance window; an audit while bookings remain open is only a point-in-time observation.

The exporter cannot pause bookings. A maintenance/drain mechanism must be verified on the actual live deployment before proceeding. Keep the previous runtime and a verified recovery backup. Apply migrations through the established migration role only after testing the integrated candidate. No rollback should discard newly written delivery evidence.

Existing completed legacy invitations cannot be replaced by the normal terminal-delivery API. Explain their changed recipient-history access and offer a reviewed support recovery process; do not fabricate recipient-email bindings. The new migration deliberately leaves historical grant records intact rather than silently deleting them.

## 3. Signed devices and controlled delivery

`apps/mobile/eas.json` already defines an internal preview profile. EAS account authentication, project identity, existing signing credentials and registered iOS devices must be established before requesting signed builds. Do not create a replacement signing identity for an already released app. Do not upload the snapshot workspace merely because a bundle export passed; build from the integrated release candidate.

Use distinct sender, courier and verified-recipient accounts, plus an unrelated account, on a controlled delivery. Confirm changing real GPS, locked-screen operation on Android and iOS, short-connection recovery, permission removal, invitation replacement, incorrect/correct handover codes and tracking termination. The driver must remain stationary for phone interactions or use a separate observer. Record exact build IDs and backend image identity. No real delivery, real payment or physical-device pass should be inferred from synthetic tests.

## 4. Maps and communications

Inspect actual deployed map mode and explicit search/routing/tile endpoints privately. Verify provider quotas, geographic coverage, availability and accepted traffic levels before load testing. GPS writes go to Taxi Ai; they are not map-route requests. Do not load-test public community endpoints or relabel them dedicated. Do not purchase a service or increase a paid plan without an approved provider and budget. Map-provider throughput remains unverified until measured against provisioned endpoints.

Account-verification mail and contact-form mail have separate configuration. Confirm receipt in each actual inbox. The tracking release does not activate SMTP or supply credentials. Keep deployment configuration and app-password entry in the operator's private terminal.

## Evidence

`verification/postgres-acceptance-final.log` records the native database suite, including the new populated-upgrade test. `verification/release-tools-tests.log` records exporter/reconciliation safeguards. `verification/runtime-export-attempt.log` records the currently denied Docker read. `verification/eas-account-check.log` records the EAS authentication check. Full root-suite results are in `verification/release-regression.log`.

The committed acceptance template remains pending. Populate it only with observed, reviewed results for the exact integrated release; no script may turn a missing device, provider, inbox or deployment check into a pass.
