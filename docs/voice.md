# In-app audio calls

The assigned customer and approved driver can call from the account dashboard
while their ride is negotiating, agreed, booked, on the way, arrived or in progress.
No telephone numbers are used or returned. This milestone provides a local WebRTC
preview and an optional relay configuration. It does not launch a calling service.

Calling never accepts or changes a fare. After discussing a price, one person
submits an offer and the other explicitly accepts it through the existing controls.
Audio is not recorded or transcribed; there is no voice AI or automatic agreement.

## Local setup

1. Run `npm run verify`, then `npm run dev` with Node 22.12 or later.
2. Open `http://localhost:3000/app` in two separate browsers/profiles on the same
   computer. Sign in as a test customer and an approved test driver. Ordinary
   tabs share a login cookie; they are not two independent account sessions.
3. Request a test ride and have the driver claim it. Select that journey.
4. Click **Call in app** in the Talk in Taxi Ai panel and allow microphone access.
5. In the other account, click **Answer** and allow its microphone. Keep both
   account windows open. Use headphones to avoid speaker feedback.
6. Try **Mute**, **Unmute** and **End call**. If autoplay is blocked, use the
   **Play call audio** button. Chat remains available.

The default `TAXI_AI_CALLS_MODE=local` supplies no STUN/TURN servers. It is intended
for a same-computer preview. Local mode permits direct peer connections and must
not be described as hiding a peer's IP address. Changing this setting does not
enable remote hosting: local mode still binds to loopback and enforces local
Host/Origin checks. The [private staging setup](staging.md) is separately
configured; hosted calling requires relay mode and actual device/network validation.

`TAXI_AI_CALLS_MODE=off npm run dev` disables new calls and removes microphone
permission from the account page. Changing the configured mode closes existing
calls on the next cleanup pass.

## Call lifecycle and ownership

| State | Meaning / permitted outcome |
| --- | --- |
| `ringing` | Caller has invited the other participant; only the recipient may answer or decline |
| `connecting` | Answered; the two owning windows exchange one audio offer/answer |
| `connected` | Both browsers reported connection after both descriptions were saved |
| `ended` | Hang-up, trip closure, session revocation/expiry, configuration change or maximum duration |
| `declined` | Recipient explicitly declined |
| `missed` | Ring deadline expired without an answer |
| `failed` | Setup, microphone, network or heartbeat failure |

The browser displays **Audio connected** only when its own peer connection reports
that state. Stored status is not proof that sound reached either person.

Each user has one active-call reservation, whether calling or receiving. The
caller session and page nonce are bound at creation; the recipient's are bound at
answer. A second tab can see metadata or hang up but cannot fetch audio setup,
answer an already answered invitation, or take over microphone access. A reload
gets a new nonce: end the older call and explicitly start another. Microphones
are never reopened automatically.

Answer/decline require the displayed call version. Commands save an actor-scoped
idempotency key with a normalized fingerprint, including the window identity.
Retransmitting identical audio setup is safe; a new description cannot replace
one already saved. Late retries after termination return terminal state and do
not restore connection details or participant reservations.

| Limit | Value |
| --- | --- |
| Ring / connection setup deadline | 45 seconds each |
| Browser heartbeat / server lease | Every 8 seconds / expires after 30 seconds |
| Browser signaling silence / disconnected audio | Stop local audio after 15 / 8 seconds |
| Microphone permission/setup wait | 30 seconds; delayed permission is immediately released |
| ICE candidate gathering | At most 10 seconds |
| Call length | At most 30 minutes from invitation |
| New calls | At most 5 per caller per minute |
| Local server active calls | At most 200; a resource guard, not a capacity claim |

The server cleans up every five seconds and before call commands/reads. At an
exact deadline the call is expired. A lost caller heartbeat can end ringing
before its ring deadline. Browser timers may be throttled in the background;
this prototype requires the pages to remain open and has no push/background
calling service. A local hang-up stops tracks immediately even if its HTTP write
fails; the server lease provides subsequent metadata cleanup.

## HTTP contract

All routes require an eligible authenticated participant. Mutations also require
same-origin JSON and the session's CSRF header. `X-Call-Client` is a page-generated
UUID; it is required for mutations and media reads. It supplements authentication,
and is not an account credential or a substitute for server authorization.

| Method and path | Body / result |
| --- | --- |
| `GET /api/calls` | Calling settings, one active call and ten recent terminal calls |
| `POST /api/rides/:rideId/calls` | `{}` → invitation; 201 for creation, 200 for a replay |
| `POST /api/calls/:id/accept` | `{ expectedVersion }` → recipient owns audio in this window |
| `POST /api/calls/:id/decline` | `{ expectedVersion }` → declined |
| `POST /api/calls/:id/end` | `{ reason }`: `hangup`, `media_failed` or `client_closed` |
| `GET /api/calls/:id/media` | Owning answered window only; RTC configuration and remote description |
| `POST /api/calls/:id/signal` | `{ type, sdp }`: caller sends `offer`, recipient sends `answer` |
| `POST /api/calls/:id/pulse` | `{ connected: boolean }`; owning window's heartbeat |

