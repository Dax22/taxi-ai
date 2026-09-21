# Vehicle category icons

The website's Ride tab, signed-in Customer dashboard, native Customer home and
native booking screen now share a vehicle category catalogue. The SUV card uses
the user's silver Cybertruck reference. Van, truck and motorcycle icons match the
existing white 3D car artwork.

| Category | Artwork | Current action |
| --- | --- | --- |
| Standard | Existing rounded white car | Existing car ride preview |
| SUV | Silver Cybertruck | Browse; bookings coming soon |
| Van | White panel van | Browse; parcel delivery coming soon |
| Truck | White cargo box truck | Browse; bulky delivery coming soon |
| Motorcycle | White street motorcycle | Browse; food/small-parcel delivery coming soon |

The Cybertruck is the requested visual identity for the SUV card, not a factual
SUV body-type classification or a promise of a Tesla fleet. Category artwork is
separate from a driver's actual vehicle, plate, paint and approved documents.
Passenger motorcycle rides remain outside the current product scope.

## Boundaries

- `packages/shared/src/vehicle-categories.mjs` owns the immutable names, copy,
  availability and web asset paths. Its adjacent declaration exposes native types.
- The web picker is a DOM-only module with a selection callback, arrow/Home/End
  navigation, a roving tab stop and announced descriptions. Each page owns the
  visibility of its existing Standard flow.
- The native component uses the same catalogue with an explicit, typed static
  image map. It wraps across phone/tablet widths and uses one column for large
  text. Booking selection is locked while an action is pending or uncertain.
- Web server routes explicitly allow the new modules, stylesheet and images.
  No wildcard static-file route or external image host was added.
- Selecting a planned category hides Standard booking controls. It sends no
  network request and changes no fare, account, driver profile or saved journey.
  Existing requests and trip controls stay available. Customer dashboard category
  selection survives polling and resets when the account/workspace is cleared.

This is a presentation feature, not category-aware dispatch. Saved rides and
driver registrations have no new category field. The database, request payloads,
fare rules and matching engine are unchanged. Enabling a category requires its
real workflow: vehicle classification and approval, persisted request category,
server-enforced matching, pricing/route support and the relevant ride or delivery
lifecycle. Do not enable it solely by changing `ridePreview`.

## Check locally

Run `npm ci`, `npm run verify`, then `npm run dev`. On the homepage, open Ride and
select each category. In `/app`, sign in with a local test customer and repeat.
SUV/Van/Truck/Motorcycle must show Coming soon and hide the Standard forms; select
Standard to restore them. Check arrow keys, Home/End, visible focus, 320/390 px
phones, tablets, desktop, zoom and long text. A dashboard status refresh must keep
the selected category; account/mode reset must clear it.

For native, run `npm ci --prefix apps/mobile` and `npm run mobile:verify`, then
follow [the mobile setup](../apps/mobile/README.md). Check Home and Book a ride on
iOS and Android, VoiceOver/TalkBack, large text, tablets, existing requests and
retry states. The cards must not crop the vehicle silhouettes or truncate labels.

The automated dashboard regressions cover planned-category submission isolation,
polling, account reset, keyboard focus and command locks. Native checks cover
types, dependency boundaries, existing tests and both platform bundles. Browser
visual verification was blocked by `ERR_BLOCKED_BY_CLIENT` for the local preview;
simulator/physical-device and actual screen-reader acceptance remain pending.
No deployment or store release is included.

See [artwork provenance and prompts](design/vehicle-categories.md).
