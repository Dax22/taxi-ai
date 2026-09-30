# PostgreSQL and PostGIS storage

The web API, iOS API, Android API and standalone workers use the same asynchronous repositories. Production PostgreSQL uses `pg` connection pools and native database transactions. Local SQLite remains available for development; it is not a shared multi-replica database.

This upgrade does not establish a million-user capacity. Capacity requires load tests against the intended native PostgreSQL deployment, routing service and application replica count.

## Provisioning and roles

Use PostgreSQL 16 or newer with PostGIS 3 and `citext`. Install the extensions with an administrative deployment role if the managed provider requires it. Give the migration role ownership of the application schema. The runtime role needs schema usage, table DML and sequence usage, without superuser or schema ownership.

Set these variables in the environment or a local `.env` excluded from source control:

```dotenv
TAXI_AI_DATABASE_URL=postgresql://taxi_owner:YOUR_PASSWORD@localhost:5432/taxi_ai
TAXI_AI_DATABASE_POOL_SIZE=10
TAXI_AI_DATABASE_SCHEMA=public
```

Use the provider's verified TLS connection configuration for remote databases. The adapter preserves node-postgres TLS options and never disables certificate verification. Do not paste database URLs containing passwords into logs or support messages.

Apply migrations once with the migration role:

```bash
npm run db:postgres:migrate -- --grant-app-role taxi_app
```

The optional role must already exist. The command grants schema usage, DML on application tables, sequence access and equivalent default privileges for subsequent objects. It protects the schema migration ledger from runtime writes. Switch `TAXI_AI_DATABASE_URL` to the `taxi_app` role before starting web replicas and workers.

Normal startup verifies the schema version; it does not create extensions or silently upgrade production tables. PostgreSQL migration files have their own version ledger and SHA-256 checksums. Applied files must not be edited; add a new migration for later schema changes.

The initial native PostgreSQL migrations cover the canonical SQLite schema through version 30, including rides, Eats, account security, notifications, experimental safety monitoring, dispatch, event cursors and worker leases.

## Transfer an existing SQLite database

Schedule a maintenance window and stop all processes writing the SQLite database. Make a backup using the existing `npm run backup -- /absolute/path/snapshot.sqlite` command. Keep the original database and backup available until verification is complete.

The import source must already match this release's SQLite schema. For an older backup, upgrade a separate working copy with this release before importing; do not modify the only backup. Import into an empty, migrated PostgreSQL application schema using the migration role:

```bash
npm run db:postgres:import -- /absolute/path/current-snapshot.sqlite
```

The importer opens SQLite read-only and holds a consistent source snapshot. It validates SQLite integrity and foreign keys, hashes the source records, copies bounded pages with bound parameters, validates PostgreSQL foreign keys and compares table row counts. It preserves credentials, binary document/photo bytes, money amounts, IDs and sequence positions. Guest link ordering is preserved. Active worker leases expire on transfer so an old process cannot retain ownership.

The target import is one transaction: an interruption rolls it back. Rerunning the identical completed source reports that it was already imported. Importing a different source into a populated target fails rather than overwriting application records. Event triggers may advance account invalidation cursors during transfer; those cursors contain no event payload and never move backward.

After importing, verify authentication, a complete ride, Eats ordering and administrative reporting before sending live traffic to the PostgreSQL deployment. Keep PostgreSQL backups and restoration procedures separate from the SQLite snapshot commands. Use provider snapshots or `pg_dump`/`pg_restore`, including the extension requirements, and exercise restoration into a separate database.

## Runtime behavior

- Every unit of work pins a pool connection across asynchronous calls. Serializable transactions retry serialization failures and deadlocks up to three times; transaction callbacks must contain retry-safe database work. Provider calls belong outside the retrying transaction or behind durable, idempotent jobs.
- Nested transactions use savepoints. Completed asynchronous contexts cannot keep using a released transaction connection.
- Pool size defaults to 10 per process. Allocate the total connection budget across **all** web replicas, worker processes and administrative connections. Query execution, lock acquisition, connection acquisition and idle transactions have timeouts; queued acquisitions are bounded.
- Account invalidation cursors are maintained by native PostgreSQL triggers in the same transaction as domain changes. They are scoped to the affected accounts and contain no message or location payload.
- Driver locations and Eats collection locations have generated PostGIS geography columns and GiST indexes. Driver candidate queries use `ST_DWithin`; the existing shared distance rule remains the final eligibility check. Expired positions are excluded, and stopping availability clears both coordinates and the generated location.
- Small reporting values, epoch milliseconds and money cross the repository boundary as checked JavaScript numbers. Database integers or aggregates beyond JavaScript's safe range fail explicitly instead of silently losing precision.

The SQL adapter supports the repository's audited portable SQL subset: parameter binding, camelCase result names, JSON extraction, conflict handling, boolean aggregates and generated IDs. PostgreSQL DDL is explicit native SQL, not runtime translation of SQLite migrations. New repository SQL must be verified against both databases.

## Verification

Provide an isolated test database whose role can create and drop test schemas:

```bash
TAXI_AI_TEST_POSTGRES_URL=postgresql://test_owner:YOUR_PASSWORD@localhost:5432/taxi_ai_test \
  node --experimental-sqlite --test --test-concurrency=1 \
  services/api/test/postgres.test.mjs services/api/test/postgres-import.test.mjs \
  services/api/test/postgres-http.test.mjs
```

Each test creates a unique schema and drops that schema on completion. The live tests skip when `TAXI_AI_TEST_POSTGRES_URL` is absent. Ordinary `npm test` also runs the SQL binding and conversion tests.

Development verification can exercise the real PostgreSQL SQL engine and PostGIS through the experimental PGlite wire-protocol harness when a native server is unavailable. Its single backend does **not** validate independent PostgreSQL sessions, native connection-pool contention, failover, multi-process locking or production capacity. Run the live suite and replica/worker contention tests against native PostgreSQL before deployment; follow [the scaling runbook](scalability.md) for controlled load scenarios and capacity measurements.

### Required native database gate

Run `TAXI_AI_TEST_POSTGRES_URL=postgresql://test_role:TEST_PASSWORD@127.0.0.1:5432/taxi_ai_test npm run test:postgres`
against a disposable native PostgreSQL 16+/PostGIS database. This command fails
before testing if the URL is absent, the database is not a loopback test/load
database, or two independent backend sessions cannot be established. It runs every
PostgreSQL suite, including intentional multi-pool dispatch conflicts and lease
fencing. The default `npm test` still permits local database suites to skip, but CI
runs the dedicated native job on every pull request. See `docs/scalability.md` for
the separate two-API/two-worker matching benchmark and profiling controls.
