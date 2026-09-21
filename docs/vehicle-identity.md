# Vehicle identity and guided registration

For the current account edit entry points, arrival identity notices and different
vehicle reporting, see [pickup identity](pickup-identity.md).

Release 0.17.0 / mobile 0.2.2 adds schema 12 to save the initial vehicle selection
before a driver's personal details are complete. It preserves existing records and
approvals. The web and native app use one driver application and the same
server decisions. Use fictional information and images in the development preview.

## Included

- Website `/app` → **Apply to drive** opens **Choose your car**, with make, year,
  model and colour dropdowns immediately, a typed plate and a live colour preview.
  **Continue to driver application** saves the selection, opens Work and pre-fills
  the full application. Saved selections survive refresh and can be continued on
  mobile. Cancelling clears only the unsaved form; polling preserves edits.
- Web and native Work → driver application: Details, Documents and Review, with
  make, year, model and colour dropdowns, number plate, legal name, international
  contact number and licence number. Changing make clears the previous model.
  Other / not listed opens an explicit custom make, model or colour field.
  The starter list covers twelve makes; it is not exhaustive and does not claim
  factory model-year/trim coverage. Documents and manual review establish identity.
- Years run from 2000 through the current UTC calendar year, newest first. Shared
  rules power both interfaces; the server validates saves, submissions and approvals
  using its clock. Older saved records remain readable and historical trips remain
  unchanged. An old draft or reopened application needs a year that meets the policy;
  existing approvals are not retroactively revoked by this update.
- In-app selection of PNG/JPEG files through the system document picker, preview,
  private upload, replacement, removal, expiry dates, submission, review reason and
  reopening. Administrators still inspect evidence and record decisions on web.
- Shared vehicle presentation on the web application, private review, Work profile,
  selected journey and native Work/activity. The web driver map marker uses that
  journey's colour illustration only when a driver-reported position is available.
  No synthetic movement, heading or live-location claim is added.
- Responsive cards with preserved image aspect ratios and a large text plate.
  Realistic front three-quarter PNG cutouts follow the supplied SUV reference,
  with ten separately generated sedan paint variants. Identical 768×512 assets
  are served locally on web and bundled for native. Layout contains the entire
  vehicle without stretching or cropping. Unknown/custom/two-tone colours use white fallback artwork with an
  explicit mismatch note. See [icon provenance and prompts](design/vehicle-icons.md).
- Home, Activity, Work and Account native tabs with consistent vector icons.

**Current artwork is a generic perspective illustration, not a GLB model or an
exact make/model match.** This is explicitly labelled in every vehicle card. Ten
solid colours are approximate screen representations, not exact paint codes. No
model-specific assets, public vehicle photos, automatic visual verification or
rotatable 3D viewer are claimed in this milestone.

## Data and review boundaries

| Data | Meaning and visibility |
| --- | --- |
| `application.vehicle` | Owner/admin resolved vehicle: saved complete details, otherwise initial selection, otherwise legacy model/plate; not an approval |
| `driver_vehicle_selections` | Initial structured choice persisted with profile creation; removed atomically when complete application details are saved |
| `application.details.vehicle` | Owner/admin editable make, model, year, colour and plate; never used as public approval by itself |
| `driver.vehicle.model` / `plate` | Existing display-model and plate fields, retained for older clients |
| `driver.vehicle.make`, `modelName`, `year`, `colour` | Added only from the currently approved application; no contact/licence/document data |
| `ride.driver.vehicle` | Copied when a driver claims the request; future changes do not rewrite historical vehicle identity |
| Document images | Private evidence, accessible only through the existing owner/admin document workflow; never used as public card/map imagery |

The repository joins only an approved application's details into the approved
profile. Reopening immediately pauses eligibility for new work. While a draft is
being edited, its new colour/model/plate cannot replace the public approved
identity. Old profiles without structured fields and old trip snapshots continue
to display their original model/plate without inventing a colour or year.

The native owner projection omits reviewer identity, audit events, verification
references, hashes and document bytes. Existing native `/driver/application`
summary clients continue working; the new app reads `/driver/onboarding` and
writes `/driver/application/{save,upload,remove,submit,reopen}`. There is no native
administrator or document-download route.

Commands carry the displayed application version and a unique retry key. A stale
form is preserved with a request to load/review saved details; it never silently
rebases onto a newer version. Duplicate taps are blocked, token refresh retries
retain the same command body/key, and account/navigation changes discard late
results. Upload reads recheck device authorization before any write.

Initial enrollment uses the same year/plate validation as the full application.
Its retry fingerprint includes make, model, year, colour and plate. Legacy
model/plate-only clients keep their existing request and retry behaviour. Schema
12 adds an empty table without modifying existing records. Back up saved data
using the previous release before upgrading. Release 0.18 adds reporting indexes;
current backup/restore requires schema 16.

