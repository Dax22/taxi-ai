# Taxi Ai Eats

Release 0.24.0 / mobile 0.8.0 adds restaurant ordering to the same Taxi Ai accounts,
website and iOS/Android app. This is a development preview with fictional stores
and test orders. Checkout never collects money and does not dispatch a real delivery.
It is a Taxi Ai workflow, with no DoorDash service or API dependency.

## Entry points

| Task | Website | Mobile app |
| --- | --- | --- |
| Browse, menu, cart and checkout | `/eats` | Home → Taxi Ai Eats |
| Customer order history | `/eats?screen=orders` | Activity → My food orders |
| Seller signup, menu and kitchen orders | `/eats/sell` | Account → Sell on Taxi Ai Eats → Seller hub |
| Courier collection and delivery | `/eats?screen=work` | Work → Food deliveries |
| Staff approval | `/eats?screen=review`, also linked in `/admin` | Staff uses the website |

The seller hub is an account-scoped workspace for restaurants, vendors and private kitchens. It does not grant a public administrator
role or change Customer/Work permissions. The first version supports one owner
and one store per personal account. Staff invitations and multiple branches are future work.

## Try a complete test order

Use independent browser profiles or devices for the customer, store owner,
approved driver and administrator. Ordinary tabs share the same web login.
Existing accounts and driver approvals can be reused. For the first administrator,
follow the root README's `npm run admin -- your-admin-email@example.com` setup.

1. Start `npm run dev` and sign in at `/app`. Open **Seller hub** at `/eats/sell`, choose Restaurant, Vendor or Private kitchen, and create a fictional
   kitchen with its Abuja area/address, preparation time, minimum order and delivery
   fee, then add at least one available menu item. Use **Add photo** beside a saved
   item to upload a real dish image. No restaurants are seeded automatically.
2. As the administrator, open **Seller review**, inspect the store and menu,
   record a test review reference and reason, then approve it. This is a recorded
   manual review, not a real business licence or food-safety verification.
3. As the owner, refresh **Seller hub** and choose **Open for test orders**.
4. As a separate customer, open **Taxi Ai Eats**, enter an address/landmark and
   Abuja delivery area, search for a dish, choose a kitchen, add items, then **Review total**.
   Inspect the food subtotal, delivery and service fees before **Place test order**.
5. Open the incoming order in **Seller hub**, accept it, start preparation, then mark
   it ready. Unfinished kitchen orders appear before completed history.
6. As an eligible motorcycle/car/SUV/van driver, open **Food deliveries** on the website and use its **Your availability**
   controls. On mobile, go online in **Work**, then open **Food deliveries**.
   For local simulation choose the restaurant's sample area. Keep the website page
   visible or the native app open, accept the ready order and open its details.
7. When handing over the food, the owner provides the order's six-digit pickup code
   to the assigned courier. The courier enters it to confirm collection.
8. The courier records arrival. The customer now shows a separate delivery code;
   enter it only when handing over the order, then confirm delivery. Refresh or
   restart the backend and check the saved history.

The customer can cancel before restaurant acceptance; a restaurant can decline
an unaccepted order. An administrator can cancel before collection with a reason.
After collection, this preview requires normal delivery completion; lost food,
reassignment and exceptional recovery still need an operational support workflow.

## Behaviour and ownership

- One restaurant per cart, with confirmation before replacing its items. Cart and
  unsaved form drafts live in memory; placed orders survive refresh and restart.
- Integer kobo prices come from the stored menu, never from customer totals.
  Checkout quotes expire after ten minutes. A changed menu, fee or store version
  requires a fresh quote. The service fee is 5% of food, capped at ₦1,000.
  Orders are capped at ₦200,000, with at most 20 distinct lines and 20 of each item.
- The order stores the agreed item prices, restaurant and address snapshot.
  Payment remains explicitly `test / not_charged`; food orders do not create ride
  receipts, earnings or settlement records.
- Sold-out items cannot be added to new quotes. Store owners can pause ordering;
  accepted orders remain actionable. Identity/location changes put the store back
  into review. Opening requires current approval and an available menu item.
- Menu photos are optional JPEG/PNG uploads. The server strips metadata, converts
  each image to a bounded JPEG and stores it separately from searchable menu data.
  Owners and staff can preview photos before approval; customers see only photos
  for available items from approved stores. Sellers can replace or remove a photo.
- An approved courier may hold one food delivery, ride or parcel assignment at a
  time. Claiming a food job atomically stops availability. Active food work also
  blocks vehicle changes, Work profile deletion and competing journey actions.
  Sample matching checks the restaurant's area; GPS availability currently exposes
  ready Abuja orders without route-distance ranking.
- Store membership, customer ownership and assigned courier identity are checked
  server-side. Unassigned couriers see pickup/drop-off areas and a test delivery
  fee, without the customer's street address. Store views omit that street address.
  Free-text instructions are shared with the kitchen and assigned courier.
- The pickup code is visible only to the owner while ready/assigned; the delivery
  code only to the customer after pickup. Couriers must obtain each code at the
  handover. Five wrong attempts lock verification for five minutes. Terminal
  orders clear both codes. These confirm knowledge of a code, not GPS presence.
- Version checks and actor-scoped command keys protect against competing actions
  and duplicate writes. A lost response freezes further edits and offers the same
  command retry. Account changes clear private state and discard late responses.
- Customer/store order lists paginate 50 at a time. Restaurant lists are bounded
  to 200 and courier discovery to the oldest 100 ready orders in this preview.

The `eats` backend module owns stores, scoped memberships, review evidence, menus,
quotes, orders and command results. Migration **019** adds these tables without
rewriting existing accounts or journeys. Back up before upgrading; an older server
cannot open the upgraded schema. Orders include private addresses and must be
treated as private data in backups. Expired quote/command retention and production
erasure policies still need an explicit cleanup implementation.

Migration **021** adds a separate menu-photo table without changing existing menu
items. Photos live in the same SQLite backup as stores and orders; production
storage should later move to object storage with image review, retention and
delivery caching.

Both `/api/eats/*` (cookie + CSRF) and `/api/mobile/v1/eats/*` (device bearer) call
the same service. The composition root injects shared workload and availability
ports; Eats does not import another business module's internals. Shared contracts,
money rules and the screen controller live in `packages/shared`. Native and web
views retain their own form, navigation and transport code.

## Verification and remaining release work

`npm run verify` covers HTTP ordering, permissions, quote changes/expiry,
idempotency, competing couriers, shared workload, PIN lockout, transactional rollback,
restart recovery, native authentication, pagination, stale account responses and
the shipped web form wiring. `npm run mobile:verify` checks native boundaries,
types, existing regressions and Android/iOS JavaScript exports. These do not prove
physical-device or browser layout correctness.

Before release, complete the workflow above at phone/tablet/desktop widths, with
keyboard and screen reader, and on separate Android/iOS phones against a private
hosted backend. Include offline retry, expiry, logout, wrong codes, sold-out items,
double taps and a courier attempting to take a ride while delivering food.
The available cloud browser blocks local previews, so visual/device acceptance
remains outstanding.

Further product work includes a real payment provider, refunds/payouts, verified
merchant onboarding, photo review and item modifiers, stock counts/opening hours,
tax policy, food chat and push notifications, live delivery routing/ETA/tracking,
customer support and reassignment. The initial order timeline polls while open;
it is not a live courier map or a phone alert. No food recommendation or autonomous
dispatch agent is claimed in this release.
