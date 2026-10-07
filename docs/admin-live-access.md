# Taxi Ai Operations access and remaining operator gates

## Verified public entry

The existing operations login is `https://taxiai.app/admin`. The live HTML contains the separate staff login form and MFA screen. The admin page, stylesheet and sampled login/controller modules returned HTTP 200. Anonymous requests to `/api/admin/console/session` and `/api/admin/console/accounts` returned HTTP 401 with `UNAUTHENTICATED`. These are anonymous delivery/access checks, not proof of a successful administrator login or a full security audit.

The application serves `apps/admin/public` through the existing web server. It is a separate frontend module, not currently a separate staff origin or cookie audience. A staff login must use an existing appropriately authorized account. The earlier `taxi-admin@example.test` identity was a development identity; its presence in the live database remains unverified. Do not promote an existing driver/customer account to bypass staff setup.

Use a separate browser profile for operations while testing customer and driver sessions, because the current implementation shares the web session. Never send passwords, authenticator codes, setup keys, recovery keys or cookies in chat.

## Recommended production target

Keep the existing URL for access now. A future dedicated `admin.taxiai.app` hostname requires a coordinated gateway, host/origin validation and staff-session design; a DNS record or cosmetic redirect alone does not provide isolation. Keep the public customer origin and a staff-only API entry distinct, while using the same authoritative backend services/database. Do not expose the database to the browser or open the application container port publicly.

Require staff MFA, least-privilege roles, short-lived privileged verification, revocation, request-level permissions, CSRF protection and protected audit records. Configure the existing persistent MFA encryption key before enforcing MFA. Never rotate an existing key casually: enrolled factors depend on it.

Official design references:
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://docs.docker.com/engine/install/linux-postinstall/

## Read-only release inventory

The current remote account still cannot write `/opt/taxi-ai`, read the production `.env`, or access Docker. Do not weaken file permissions or expose Docker to remove that restriction. An authorized operator can run the existing exporter from their own server terminal:

```bash
sudo python3 /home/ubuntu/taxi-ai-tracking-hardening-20261003/scripts/export-live-release.py --output /home/ubuntu/taxi-ai-live-review-20261003
```

It refuses an existing destination. It exports allowlisted source and aggregate database counts, not environment files or database records. The inventory now includes administrator-account counts, active Owner counts, Owner MFA enrollment counts, MFA configuration presence/syntax, missing SMTP setting names, and map-endpoint configuration presence. It does not print SMTP usernames/passwords, MFA keys, map credentials, account names or emails. Missing tables yield unknown counts rather than an invented zero. All database inspection uses read-only transactions.

This export is a diagnostic prerequisite. It neither grants deployment permissions nor changes live services. Integration must preserve live-only changes and use the correct source, image and database migration lineage. Authenticated browser testing follows identification of the real administrator account; the exporter does not create/reset it.

## Other owner-controlled gates

Email delivery requires private provider authentication and received-message verification, separately for account email and contact email. The live contact API still reported disabled during this check.

Signed native builds require the correct Expo project/account and platform signing/provisioning; the remote environment currently has no saved Expo login or Expo token. Domain/map-provider billing, credentials, capacity, and actual signed-device delivery acceptance are not established by setting an environment flag. Keep the release acceptance record pending until each test has real reviewed evidence.

The new inventory is tested with disposable SQLite and mocked PostgreSQL query results. It has not yet run against production, and its aggregate counts cannot establish a successful staff login or a functioning MFA device.