Uber's [eligible vehicle catalogue](https://www.uber.com/us/en/eligible-vehicles/)
documents model/year eligibility and local requirements. The guided selection
pattern is useful here, but Taxi Ai's starter catalogue and 2000-onwards policy
are its own; they do not reproduce Uber's city-specific eligibility rules.

## Native file and lifecycle handling

The system picker copies a user-selected file into the app's cache. The file
adapter checks type and the existing 2 MiB limit before reading it, uses a portable
filename, and removes the cache copy in a `finally` block. Original device files
are not removed. The selected image is held in memory until upload, clearing,
navigation or account change. Nothing is placed in the session vault. A process
crash can interrupt cleanup; the OS cache lifecycle still applies. HEIC/PDF/SVG
are not accepted in this milestone; the interface explains the JPEG/PNG requirement.

The background privacy cover conceals the mounted navigation stack instead of
unmounting it. This is necessary for a system picker to return to the same form.
A foreground return still verifies the session before revealing account screens.
This behaviour needs the physical-device review below.

## Exact-model visual catalogue: next asset milestone

The make/model dropdowns and generic artwork must not be described as an exact
vehicle model catalogue. Exact matches need acquired assets and visual review:

1. Build a licensed or commissioned catalogue keyed by make, model, generation,
   applicable year range, body/trim and market variant. Record licence/provenance,
   asset version, review status and colour/render coverage. Start with the actual
   pilot fleet; do not claim coverage for every car a driver can enter.
2. Check each model against reference photos, then create compressed GLB source
   assets and cached card/top-view renders. Package trusted renders for both native
   and web; keep network/cache failures away from booking decisions. See the
   [Khronos format reference](https://www.khronos.org/gltf/).
3. Add a curated resolver that requires an approved match and colour variant.
   Unknown/ambiguous years, trims or custom paint retain a labelled fallback.
   Do not accept arbitrary asset URLs or an asset ID supplied by the driver as proof.
4. Collect a separate, explicitly approved customer-facing photo if real vehicle
   photography is added. Strip location metadata and use separate access/storage
   rules. Do not republish the private evidence upload or registration papers.
5. Keep the exact approved plate as text. Any plate texture in a future 3D view must
   be generated deterministically from that record. AI must not invent plate text
   or grant identity approval. Optional photo/OCR assistance can suggest corrections
   for confirmation and human review.

Future motorcycle delivery, robotaxi concept assets, live native maps and an
optional interactive 3D viewer remain separate features. A driver application here
continues to apply only to the existing passenger-car review flow.

## Acceptance

Automated coverage exercises native submission through web review, cross-device
stale edits, same-key replay, role/owner isolation, upload bounds and mid-upload
revocation, reapproval, immutable trip snapshots, private-field omission, unsafe
visual inputs, colour fallback, website map consent/staleness and shared asset
consistency. Native checks cover contracts, forms, cache cleanup, retry semantics,
TypeScript boundaries and both platform bundle exports.

Manual review required before a pilot:

- Start with a customer-only account on web. Select **Apply to drive**, choose a
  car and continue. Confirm all five vehicle fields carry into the application,
  survive a refresh and appear on mobile with the same login. Personal details
  must still be completed and documents reviewed before accepting rides.
- On iOS/Android phones and tablets, sign in with the same web account. Enter both
  listed and unlisted models, custom colours, long plates and large text. Change make
  after choosing a model; the model must clear. Check the 2000/current-year boundaries.
- Test portrait/landscape, keyboard reachability, VoiceOver/TalkBack, step navigation
  and background privacy. Native dropdown sheets must close on backgrounding and
  Android Back without changing the selected value. Open/cancel the system picker, choose a file, background
  and resume: the form and selected file should survive while the account stays valid.
- Test valid JPEG/PNG, HEIC rejection, oversized files, expired documents, replacement,
  network loss, retry and logout/revocation while the picker or upload is pending.
- Save another version on web while mobile has unsaved edits. Mobile must reject
  the stale write and require an explicit reload/review.
- Submit on mobile; inspect all documents and approve on web. Check the native Work
  card and a new trip's vehicle. Reopen to change colour/plate: new work must stop,
  and a completed trip must keep the previous details after reapproval.
- Inspect browser layouts at narrow phone, tablet and desktop widths. Artwork must
  stay contained; the plate must wrap rather than disappear. The map car must only
  appear with reported GPS and retain a last-known indication when stale.

This workspace has not run an iOS/Android simulator or signed binary, and browser
visual inspection remains unavailable. Bundle/DOM checks and the standalone PNG
asset review are not a substitute for device or browser acceptance.
