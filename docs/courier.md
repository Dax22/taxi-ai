# Parcel pickup, delivery and recipient tracking

Taxi Ai Courier uses the existing request, matching, negotiated fare and trip lifecycle. Senders choose pickup and destination locations, a suitable vehicle (car, van, truck or motorcycle), parcel description and weight, and recipient name and delivery instructions. Nationwide service means locations throughout Nigeria are supported; actual fulfilment requires an eligible, available courier near the pickup with sufficient payload capacity. Fare acceptance remains explicit. Passenger trips and parcel jobs have separate service labels even when both use a standard car.

The sender supplies the pickup PIN only when handing over the parcel. The assigned courier starts the delivery with that PIN and completes it with the recipient's separate six-digit delivery code. Incorrect delivery codes are rate limited by the existing handover flow. Cancellation and completion clear the delivery code and stop location sharing.

## Recipient invitations

After submitting a parcel request, the sender creates and manually shares an invitation. The recipient signs into their own customer account and explicitly accepts it. Opening a link by itself does not reveal parcel details. Invitations can be accepted for seven days while the delivery remains active. Exactly one account can claim an invitation. Accepted access survives signing out, signing back in and switching between web and native devices. An accepted recipient can still see the final status after completion; only an active in-transit delivery can show a location or handover code.

Treat the invitation as private: the first eligible account accepting it becomes the recipient. The app does not independently prove that account belongs to the named recipient. If it reaches the wrong person, the sender should revoke or replace the invitation immediately and send the new link directly to the intended recipient. There is no automatic SMS or emergency messaging in this flow.

Replacing or revoking a link removes the previous recipient's access immediately on the server. Clients refresh recipient state and clear sensitive cached state on access failure or sign-out. The sender and assigned courier cannot claim recipient access, and an accepted recipient cannot claim the same job as its courier. Snapshot exports revoke all invitations and accepted grants so copied databases cannot reuse sharing permissions.

Recipient projections expose parcel reference, status, description, weight, recipient name, destination, assigned courier name and public vehicle details, and timestamps. They never expose pickup addresses, sender contact details, account IDs, negotiation, payments, chat or pickup PINs. Live coordinates are available only after pickup and only when the courier's existing authenticated location sharing has a fresh point. Stale, stopped or absent location sharing returns no point. The app must explain this as location unavailable rather than simulating movement. Sender and courier normal permissions remain unchanged.

## HTTP contract

Browser endpoints use cookie authentication, same-origin checks and CSRF protection on writes. Native endpoints are the same paths prefixed with `/api/mobile/v1` instead of `/api`, and require a native bearer session. All mutations require a unique `Idempotency-Key` of 16–128 URL-safe alphanumeric, underscore or hyphen characters. Query parameters are rejected. Current sessions are checked again before returning the response.

| Method and browser path | Purpose |
| --- | --- |
| `GET /api/parcels/:rideId/invitation` | Sender's current invitation and whether it can be replaced |
| `POST /api/parcels/:rideId/link` | Create or replace; body `{expectedLinkId: null or current id}` |
| `POST /api/parcels/:rideId/revoke` | Revoke current grant; body `{linkId, expectedVersion}` |
| `POST /api/parcels/accept` | Claim on signed-in recipient account; body `{token}` |
| `GET /api/parcels/received` | Up to 50 recently accepted parcels belonging to this account |
| `GET /api/parcels/received/:rideId` | Current minimal tracking projection for an accepted parcel |

Only a successful fresh creation returns its raw token. Retrying the same creation key returns current invitation state without redisclosing a token; replace the invitation if the initial response was lost. Only token hashes are persisted. A command key cannot be reused for different input. Updates and audit/retry records share a transaction. Indexes bound recipient reads and per-delivery link history without a global invitation sweep. Each parcel allows at most 30 invitation creations.

SQLite migration 038 and PostgreSQL migration 010 add recipient grants and command records. The feature uses the existing database adapters and requires the usual PostgreSQL migration command before a production release. Payment settlement, SMS delivery, independent proof of recipient identity and physical-device background GPS acceptance remain separate operational integrations.


## Required work location

The assigned courier must explicitly enable location sharing and publish a fresh
fix before departure, arrival at pickup or starting the delivery. The server
rejects those progress actions if tracking is missing, stopped or stale. The
sender and recipient do not need to share their own GPS. Completion, cancellation
and safety remain available if permission or connectivity is lost; stopping GPS
does not silently cancel or complete a delivery.

Installed native builds support background publishing with explicit OS permission,
a visible Android foreground-service notification and the iOS location indicator.
Updates remain subject to OS scheduling and permission/network availability;
force-quitting cannot promise continuous tracking. See
[mobile-trip-location.md](mobile-trip-location.md) for setup and device testing.
