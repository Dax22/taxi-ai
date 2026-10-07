# Tracking hardening and release acceptance

## Release scope

This change implements native transient-network recovery, intended-recipient verification, limited anonymous parcel status, delivery evidence, and an account-scoped exception/return workflow. It includes web and native delivery-record screens and a release-evidence checker. It does not prove that a hosted deployment, a signed mobile build, email provider, map provider, or physical-device trip works.

The implementation workspace was copied from the readable server checkout. The deployed backend revision has not been matched to this checkout. Review the changes onto the actual deployed source branch before building a production image; do not replace a running service with the entire snapshot workspace. In particular, preserve the existing public account-access configuration rather than restoring older invited-preview settings.

## Location publishing

Native active-work tracking uses the existing permission-gated background task. Temporary network errors, timeouts, HTTP 408/425/429 and server failures retry with backoff while the existing sharing authority remains valid. Numeric or HTTP-date Retry-After values are respected within a bounded window. Only a fresh OS position is published; failed coordinate batches are not persisted or replayed as current locations. An uncertain response consumes its attempted sequence so a different future location cannot reuse it.

Recovery does not renew consent, increase authorization expiry, or extend the existing 60-second no-success lease. A prolonged outage requires the driver to reopen Taxi Ai and explicitly restart sharing. Stop, logout, permission revocation, invalid responses, expired authorization and closed jobs still stop the publisher. The app distinguishes connection recovery from a healthy publisher. A native build and operating-system permissions are required; this is not a promise of uninterrupted operation after force-stop, device restart, or battery restrictions.

The website remains a foreground tracking client. Receivers can view the courier through the website without running their own GPS. Visible location age and accuracy are retained. Existing approximately ten-second publishing/polling is not converted into an untested high-frequency streaming system.

## Intended recipient and limited status

Creating or replacing an invitation now requires the intended recipient's Taxi Ai account email. The grant stores a link-salted digest, not that address in plaintext. The accepting account must have the same verified email. Verification is checked again for detailed parcel reads; possession of a forwarded link alone does not grant exact tracking or the delivery PIN.

An anonymous holder of a valid invitation may POST it to `/api/parcels/preview` to see only reference, status and last delivery-update time. The web recipient page uses that limited preview. It never returns names, addresses, vehicle details, precise coordinates, fare or handover codes. Native detailed access continues to use the signed-in account. The preview is subject to same-origin checks and the existing unauthenticated request limits.

Unclaimed invitations expire after 24 hours. Accepted access remains tied to the recipient account and may be revoked or replaced by the sender. The sender must still deliberately share the link; no SMS or email invitation is automatically sent by this release.

### Mandatory transition for existing invitations

Existing grants have no trustworthy intended-email binding. This release refuses detailed access through those grants until the sender replaces the invitation. The deployment owner must review active parcels, schedule a safe transition, and communicate replacement instructions. Do not deploy midway through a handover without an agreed access-recovery plan. The release checklist explicitly requires evidence for this transition.

Account email verification must be usable before rollout. Verify actual account-email delivery or an existing verified sign-in route. Contact-form SMTP and account-email SMTP are separate configurations; enabling one does not enable the other. Do not mark users verified or remove the email-binding checks to work around an unconfigured provider.

## Delivery records and exceptions

The web record is `/parcel-operations?id=<parcel UUID>`. The same operations are available in the native delivery-record screen, linked from a courier journey and the incoming-parcel page. Access is limited to the booking sender, assigned courier, or accepted verified recipient. Recipients see the permitted event summary and handover metadata, not private notes or saved handover coordinates.

The server permits reports for recipient unavailable, incorrect handover PIN, damaged parcel and failed delivery. An unresolved report holds ordinary PIN handover. Only the sender can record a resolution. Sender or courier may request a return; only the sender authorizes it, with an instruction. The sender confirms return receipt by typing `RECEIVED` after physically receiving the parcel.

Return progress is a separate versioned ledger. For compatibility, a completed return closes the original journey as `cancelled`; its delivery record says `returned`, never `delivered`. It clears active tracking and codes and does not create a successful-delivery payment. Existing test-checkout reconciliation is invoked when applicable. Automatic refunds, return-leg pricing, extra navigation legs, adjudication and insurer decisions are not implemented by this ledger.

Commands are participant-authorized, version-checked and idempotent. A lost response is shown as confirmation pending, and retry reuses the exact action and key. Clients do not optimistically announce successful delivery or return. The ledger is bounded to 100 events per parcel; exceptional cases beyond that need support. Post-completion disputes use the support process rather than rewriting completed handover evidence.

## Handover evidence

Correct PIN verification records the parcel, assigned courier, server timestamp, verification method, and a fresh courier location when one exists, atomically with normal completion. Missing or stale GPS is recorded as unavailable, not invented. No raw handover PIN is stored in this evidence record. A PIN record is evidence of the application's handover check, not an independent legal identity, damage or custody determination.

`position_recorded` preserves whether a position originally existed. Sanitized SQLite snapshots remove raw handover coordinates and intended-email binding digests, while retaining the audit event and delivery record. Retention policy, access review, incident handling and backup policy must be approved by the operator before public launch.

## Storage and migrations

SQLite migration 048 and PostgreSQL migration 022 are additive. They add recipient binding metadata, handover evidence and the exception ledger. PostgreSQL references are deferred to preserve the existing transactional import order. Ordinary PostgreSQL application startup does not apply schema changes. Validate the migration against a separate PostgreSQL copy, take a verified backup, then apply it through the established migration procedure before the matching application rollout.

