# Email verification and password recovery

Release **0.20.0**, mobile **0.4.0**, schema **15**.

Customers and drivers can request a password reset from **Forgot password?** on
web or mobile. Account settings show mailbox verification and provide a resend
button. Email/password registration queues verification when delivery is enabled.
Google-only accounts can verify their contact email from account settings; they
continue to sign in through Google. Matching an email never creates a password
or connects an external identity.

Email delivery is **off by default**. This release does not configure a sender,
send test emails, create cloud resources or deploy the app. Existing preview
accounts remain usable without mailbox verification. This is not identity, phone,
licence or driver verification, and it is not a gate for real-service launch.

## Configure your sender later

The SMTP adapter is independent of the hosting platform, so the planned Alibaba
hosting can use the selected email provider's authenticated SMTP service.
Use the exact hostname, port, SMTP username/password and verified sender supplied
by that provider. Do not use your Alibaba console password or GitHub credentials.

Add these settings to your existing private `.env` (do not overwrite Google or
database settings). Example placeholders are deliberately incomplete:

```dotenv
TAXI_AI_EMAIL_MODE=smtp
TAXI_AI_SMTP_HOST=smtp.your-provider.example
TAXI_AI_SMTP_PORT=465
TAXI_AI_SMTP_USER=your-provider-smtp-username
TAXI_AI_SMTP_PASSWORD="your-private-smtp-password"
TAXI_AI_SMTP_FROM=accounts@your-domain.example
```

