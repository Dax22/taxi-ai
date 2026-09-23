# VS Code and slider integration

This merge combines checkpoint `8b9d077` (`backup/vscode-checkpoint-saved`)
with slider commit `961567c` (`feat/homepage-service-slider`). Both histories
remain parents of the published merge commit. The checkpoint branch is unchanged.

The homepage retains the latest slider: clear imagery, reduced height, no gap
below navigation, no headline or supporting paragraph, and **Book a ride**.
The local Manrope fonts, original food artwork, seller entry page, Kemmy guidance,
ratings, native registration, role setup and payments remain. Booking supports
both explicit current-location pickup and searchable pickup for guest passengers.
Nationwide locations, private collection points, meal baskets, batch portions,
guest ride consent and revocable guest links are preserved.

## Database upgrades

The branches independently used migration numbers 20 and 21. The combined schema
is version 25. Migrations 20–23 retain the slider branch's kitchen, checkout,
guest ride and nationwide tables. Driver ratings and item-based photo storage
are now migrations 24 and 25.

Opening an old checkpoint database first identifies its actual tables and column
signatures. Its rating and photo rows are retained; missing feature tables are
added in a transaction. Legacy seller types map to the current kitchen types.
Existing menu photos gain canonical photo IDs without deleting their original
bytes or versions. Private collection details in order snapshots are retained
for authorized handovers. Unknown legacy layouts fail without applying a partial
migration. Upgrade tests cover both checkpoint schemas and slider schemas 20–23,
foreign keys, repeat startup and failure rollback.

Stop local development servers before changing branches. If the current checkout
has saved data, back it up with its current code **before** starting the integrated
server. For the paused merge, first return to the saved checkpoint:

```sh
cd /Users/dapo.ogunnaike/taxi-ai
git merge --abort
```

If you made manual edits after starting that merge, save copies of those edits
before aborting. The pushed checkpoint contains the original VS Code work.
When using the default database and it exists:

```sh
npm run backup -- "$PWD/backups/before-vscode-slider-$(date +%Y%m%d-%H%M%S).sqlite"
```

Then bring in the completed merge:

```sh
git fetch origin
git merge --ff-only origin/integration/resolved-vscode-slider
npm ci
npm --prefix apps/mobile ci
npm run dev
```

The fast-forward command stops if local commit history has changed; it does not
replace those commits. Do not downgrade an upgraded database with old code. Use
a preserved pre-upgrade backup if you need to return to the older app.

## Validation

Run `npm run verify` for module checks and shared, browser-controller and API tests.
Run `npm run mobile:verify` for native checks, types, tests and iOS/Android exports.
Bundle exports do not replace device acceptance. Responsive browser layout and
installed-device checks remain necessary before release; this branch is not a
production deployment.
