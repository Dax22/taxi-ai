# Booking for someone else

Taxi Ai separates the person booking a ride from the person taking it. Choose
**Who is riding? → Someone else** on web or mobile, enter the adult passenger's
name and phone number, and confirm that they agree to the booking and sharing
their trip details. Then choose their pickup and destination, request a driver,
agree the fare and confirm the booking.

This feature extends the development preview. Payments remain simulated and no
automatic SMS is sent. The passenger link is shared manually by the booker.

## Responsibilities

| Person | Access |
| --- | --- |
| Booker | Requests the ride, negotiates and accepts the fare, confirms/cancels the booking, manages the passenger link, and owns payment/receipt access |
| Passenger | Opens the private link without an account to see their route, driver, vehicle, trip status and pickup PIN before the trip starts |
| Assigned driver | Sees the actual passenger's name and the booker's identity, coordinates with the booker, and verifies the passenger's PIN at pickup |
| Other drivers and accounts | No access to passenger contact details or the private passenger link |

The booker remains `ride.customerId`. A separate immutable passenger snapshot
records who is riding. Choosing someone else does not give that person access to
the booker's account, fare negotiation, messages, saved payment records or other
trips. The entered phone number is visible only to the booker; it is not verified
and is not a credential. Guest booking is available for passenger rides, not
parcel-delivery categories. Existing one-active-booking rules still apply.

## Share the passenger link

After confirming a guest booking, use the passenger-link controls on the journey
to create a private link. Copy it on web or use the native share sheet on mobile,
then send it directly to the intended passenger using your own messaging app.
Creating or copying a link does not send a message.

The link allows its holder to see the pickup PIN. Share it only with the intended
passenger. Ask them to compare the driver's identity and vehicle/number plate at
pickup, then give the PIN to the driver in person. The driver cannot read the PIN
from their normal trip view and must enter it to start the trip. The PIN disappears
from the passenger page after the trip starts.

Passenger pages show the current trip status and any recent location the driver
has explicitly shared. They do not promise an arrival time, background tracking,
direct passenger–driver chat/calls, or emergency dispatch. Coordination continues
through the booker's existing driver conversation.

## Link security and recovery

- Each link is a separate random 256-bit capability. Only its digest is saved.
  The secret is placed in the URL fragment, removed from the visible URL on page
  load, and retained only in memory. It is never a normal account access token.
- Only the booker can create, replace or revoke a link, after booking confirmation.
  A link is valid for up to 24 hours and depends on the issuing web/device session.
  Ending the trip, revoking that session, replacing the link or revoking it removes
  access. Links are not permanent tracking URLs.
- Link-management commands require authentication, version/precondition checks and
  an idempotency key. Browser writes also require same-origin and CSRF checks.
  Guest reads use a small, rate-limited capability endpoint.
- The raw secret is returned only on its first successful creation. If that reply
  is lost, retry checks the same action without creating another link. Replace the
  saved link explicitly if its secret was not received; the old one then stops working.
- Account/trip changes clear the booker's link state. The passenger page clears
  private details on request failure, expiry, hiding and page exit. Reopen the
  original private link if a full reload has discarded its secret.
- A shared link proves possession of the link, not the passenger's identity or
  presence. Passenger consent is the booker's confirmation, not an SMS verification.

## Module ownership

The guest-rides module owns passenger snapshots and guest-link records. Rides uses
shared passenger validation/projection rules and injected storage ports, and keeps
the existing fare, trip, PIN and payment authority. The application composition root wires the
modules; business modules do not import one another's repositories.

Shared passenger rules and link state are used by web and mobile. Each platform
retains its own authenticated transport and UI. The passenger page uses a narrowly
projected response rather than exposing the ordinary ride endpoint.

Schema 22 adds guest-ride storage without rewriting existing rides. An older ride
with no passenger snapshot continues to mean the booker is riding. Back up before
upgrading; older servers cannot read schema 22. Passenger names and phone numbers
are private data in the database and its backups.

## Try the complete preview

1. Use separate sessions for a customer and an approved driver. Follow
   [matching setup](matching.md) to enable an isolated sample ride, or use your
   configured route provider.
2. As the customer, choose **Someone else**, enter fictional passenger details and
   consent, and request a passenger ride. Check that switching back to **Me** or
   to a delivery category removes guest details from the request.
3. As the driver, claim the request. Check the passenger and booker labels and
   that the passenger's phone number is absent.
4. Negotiate, explicitly accept and confirm as the booker. Create the private
   passenger link and open it in a separate browser session.
5. Mark departure and arrival as the driver. Check the guest page's status, vehicle
   and pickup PIN. Enter the PIN through the driver's existing start action.
6. Confirm the passenger page no longer shows the PIN after starting. Complete
   the trip and confirm the link stops showing private trip details.
7. On another trip, test replacement, revocation, session sign-out, interrupted
   creation/retry and expiry. An old link must never reveal the new link's secret.
8. Complete a local [payment simulation](payments.md). The booker remains the
   customer responsible for that record; the passenger link grants no payment access.

Before release, validate the complete journey at phone, tablet and desktop widths
and on physical Android/iOS devices. Live SMS, verified phone ownership, masked
passenger calls/chat, real payment processing and production support require
separate provider and operational work.
