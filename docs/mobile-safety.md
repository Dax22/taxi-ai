# Native trip safety

Open **Activity → journey → Safety / SOS** as either customer or driver.
The screen keeps trusted contacts, private trip links and your own incident
records together. It remains a development preview: saving a concern does not
call emergency services, deliver contact alerts or promise a staffed response.
The screen explains this before and during incident submission.

## Controls

- Add, edit or remove up to three international-format trusted contacts. Names
  and numbers remain account-owned and unverified. Editing uses the displayed
  record version and cancels queued/failed simulations. A previously sent test
  alert cannot retry to an obsolete contact name/number after it later fails.
- Create or replace a 15-, 30- or 60-minute private link. A second, explicit
  action opens the operating system share sheet so the user chooses a recipient.
  No message is automatically sent. Staging links still require preview access.
- Revoke the active link at any time. A link also ends on expiry, trip closure,
  native device sign-out/revocation or session-family expiry. Access-token refresh
  preserves the device family and therefore does not invalidate the link.
- Show when driver-shared location was recorded and whether it was marked stale
  at the last refresh, or explicitly report that no location is available. This
  screen does not start native location tracking; the existing web driver sharing
  can supply the position. Do not interpret availability GPS as trip sharing.
- Record a concern/SOS test incident on a confirmed active journey, with a kind
  and optional note. Native submissions select no notification recipients because
  real contact delivery is unavailable. The backend stores a trip snapshot.
- Read your incident status after administrator acknowledgement or closure,
  including after the trip ends. Existing simulated alert history from the web
  is labelled simulation only. Other participants cannot read your incidents.

## Boundaries and lifecycle

`src/safety/` owns the mobile wire readers and controller. The native API client
owns network transport. An account-scoped provider retains uncertain commands
across navigation; the screen owns transient form fields. Routes under
`/api/mobile/v1/safety/` use bearer authentication and delegate to the existing
safety service. Native projections exclude administrator IDs, audit internals and
incident snapshots. No staff-review or notification-simulation native endpoint
is exposed. The shared backend adds a versioned contact edit operation.

Existing `trip_share_links.session_hash` stores `native:<device family ID>` for
native links; these internal references never leave the backend. Browser links
retain hashed-cookie bindings. The internal native session-owner port validates
revocation and expiry. Existing snapshot cleanup clears all link credentials;
no schema migration or database reset is required.

A link secret is returned only once and remains in memory. It is cleared on
backgrounding, leaving the screen, account teardown, expiry/revocation or link
replacement. A lost create response cannot recover the secret on retry: the
app shows the saved link and offers explicit replacement/revocation. Link tokens
must match the current share ID before they can be offered for sharing.

Lost write responses retain the original payload and idempotency key for an
explicit retry. No timer retries a mutation. Account teardown discards pending
commands and late results. Force quitting also loses local retry memory: review
server state before acting again. Command readers require the result appropriate
to the action; an incomplete success envelope is not treated as a saved incident.

## Acceptance

Automated tests cover participant isolation, contacts and stale versions, native
link replay/refresh/expiry/sign-out/device revocation/trip closure, private incident
status, notification simulation limits, late responses, immutable retries and
cross-device link replacement. Existing web safety tests continue to exercise
snapshot privacy, transactions, permissions and cleanup.

Physical device/visual/accessibility acceptance is pending. Test the OS share
sheet, cancellation, large text, keyboard avoidance, background privacy, connectivity
loss and account changes on signed iOS/Android builds. No test establishes actual
emergency response, trusted-contact delivery or native live location tracking.
