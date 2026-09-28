#!/bin/sh
set -eu
# Runs once for a new PostgreSQL volume; psql reads the password from its
# environment, never a SQL command argument or committed literal.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password TAXI_AI_APP_DATABASE_PASSWORD
SELECT format('CREATE ROLE taxi_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password') \gexec
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
