# Tencent Lighthouse two-server pilot

This is an **invited pilot**, using two self-managed Linux servers. It does not
enable public production operation, live Paystack charges, or automatic failover.
Existing staging and scale deployments are unchanged.

## Purchase specification

Create two instances in the same Tencent Cloud international account:

| Setting | Value |
| --- | --- |
| Product | Lighthouse, General Linux bundle |
| Region | Frankfurt; measure latency from Nigerian mobile networks before launch |
| Size, each | 2 vCPUs, 8 GB RAM, 120 GB SSD |
| Published price, each | USD 14.50/month; USD 29/month for both |
| Operating system | Ubuntu Server 24.04 LTS, x86_64/amd64 |
| Availability zones | Different zones in Frankfurt, when offered |
| Names | `taxi-ai-primary`, `taxi-ai-standby` |
| Initial subscription | One month; verify price and renewal settings at checkout |
| Login | SSH key; keep the private key on your own computer |

Prices checked on 2 October 2026 in Tencent's
[pricing table](https://www.tencentcloud.com/document/product/1103/47794).
This is a monthly prepaid server bundle. Availability and the purchase-page price
must be checked before payment. Do not replace a sold-out bundle with a more
expensive one without reviewing the new total.

The USD 29 covers server rental and the bundles' transfer allowances. It does not
include taxes, a domain, independent backup storage, monitoring services, traffic
overages, maps, email/SMS, payment fees, or an optional managed traffic-failover
service. This design uses operator-controlled DNS failover; it does not require
buying a load balancer or a managed database.

## What runs on each server

| Server | Normal operation | After a controlled failover |
| --- | --- | --- |
| Primary | Caddy HTTPS gateway, API, worker, writable PostgreSQL/PostGIS | Fenced: powered off and kept isolated |
| Standby | Read-only PostgreSQL streaming replica | Promoted writable database, then gateway/API/worker |

Replication is asynchronous. An abrupt failure may lose recent writes that have
not reached the standby. Recovery includes operator response, fencing, database
promotion, certificate readiness, and DNS propagation; no recovery-time guarantee
has been established. Two servers do not supply an independent quorum for safe
automatic database promotion.

A replica copies deletions and mistakes as well as valid data. Keep independent,
encrypted off-server backups and test a restore before using real customer data.

## Before configuration

1. Record each server's public IP, private IP, instance ID, and availability zone.
   These identifiers are safe to share for deployment planning. Passwords,
   private keys, API secrets, and tester tokens must stay out of chat and Git.
2. Choose a DNS name you control, such as `staging.your-domain.com`. A bare IP
   address cannot satisfy Taxi AI's hosted HTTPS-origin checks. Domain ownership
   is required; `taxiai.com` is not assumed to be available or registered.
3. Install Docker Engine and the Compose plugin from the
   [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/)
   on both new servers. Verify `docker version` and `docker compose version`.
4. Open public TCP 80 and 443 for HTTPS issuance and web access. Restrict TCP 22
   to the operator's current public IP or an explicitly approved management
   network. Keep ports 3000 and 5432 closed to the public internet, including IPv6.
5. Allow private TCP 5432 only from the other server's private IP. PostgreSQL
   additionally requires TLS, a dedicated replication account, and a narrow
   source-address rule. Verify the source address actually seen through Docker.
   Docker-published ports may bypass UFW; use the cloud firewall and Docker-aware
   host rules, and confirm the public database port cannot be reached.
6. Put only the primary's public IP in the DNS A record. Do not publish two A
   records and treat that as health-based failover. Remove stale AAAA records.
7. Use the same application image and PostgreSQL/PostGIS image on both machines.
   Pin reviewed image digests. Keep all database and deployment secrets out of Git.

## Feature settings and release boundaries

The API and worker must receive the same protected provider configuration on both
servers: Google sign-in and native client IDs; email verification/recovery SMTP;
Expo push; dedicated maps including reverse lookup; TURN calls; optional vehicle
and driver-face checks; safety-alert gateway; staff MFA key; dispatch settings;
and Paystack **test** settings. Preserve existing credentials during migration.

Leave unconfigured providers off. Enabling an environment flag does not provision
the provider, validate its credentials, or verify external delivery. Keep rides
paused until approved pilot bounds are configured and tested. Preserve the staff
MFA encryption key across deployments and recovery.

If AWS driver-face verification is enabled, supply valid AWS credentials through
the SDK credential chain (for example, protected `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, and, when applicable, `AWS_SESSION_TOKEN` values).
Tencent instances do not automatically provide an AWS instance role.

The existing container-publishing workflow is triggered by
`integration/resolved-vscode-slider`, not automatically by every merge to `main`.
Do not assume a `ghcr.io/dax22/taxi-ai:<main-sha>` image exists. Use an actual
verified image from a successful publishing run, or build and smoke-test the
reviewed commit before choosing its image reference.

## Configure the two hosts

Run deployment commands from this directory in the reviewed repository checkout
on each host, using a root shell (`sudo -i`). Keep that checkout root-owned. Do
not run these commands over an existing database or change its credentials in
place. Migrating existing customer data requires a separate maintenance window,
verified backup, restore, and reconciliation plan.

```sh
cp .env.example .env
chmod 600 .env
install -d -m 700 secrets
```

Edit `.env` securely on each host. Set `TAXI_AI_IMAGE`,
`TAXI_AI_POSTGRES_IMAGE`, and `TAXI_AI_CADDY_IMAGE` to tested, immutable image
references. The database must be the same PostgreSQL 16/PostGIS image on both
hosts; do not change its major version during recovery. Set the real domain and
a random proxy token (`openssl rand -hex 32`), identical on both hosts. Use:

| Variable | Server A | Server B |
| --- | --- | --- |
| `TAXI_AI_DB_ROLE` | `primary` | `standby` |
| `TAXI_AI_PRIVATE_IP` | A private IP | B private IP |
| `TAXI_AI_REPLICATION_PEER_IP` | B private IP | A private IP |
| `TAXI_AI_PRIMARY_PRIVATE_IP` | A private IP | A private IP |

The Docker subnet must not overlap the cloud network, VPN, or another Docker
network. Preserve all configured provider values in `.env`; do not copy example
defaults over working settings. Leave rides paused initially.

Generate the three database passwords **once**, on A, in a fresh secrets
directory; securely copy those same three files to B. Do not regenerate them
after database initialization.

```sh
umask 077
for role in owner app replication; do
  test ! -e "secrets/postgres-$role-password" || exit 1
  openssl rand -hex 32 > "secrets/postgres-$role-password"
done
```

On a secure administration computer with OpenSSL, generate a private CA and a
separate server certificate for each host. Substitute the real private IPs and
use a new output directory outside the checkout:

```sh
sh make-replication-tls.sh /secure/new-taxi-replication-tls 10.0.0.10 10.0.0.11
```

Copy the contents of `primary/` into A's `secrets/` and `standby/` into B's
`secrets/`, over an authenticated encrypted channel. Keep the CA private key
offline; do not upload `ca/` to either server. Certificates expire after one
year, so schedule renewal before expiry.

Create the initial preview access file on A using the chosen app image (replace
the image placeholder), or securely copy the existing staging tester file:

```sh
docker run --rm --user 0 \
  --mount "type=bind,source=$PWD/secrets,target=/secrets" \
  YOUR_VERIFIED_APP_IMAGE \
  node scripts/staging-access.mjs add pilot-admin /secrets/staging-testers.json
```

Save the displayed one-time tester access key privately. It is separate from
the person's account password. Securely copy `staging-testers.json` to B. Apply
these file permissions on **both** hosts; the app image runs as UID 1000:

```sh
chown root:root secrets
chmod 700 secrets
chown root:root secrets/*
chmod 400 secrets/*
chown 1000:1000 secrets/postgres-owner-password secrets/postgres-app-password \
  secrets/staging-testers.json
docker compose --profile database --profile runtime --profile tooling config --quiet
```

Use `config --quiet`: ordinary `config` output can disclose resolved provider
secrets. Never attach the resolved configuration to an issue or chat.

## Start the pilot

On A, initialize the fresh primary and apply the application schema:

```sh
docker compose --profile database up -d postgres
docker compose --profile runtime run --rm migrate
```

On B, clone A into a fresh volume, then start only the database. The bootstrap
command intentionally refuses an existing data directory. It requires A to be
reachable on its private IP and allowed by the replication firewall rule:

```sh
docker compose --profile tooling run --rm bootstrap-replica
docker compose --profile database up -d postgres
docker compose exec -T postgres psql -U taxi_owner -d taxi_ai \
  -c 'SELECT pg_is_in_recovery();'
```

That query must return `t` on B. On A, confirm streaming replication over TLS:

```sh
docker compose exec -T postgres psql -U taxi_owner -d taxi_ai -c \
  'SELECT r.application_name, r.client_addr, r.state, r.sync_state, s.ssl,
          pg_wal_lsn_diff(pg_current_wal_lsn(), r.replay_lsn) AS replay_bytes_behind
   FROM pg_stat_replication r JOIN pg_stat_ssl s USING (pid);'
```

Require one expected peer, `streaming`, and `ssl = t`. `async` is expected.
Then start the runtime **on A only**:

```sh
docker compose --profile runtime up -d
docker compose --profile runtime ps
```

Check the runtime configuration through the deployment launcher. After the
designated staff member has registered an account, grant admin access explicitly:

```sh
docker compose exec app node /app/deploy-launch.mjs config
docker compose exec app node /app/deploy-launch.mjs admin STAFF_EMAIL_ADDRESS
```

Replace the email placeholder with the approved staff member's existing account.
Use these launcher commands instead of raw `npm run admin` or `config:check`:
the launcher reads the protected database password and verifies the writable
primary before invoking the command.

Verify HTTPS, a valid certificate, preview access, and all readiness checks
below. The gateway intentionally hides `/health/*` from the public internet;
use container health status for internal health checks. Keep B's application
image pre-pulled and provider settings current for recovery. Tester revocations
and secret rotations must be applied to the recovery copy as well.

## Readiness checks

Before inviting testers, verify HTTPS and preview access on web and two real
phones; Google login; email verification/recovery; fare suggestions and matching;
food ordering and vendor photos; courier pickup/delivery PINs; live tracking;
Kemmy updates; optional push; and test payment webhook reconciliation. Run a
restore drill and a controlled failover drill. Measure replication lag, disk
space, CPU, memory, and response latency before increasing traffic.

## Backup and failover operating rules

Take PostgreSQL backups with `pg_dump` in custom format, verify each archive with
`pg_restore --list`, and send an encrypted copy to independent storage. Keep the
application image reference, PostgreSQL image digest, secrets, staff MFA key,
tester access file, and provider settings in a separate protected recovery record.
Database backups do not contain those configuration files. A backup stored only
on the primary is lost if that server is lost.

For an example logical backup, run on the active primary from this directory.
The backup directory must exist with mode 700 and sufficient free space:

```sh
umask 077
backup_path="/root/taxi-backups/taxi-ai-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U taxi_owner -d taxi_ai -Fc > "$backup_path"
docker compose exec -T postgres pg_restore --list < "$backup_path" > /dev/null
```

An archive listing is only a format check. Encrypt and upload the archive to
independent storage, verify retrieval, and restore it into an isolated database
using the same PostGIS image. Set a backup schedule and retention policy before
inviting users; this template does not provision a backup service.

For a planned failover, first put users into maintenance and stop the active API,
worker, and gateway. Confirm the standby has replayed the primary's final WAL
position. Then stop and fence the primary before promotion. For an unplanned
failure, confirm the old primary is powered off through Tencent's console and
keep it isolated. A failed health check or an SSH timeout is insufficient proof:
the old server might still accept writes from other clients.

Record the standby's last replay position and time before promotion. Obtain an
operator decision if recent data loss is possible; reconcile active rides,
deliveries, payment records, and provider webhooks after recovery. Never promote
while the original primary can still write. Never configure both machines as
independent writable primaries.

For a planned switchover, run on A before fencing:

```sh
docker compose --profile runtime stop gateway app worker
docker compose exec -T postgres psql -U taxi_owner -d taxi_ai -At \
  -c 'SELECT pg_current_wal_lsn();'
```

Record the returned position. On B, confirm `pg_last_wal_replay_lsn()` has
reached it. For an unplanned outage that comparison may be impossible; record
the recovery point and possible loss explicitly. After the operator has
**powered off and fenced A in Tencent's console**, promote B:

```sh
docker compose exec --user postgres postgres \
  pg_ctl promote -D /var/lib/postgresql/data -w -t 30
docker compose exec -T postgres psql -U taxi_owner -d taxi_ai \
  -c 'SELECT pg_is_in_recovery(), current_setting('"'"'transaction_read_only'"'"');'
```

Require `f` and `off`. Change B's `.env` role to `primary` and primary-private-IP
to B's address before recreating any container. Keep the replication peer set to
A's address. Check the writable-primary guard, then start B's runtime:

```sh
docker compose --profile runtime run --rm --no-deps app node /app/deploy-launch.mjs check
docker compose --profile runtime up -d
```

After promotion and local runtime checks, move the one DNS A record to the new
primary. Keep the same hostname, origin, OAuth callbacks, and Paystack webhook
URL. Allow time for DNS caches and HTTPS certificate issuance. Low DNS TTL helps
but does not make failover immediate. Confirm valid HTTPS before resuming tests.

The former primary must remain isolated until it is rebuilt as a standby from
the new primary. Preserve its old data for investigation; do not automatically
erase it, boot it as a primary, or point DNS back to it. Reverse the replication
peer settings and the primary-IP mapping before establishing replication in the
opposite direction. Both generated certificates already support their host's
private IP and `taxi-db-primary`; renew or reissue them if expired or the address
changes.

Monitor replication state/lag, archive freshness, disk free space, and certificate
expiry. Retained WAL is deliberately bounded. If a disconnected standby falls
behind the retained WAL, rebuild it explicitly from a new base backup into fresh
storage; do not silently discard its existing volume.

A failed base backup can leave a replication slot on the primary. Inspect
`pg_replication_slots` and preserve the failed data directory before retrying.
Only after confirming there is no active or retained replica using that slot,
drop `taxi_lighthouse_standby` explicitly with `pg_drop_replication_slot` and
bootstrap into fresh storage. This template deliberately does not automate
destructive cleanup.

Reference documentation:

- [Tencent purchase and availability-zone selection](https://www.tencentcloud.com/document/product/1103/41404)
- [Tencent monthly billing](https://www.tencentcloud.com/document/product/1103/41403)
- [PostgreSQL 16 streaming standby](https://www.postgresql.org/docs/16/warm-standby.html)
- [PostgreSQL base backup](https://www.postgresql.org/docs/16/app-pgbasebackup.html)
