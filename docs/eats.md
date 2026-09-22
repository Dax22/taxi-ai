# Taxi Ai Eats

Release 0.25.0 / mobile 0.9.0 adds home kitchens, small-batch menus, meal photos and customer pickup to the same Taxi Ai accounts,
website and iOS/Android app. This is a development preview with fictional stores
and test orders. Checkout never collects money and does not dispatch a real delivery.
It is a Taxi Ai workflow, with no DoorDash service or API dependency.

## Entry points

| Task | Website | Mobile app |
| --- | --- | --- |
| Browse, menu, cart and checkout | `/eats` | Home → Taxi Ai Eats |
| Customer order history | `/eats?screen=orders` | Activity → My food orders |
| Restaurant/home-kitchen settings, menu and kitchen orders | `/eats?screen=store` | Account → My store |
| Courier collection and delivery | `/eats?screen=work` | Work → Food deliveries |
| Staff approval | `/eats?screen=review`, also linked in `/admin` | Staff uses the website |

My store is an account-scoped workspace. It does not grant a public administrator
role or change Customer/Work permissions. The first version supports one owner
and one store per personal account. Staff invitations and multiple branches are future work.

## Home kitchens and discovery

The DoorDash reference informed the address-first hero, cuisine browsing, kitchen
cards, delivery/pickup choice and merchant entry point. Taxi Ai keeps its own
branding and original food artwork; there is no DoorDash integration or dependency.
Reference pages: [DoorDash](https://www.doordash.com/),
[DoorDash's official iPhone app listing and screenshots](https://apps.apple.com/us/app/doordash-food-grocery-more/id719972451), and
[DoorDash merchant marketplace](https://merchants.doordash.com/en-us/products/marketplace).
No ratings, sales, promotions or operating merchants are invented.

Mobile discovery puts delivery/pickup, the address, search and horizontal cuisine
and kitchen-type filters ahead of the listings. **Home kitchens** and **Sell from
home** are directly accessible. Extra area/sort controls expand under **Filters**;
the compact food banner retains Taxi Ai's yellow identity. There is no DoorDash
asset, SDK, account or API requirement.

On web choose **Sell from home**; on mobile use **Eats → Sell from home** or
**Account → Sell from home**. Choose **Home kitchen**, enter a kitchen name, story,
Abuja area and private pickup address, then choose delivery, customer pickup or
both. Add the menu, record remaining portions and complete staff review before
opening. The owner can close to new orders whenever they are not cooking.
This version uses manual opening controls; recurring opening hours, scheduled
orders, permits/licensing checks and seller payouts are not implemented.

Each menu item supports a description, allergen notes, price, available/hidden
status, batch count and optional photo. Home kitchens require a count from 0–1,000;
restaurants may leave it blank for unlimited portions. Saving a menu item starts
a new batch count. Remaining stock is reserved when the order is placed, inside
the same transaction as the order and retry record. Competing quotes cannot
oversell it. Cancel/decline before preparation restores stock once if the batch
has not been replaced; prepared food is not restored. Stock changes update the
store version, so another checkout or dirty seller form must refresh first.

Meal photos must be JPEG/PNG, up to 2 MiB and 16 megapixels, at least 160 × 120.
The API fully decodes, rotates, resizes and re-encodes to JPEG; EXIF/GPS is removed.
Photos are accessed through authenticated, store-scoped endpoints. Only approved,
available menu photos appear to customers; superseded unreferenced photos are
removed. Photo processing runs outside the database transaction, with a fresh
session/membership/version check before saving. In-flight photo replies are
cleared on account changes. The hero is labelled as general food illustration.

Customers can filter by cuisine, kitchen type, kitchen area, open state and order
option, then sort by name, preparation time or delivery fee. Open kitchens are
shown first. These are deterministic filters, not an AI recommendation agent.
Kitchen-area filtering is not a guarantee of delivery range or a live ETA.
Web and native use the same font policy as the rest of Taxi Ai: system-ui on web,
System on iOS and sans-serif on Android.

## Home address and pickup rules

| Viewer/stage | Home-kitchen street address | Handover code |
| --- | --- | --- |
| Browsing, menu, quote or unclaimed courier job | Hidden; Abuja area only | Hidden |
| Delivery customer | Hidden throughout | Delivery code after courier pickup |
| Pickup customer, waiting for acceptance | Hidden | Hidden |
| Pickup customer, accepted/preparing | Visible | Hidden |
| Pickup customer, ready | Visible | Customer pickup code |
| Assigned courier, active delivery | Visible | Must ask at handover |
| Kitchen owner / administrator | Visible | Owner sees courier pickup code for delivery; neither sees customer code |
| Customer/courier after completion/cancellation | Hidden again | Cleared |

Customer pickup is opt-in for the seller and has a zero delivery fee; the service
fee still applies to the test subtotal. The kitchen accepts, prepares and marks
the order ready. The customer sees a six-digit code; the kitchen enters it only
when handing over the food. The order then completes without courier assignment.
Five wrong attempts cause the same five-minute lockout as a courier handover.
Pickup orders never appear in the courier queue. Keep street addresses out of
public kitchen names/descriptions, meal photos and allergen notes; free-text
fields are seller-published content and are not automatically redacted.

## Try a complete test order

Use independent browser profiles or devices for the customer, store owner,
approved driver and administrator. Ordinary tabs share the same web login.
Existing accounts and driver approvals can be reused. For the first administrator,
follow the root README's `npm run admin -- your-admin-email@example.com` setup.

1. Start `npm run dev` and sign in at `/app`. Open **My store**, create a fictional
   kitchen with its Abuja area/address, preparation time, minimum order and delivery
   fee, then add at least one available menu item. No restaurants are seeded automatically.
2. As the administrator, open **Kitchen review**, inspect the store and menu,
   record a test review reference and reason, then approve it. This is a recorded
   manual review, not a real business licence or food-safety verification.
3. As the owner, refresh **My store** and choose **Open for test orders**.
4. As a separate customer, open **Taxi Ai Eats**, choose a kitchen, add items,
   enter an address/landmark and Abuja delivery area, then **Review total**.
   Inspect the food subtotal, delivery and service fees before **Place test order**.
5. Open the incoming order in **My store**, accept it, start preparation, then mark
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
  Checkout quotes expire after ten minutes. A changed menu, batch count, fee or store version
  requires a fresh quote. The service fee is 5% of food, capped at ₦1,000.
  Orders are capped at ₦200,000, with at most 20 distinct lines and 20 of each item.
- The order stores the agreed item prices, restaurant and address snapshot.
  Payment remains explicitly `test / not_charged`; food orders do not create ride
  receipts, earnings or settlement records.
- Sold-out items cannot be added to new quotes. Store owners can pause ordering;
  accepted orders remain actionable. Identity/location changes put the store back
  into review. Opening requires current approval and an available menu item.
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
- Customer/store order lists paginate 50 at a time. Kitchen lists are bounded
  to 200 and courier discovery to the oldest 100 ready orders in this preview.

The `eats` backend module owns stores, scoped memberships, review evidence, menus,
quotes, orders, normalized meal photos and command results. Migration **019** adds
Eats storage; **020** adds photos and backward-compatible restaurant/menu defaults.
Existing accounts, journeys and food orders are preserved. Back up before upgrading; an older server
cannot open the upgraded schema. Orders include private addresses and must be
treated as private data in backups. Expired quote/command retention and production
erasure policies still need an explicit cleanup implementation.

Both `/api/eats/*` (cookie + CSRF) and `/api/mobile/v1/eats/*` (device bearer) call
the same service. The composition root injects shared workload and availability
ports; Eats does not import another business module's internals. Shared contracts,
money rules and the screen controller live in `packages/shared`. Native and web
views retain their own form, navigation and transport code.

## Verification and remaining release work

`npm run verify` passes 449 tests and checks 266 JavaScript modules. It covers HTTP ordering, permissions, quote changes/expiry,
idempotency, competing couriers, shared workload, PIN lockout, transactional rollback,
restart recovery, native authentication, pagination, stale account responses and
the shipped web form wiring, home-address projections, finite stock, pickup
lockout and restart, schema 19 upgrades, and native meal-photo/pickup flows. `npm run mobile:verify` checks native boundaries,
types, all 73 mobile tests and Android/iOS JavaScript exports. These do not prove
physical-device or browser layout correctness.

Before release, complete the workflow above at phone/tablet/desktop widths, with
keyboard and screen reader, and on separate Android/iOS phones against a private
hosted backend. Include offline retry, expiry, logout, wrong codes, sold-out items,
double taps and a courier attempting to take a ride while delivering food.
The available cloud browser blocks local previews, so visual/device acceptance
remains outstanding.

Further product work includes a real payment provider, refunds/payouts, verified
merchant onboarding, item modifiers and scheduled opening hours,
tax policy, food chat and push notifications, live delivery routing/ETA/tracking,
customer support and reassignment. The initial order timeline polls while open;
it is not a live courier map or a phone alert. No food recommendation or autonomous
dispatch agent is claimed in this release.

## View this branch without disturbing your current local edits

From your existing `taxi-ai` checkout:

```sh
git fetch origin
git worktree add -b preview/home-kitchens ../taxi-ai-home-kitchens origin/feat/home-kitchens
cd ../taxi-ai-home-kitchens
npm ci
PORT=3001 npm run dev
```

Open `http://localhost:3001/eats`. This new worktree uses a separate local database,
so create test accounts and a kitchen or use a supported backup/restore workflow.
If port 3001 is occupied, choose another free port. Do not reset or discard the
changes in your existing checkout. If the preview branch/directory already exists,
return to it instead of creating it again.

For mobile, in another terminal inside that worktree:

```sh
npm --prefix apps/mobile ci
npm run mobile:start
```

Use the existing mobile setup guide to set the backend URL reachable by the phone.
A physical phone cannot use the computer's `localhost` address. Local commands do
not deploy the private backend or publish a native app-store build.
