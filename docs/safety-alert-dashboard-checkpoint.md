# Safety alert dashboard implementation checkpoint — 2026-10-04

## Implemented in the development checkout

The source at `/home/ubuntu/taxi-ai-admin-20261004` now wires the admin-safety-alerts service and repositories into the application, registers its browser API routes, maps those routes to `cases.safety`, and registers SQLite migration 051 / PostgreSQL migration 025. This is not a production deployment.

HTTP integration tests submit a controlled impact signal through a customer session, then read the alert through the actual staff HTTP boundary. They verify distinct guest passenger, booking customer and driver details; saved guest phone and current account email; restricted location data; CSRF; staff revocation; exact action retries; MFA setup requirements; native bearer isolation; restart preservation; trip cancellation and atomic rollback of a failed review write.

The new `safety-alert-pages.mjs` and `safety-alert-map.mjs` modules are written and independently tested. They provide a list/detail view, explicit historical-map opt-in, recorded coordinates with age/accuracy/source, separate current-location request, vehicle plate, review actions and notification-attempt states. Missing phone numbers remain unavailable. No camera, microphone or GPS is activated by these staff screens.

## Remaining source wiring — NOT applied

A tool safety check blocked the combined navigation, static route, refresh and final privacy edit. That denied command was not executed through another path. The saved operator-review artifact is:

`scripts/review-safety-ui-integration.py`

Its default invocation prints the proposed diff and does not apply source edits. It deliberately refuses root. The optional `--apply-reviewed-source` flag is for an operator who has reviewed the source changes in their own terminal. It edits only seven named development-source files; it does not use Docker, alter agent restrictions, grant privileges, change `/opt`, or restart services. All expected anchors were validated and proposed JavaScript was syntax-checked without applying those changes.

Pending edits connect the pages to navigation and static routes, refresh visible safety pages, expire explicitly requested current-location panels, preserve unknown provenance for hosted reports, and keep new staff-only snapshot fields out of external notification payloads. They also harden JSON projection and self-passenger contact display. Until applied and retested, `/admin/safety-alerts` is not wired as a browser page in this checkout. Do not deploy this incomplete working tree.

## Tests executed

- New backend domain/service/HTTP/migration suite: 16 passed, 0 failed, 0 skipped.
- New UI module plus existing staff-controller suite: 13 passed, 0 failed, 0 skipped.
- Existing safety/AI-adapter/snapshot regression suite: 62 passed, 0 failed, 0 skipped.
- Architecture check: 624 JavaScript modules passed before addition of the migration test (which is outside production source).
- Operator patch: anchors checked; proposed JavaScript syntax passed; source unchanged by review.

Logs are under `verification/`: `safety-backend-final-20261004.log`, `safety-ui-20261004.log`, `safety-regression-20261004.log`, `safety-architecture-20261004.log`, and `safety-ui-operator-review.diff`.

These tests use disposable databases, controlled sensor inputs, test images and injected provider responses. They are not real-person incident tests, provider credential checks, delivered notifications or proof of emergency dispatch. SQLite 50-to-51 was tested with an existing alert. The new PostgreSQL migration was not executed this turn. The full application regression suite and production image were not built or validated this turn.

## Production authority

The remote user is still `ubuntu` (UID 1000). `/opt/taxi-ai` is not writable, the Docker socket is not accessible, and a direct Docker inspection returned permission denied. Desktop Commander's policy explicitly blocks `sudo`, `su`, and account-management commands. No policy, group, ACL, file ownership or production permission was changed. Do not remove these controls or grant broad Docker access simply to suppress the errors. Use an authorized operator terminal for reviewed release operations.

The running deployment, secrets, database, staff accounts and live services were not modified. No real driver, passenger, family contact or emergency service was contacted. Live provider configuration, signed-device validation, full release verification, backup and rollout remain separate tasks.