Port 465 uses TLS immediately; 587 requires STARTTLS. Certificate verification
cannot be disabled. Set up the provider's domain authentication and sender
approval, and disable provider click tracking for account emails. These links
carry secrets and should never pass through marketing redirects or analytics.
The transport is configured according to [Nodemailer's SMTP options](https://nodemailer.com/smtp).

Run `npm ci`, `npm run config:check`, then restart `npm run dev`. Configuration
checking validates settings without contacting SMTP or sending mail. An incomplete
configuration prevents startup and reports a sanitized configuration error.
To defer setup, keep `TAXI_AI_EMAIL_MODE=off` and all SMTP values empty.

Local emails link to `http://localhost:PORT/account-recovery`; open them on the
computer running Taxi Ai. Staging uses the configured HTTPS public origin. The
request Host header and client-supplied URLs never determine email destinations.
The Compose configuration forwards these server-only values. Never put SMTP
credentials into `EXPO_PUBLIC_*`, browser modules, screenshots, logs or Git.

For a phone, use your reachable HTTPS staging URL. Email links open the website;
finish there, then return to the app. Invited testers must also pass the existing
staging access gate in the browser. Universal/app links are not part of this release.

## What happens to an account

| Action | Result |
| --- | --- |
| Request password reset | Same acknowledgement for an existing, missing, Google-only, staff or throttled address |
| Open an email link | Displays a confirmation/form; GET never verifies email or changes a password |
| Confirm mailbox | Marks only the mailbox bound to that single-use link as verified |
| Submit a new password | Replaces the existing password, verifies the mailbox, consumes all email links, clears queued actions and revokes every web/native session |
| Complete reset | Requires a fresh sign-in and queues a password-change notification; no automatic login |
| Restart server | Keeps valid actions and pending delivery intentions; resumes bounded retries |
| Restore sanitized backup | Preserves verification facts but removes email actions and delivery intentions |

Admin accounts are deliberately excluded from public recovery. Staff recovery
requires a separate operator process and MFA design before a public launch; there
is no default/reset password, public promotion route or hidden admin recovery endpoint.
A Google-only account must recover access through Google; email recovery cannot
silently add another sign-in method. Existing password+Google accounts retain their
Google connection after a password reset.

## Boundaries and failure handling

`modules/account-email` owns scheduling and link consumption. `modules/accounts`
owns credentials and verified mailbox records. The composition root connects
these through injected ports; neither imports another feature's repository.
The existing HTTP boundary owns origin, CSRF, body-size and IP rate checks.
Native endpoints reject browser identity/Origin headers and use bearer sessions
for verification requests. All frontend network access stays in the existing clients.

Links use 32 cryptographically random bytes. SQLite stores only SHA-256 token
digests, a purpose, expiry and account/email/credential binding. Reset links expire
after 30 minutes; verification links after 24 hours. Expiry and bindings are
checked again after asynchronous password hashing, inside the same transaction
that consumes the link and revokes credentials. Parallel submissions have one
winner. A password login rechecks its credential after hashing and uses a private,
single-use in-memory proof checked again when issuing web or device credentials.

Links carry the secret in a URL fragment, which is immediately removed from
history. It remains in page memory until completion/exit. There is no persistent
browser storage, token-bearing query parameter, automatic verification on GET,
third-party script or referrer on the completion page. The user explicitly submits
the action. These choices follow the token, expiry, enumeration and revocation
controls in the [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

Requests schedule durable **intentions**, not serialized emails or plaintext
tokens. A maintenance worker checks twice per sweep (every five seconds), using
one SMTP connection, and generates the token only when sending. Requests do not
wait for provider delivery, avoiding provider timing in account lookup responses.
Per-mailbox/purpose limits allow one request per minute and three per hour across
web and mobile. Pending jobs deduplicate by account and purpose. New requests
stop adding jobs at 1,000 queued intentions; critical password-change notices
are retained even at capacity. Requests still return the generic acknowledgement.

Transient send failures remove the attempted token and retry after one then two
minutes, up to three attempts. Queued intentions expire after an hour. Leases
recover interrupted sends after one minute. On retry, a newly minted link replaces
the previous one; a timeout after SMTP acceptance can result in an unusable older
email. Always use the latest email or request another. SMTP acceptance is not a
guarantee of inbox delivery. Audit events record `account.email_accepted` or
`account.email_failed` without provider responses, recipients, links or secrets.
There are no bounce webhooks or email-delivery admin screens yet.

The worker belongs to the existing single-process SQLite deployment. Do not run
multiple application replicas against this database. A separate queue service,
worker leases across replicas, provider webhooks, operator alerts and retention
policies are future production work. Password recovery does not invoke an AI agent.

## API

| Web endpoint | Authentication |
| --- | --- |
| `GET /api/auth/email-settings` | Public; reports only enabled/disabled |
| `GET /api/account/email` | Customer/driver session |
| `POST /api/account/email/request` | Customer/driver session + CSRF; empty body |
| `POST /api/auth/password/request` | Same-origin, rate-limited; `{email}` |
| `POST /api/auth/email/verify` | Same-origin, rate-limited; `{token}` |
| `POST /api/auth/password/reset` | Same-origin, rate-limited; `{token,password}` |

Native v1 provides `/auth/email-settings`, `/auth/password/request`,
`/account/email` and `/account/email/request`. Link completion is on web.
Profile responses gain an additive `emailVerified` boolean; old native responses
without it are still accepted. No token or password state is included in profiles.

## Update and verify

Stop the server and create a backup **using the currently installed release**
before switching branches. Schema 15 adds tables without rewriting existing users,
passwords, journeys, vehicles or approvals. Older releases cannot open an upgraded
database; use separate test databases when comparing branches.

```bash
npm run backup -- ./backups/before-account-recovery.sqlite
git fetch origin
git switch feat/account-recovery
git pull --ff-only origin feat/account-recovery
npm ci
npm run verify
npm run dev
```

Backend/HTTP tests cover single-use and purpose binding, exact expiry, a reset
race, stale password checks, role/contact changes, rollback, revoked sessions,
generic requests, delivery retries/restarts, schema preservation, safe backups and
web/native authorization. Adapter tests use an injected SMTP transport and never
send external mail. Web controller tests cover explicit confirmation, history
cleanup, duplicate taps, expired links and page exit. Native tests cover transport,
secure storage boundaries and stale replies; both platform bundle exports are checked.

After you configure a real sender, perform an invited-test check on desktop,
iPhone/iPad and Android: registration/verification, expired link, successful reset,
old-password rejection, other-device sign-out and inbox/spam receipt. Real SMTP
delivery and device/browser visual review have not been completed in this workspace.
An earlier automatic approval review blocked browser preview; these tests do not
claim to substitute for that review.

Next: finish the mobile booking → negotiation → trip → simulated receipt journey.
Phone verification, Sign in with Apple, account deletion, staff MFA/recovery and
enforced live-service onboarding remain separate milestones before public release.