All POST commands except `pulse` require `Idempotency-Key` (16–128 letters, digits,
dashes or underscores). SDP is limited to 12,000 ASCII characters, one encrypted
audio media section and at most 64 gathered candidates. Video/data channels and
trickle candidates are not supported. Browsers still validate the SDP itself;
server checks are a bounded envelope, not a full SDP parser.

Other users receive 404 for call IDs; administrators have no call-media API.
Call metadata excludes SDP, credentials, email and phone numbers. The media
endpoint returns only the other participant's description and the caller's own
temporary relay credentials. No endpoint accepts a client-selected actor, peer,
server clock or session identity.

## Optional TURN relay

For relay testing, an operator must provision and operate a coturn-compatible
TURN server using its shared-secret authentication. Supply these values through
the server environment, never through GitHub source or browser configuration:

| Environment variable | Meaning |
| --- | --- |
| `TAXI_AI_CALLS_MODE` | `relay` |
| `TAXI_AI_TURN_URLS` | Comma-separated `turn:`/`turns:` URLs, at most four; DNS/IPv4 hostnames and optional port/UDP/TCP transport |
| `TAXI_AI_TURN_SECRET` | Matching server shared secret, at least 32 characters |

For example, a URL can be `turn:relay.example.com:3478?transport=udp`. This is a
placeholder, not a provisioned provider. Configuration rejects missing/invalid
relay settings instead of falling back to direct audio.

The server mints one-hour credentials for the answered call and participant;
the browser receives `iceTransportPolicy: "relay"`. Relay-mode signaling rejects
non-relay candidates. The permanent secret stays server-side; temporary TURN
credentials necessarily reach the authorized browser. Live credential acceptance,
TLS/certificate configuration, firewall behavior and relay capacity are not tested
here. Use transport/network choices supported by the relay and target browsers.

This follows the [WebRTC TURN setup guidance](https://webrtc.org/getting-started/turn-server)
and [coturn REST credential convention](https://github.com/coturn/coturn/blob/master/README.turnserver).
The [W3C WebRTC specification](https://www.w3.org/TR/webrtc/) defines relay candidate
policy and peer connections; [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
defines microphone acquisition and track stopping.

## Storage and boundaries

Migration `004_voice_calls.sql` upgrades earlier databases to schema 4 without
rewriting accounts, sessions, fares, chat, pickup PINs or trip history. It adds
call metadata, participant reservations and retry keys. Earlier branches refuse
the upgraded database; use a separate test database when comparing branches.

The calls repository alone owns these tables. Trip completion/cancellation clears
its call in the same database transaction; an injected write failure rolls both
changes back. Session expiry/revocation and configuration changes are also checked
by cleanup. All transitions keep a content-free audit reference.

Offer/answer SDP exists temporarily in SQLite while a call is active and may
include IP addresses and ICE credentials. Termination clears it and the hashed
session/window bindings. This is logical deletion, not forensic erasure of SQLite
WAL files or backups. Recent metadata remains stored; retention/deletion operations
are not implemented. No audio bytes, recordings or transcripts are stored by Taxi Ai.

The browser uses WebRTC transport encryption; this prototype does not establish
independently verified peer identity or a production end-to-end security guarantee.
Call blocking/reporting, staffed support, push/background ringing, device handover,
ICE restart and real mobile applications remain future work.

## Manual browser review

Automated tests cover authorization, concurrent commands, timeout boundaries,
retries, storage rollback/migration, microphone cleanup, delayed async results,
audio adapter behavior and playback fallback. They use simulated browser objects;
they do not prove real microphone audio, layout or browser interoperability.
The available cloud browser blocked local previews, so these checks remain pending:

1. In two independent local sessions, test calls in both directions. Verify that
   an incoming invitation alone never opens the microphone, and denied permission
   leaves chat usable. Answer and verify both people actually hear each other.
2. Mute each side and confirm the other side hears silence; unmute and hang up.
   Check that microphone indicators clear after hang-up, decline, sign-out,
   reload, tab closure, journey completion and cancellation.
3. Leave a permission prompt open, cancel setup or switch journeys, then grant
   it. Confirm the late microphone is immediately released and no call starts.
4. Answer simultaneously from two tabs in the recipient's account. Only one
   should own audio. Use End call in the other tab and verify both sides stop.
5. Reject autoplay and test Play call audio. Check keyboard navigation, status
   announcements and controls at phone/tablet/desktop widths. Chat actions must
   not disable End call.
6. Interrupt signaling and audio independently, close a window, and restart the
   server. Confirm bounded cleanup, one history entry per call and successful
   redial. Refreshing must not silently reopen the microphone.
7. Discuss and type an agreement; confirm only an explicit accepted fare offer
   changes the price. Trip completion/cancellation must terminate its call.
8. After a relay is provisioned, verify actual two-way audio and selected relay
   candidates in each browser's WebRTC diagnostics. Test target browsers and
   mobile/cellular/restricted networks only after an HTTPS hosting milestone.
   No Chrome/Firefox/Safari/iOS/Android compatibility certification is implied.