Do not downgrade the schema in place. A rollback must use the reviewed pre-release backup or a separately prepared compatibility release; database records written by the new code must not be discarded. Old-schema regression fixtures remove only empty new tables/fields and refuse populated evidence or verified grants.

## Release evidence and real-device acceptance

Run `npm run tracking:launch-check -- /absolute/path/to/reviewed-acceptance.json` with the intended map configuration available privately. The committed `docs/tracking-acceptance.json` is deliberately pending. Each passed item needs the exact release commit, completion timestamp, reviewer and an evidence reference. The checker rejects missing, future-dated, stale or different-release entries and community/off map mode. Passing validates the inventory format only; it cannot prove that an attestation is truthful. Keep real acceptance evidence outside the template and never commit credentials, location traces or private recipient details.

Use a controlled direct-delivery trip in Nigeria with separate sender, intended recipient, unrelated-account tester and approved courier. The driver must not operate the phone while driving; a stationary test or separate test observer should perform phone interactions. Test signed Android and iOS builds against a non-production acceptance backend first, then a controlled deployed smoke test under an agreed launch plan.

| Check | Required evidence |
| --- | --- |
| Exact deployment | Source commit, backend image digest, build IDs, schema version and access-mode preservation. |
| Intended recipient | Intended verified account accepts; unverified and wrong-email accounts fail; forwarded invitation cannot be claimed by an unrelated account. |
| Pre-collection privacy | Anonymous link shows limited status only; recipient exact location and PIN remain absent before collection. |
| Moving tracking | Sender and accepted recipient independently receive changing device coordinates, visible timestamp/accuracy and correct vehicle after collection. |
| Locked screen | Installed courier app continues permitted active-job updates during screen lock and normal background use on both operating systems. |
| Brief network failure | Temporarily interrupt connectivity, restore it within the sharing lease, and observe fresh updates resume without replaying older coordinates. |
| Expired lease | After a longer interruption the publisher stops; reopening does not silently restart tracking without the driver's action. |
| Revocation | Removing GPS permission, explicit Stop, logout, device revocation and job closure remove publishing authority. |
| Handover | Wrong PIN cannot complete; correct PIN produces one timestamped record; live recipient location/PIN disappear after completion. |
| Uncertain confirmation | Lose a successful response, retry the identical command and confirm there is one handover/payment/return result rather than duplicates. |
| Return | Report issue, request return, reject courier self-authorization, authorize as sender, then confirm physical return as sender; verify the parcel is not labelled delivered in its delivery record. |
| Browser/native isolation | Switch account, hide/show the page, revoke recipient access and reconnect; no previous account's private snapshot is displayed. |
| Email/contact | Deliver an account-verification email and a contact-form message to actual destination inboxes; record received-message references without secret contents. |
| Load and maps | Exercise concurrent active jobs against provisioned capacity; record GPS age, delivery lag, error rates, routing/tile availability and mobile battery behavior. |

## Provider and operations requirements

Keep native GPS collection separate from the street-map provider. Provision explicit search, routing and tile services with reviewed capacity and availability; do not merely relabel community endpoints as dedicated. Supply `TAXI_AI_MAPS_MODE=dedicated` and the supported `TAXI_AI_SEARCH_URL`, `TAXI_AI_ROUTING_URL` and `TAXI_AI_TILE_URL` privately after provisioning. Tune request budgets to the provider agreement and measured traffic. No provider was purchased or reconfigured by these code changes.

The current booking model is a direct parcel delivery, not a multi-stop manifest. Do not extend recipient snapshots to reveal an unrelated customer's stop or route when multi-stop work is introduced. Such a feature needs per-leg access and a visibility policy before launch; no speculative multi-stop routing engine is added here.

Assign a support owner and a monitoring destination. Track aggregate update age, accepted/rejected location writes, expired active shares, repeated recovery failures, route/tile errors, unsettled completion/return confirmations and email failures. Use existing telemetry and a deployment monitoring service; do not log precise coordinates, tokens, PINs, recipient emails or document images in general logs. Alerts must have an owner, response procedure and tested delivery channel. This release supplies acceptance gates, not a claim that an external alerting service is already connected.

Contact SMTP activation, signed app distribution, provider billing, operating-system behavior, real network recovery and production PostgreSQL migration remain deployment/acceptance tasks. An enabled configuration flag or an isolated test is not sufficient evidence for these gates.

## Verification commands

```bash
npm run check
npm test
node --experimental-strip-types --test apps/mobile/test/*.test.ts
apps/mobile/node_modules/.bin/tsc --noEmit -p apps/mobile/tsconfig.json
npm run tracking:launch-check
```

Run the PostgreSQL suite with a disposable configured database, not production. Unit and loopback tests use fixtures and do not move money, send real parcels, confirm external mailbox delivery or prove device GPS.

Platform references: Expo Location documentation (`https://docs.expo.dev/versions/latest/sdk/location/`) and the OpenStreetMap tile usage policy (`https://operations.osmfoundation.org/policies/tiles/`). Consult the current platform and provider requirements for the exact build being released.

### Client compatibility during rollout

The invitation-create/replace request now requires `recipientEmail`. Older native builds without that field cannot create a new invitation; they must be updated. Coordinate backend, web assets and signed native builds, and include this compatibility check in the legacy-invitation transition. Do not restore bearer-only invitation issuance as a compatibility fallback. This is an intentional security-sensitive contract change, not a claim of transparent compatibility with every previously installed development build.
