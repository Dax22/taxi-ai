#!/bin/sh
# Intentionally not executable: the upstream entrypoint sources this once on
# a NEW primary, so the sensitive initialization environment can be cleared.
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set ECHO=none --set VERBOSITY=terse <<'SQL'
\getenv app_password TAXI_AI_APP_DATABASE_PASSWORD
\getenv replication_password TAXI_AI_REPLICATION_PASSWORD
SELECT format('CREATE ROLE taxi_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE taxi_replica LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'replication_password') \gexec
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
unset TAXI_AI_APP_DATABASE_PASSWORD TAXI_AI_REPLICATION_PASSWORD
