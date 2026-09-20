# Driver applications and recorded reviews

Taxi Ai now has a private application workflow for the driver and the first local
administrator. It records manual review evidence and controls access to new test
rides. It does not perform identity-provider, licence-database, biometric or
vehicle-registry checks. Use fictional documents while this remains a development
preview. The five document categories are product review requirements, not a
statement of all requirements for operating in Nigeria.

## Try the workflow

1. Start `npm run dev` and open `/app`. Create or sign in to a personal account,
   select **Apply to drive**, and add fictional car details. Continue in Work.
2. In **Your driver application**, save the legal name, international contact
   number, licence number and vehicle make/model/year/colour/plate.
3. Upload a driver photo, driving-licence image, vehicle document, insurance
   document and vehicle photo showing the plate. Only PNG/JPEG images up to 2 MiB
   each are accepted. The licence, vehicle document and insurance need expiry
   dates. Photos have no expiry date.
4. Click **Submit for review**. The submitted version is locked. **Reopen for
   changes** withdraws it; reopening an approved application pauses new rides.
5. Sign into the separate administrator account in another browser profile or
   private session. Use the [first-administrator setup](../README.md#set-up-the-first-administrator-when-needed)
   if needed; a Taxi Ai business mailbox is not required for local development.
6. Open **Review application** from the administrator queue. Download and inspect
   all five current files. For a fictional test approval, record the four manual
   checks, a test verification reference and a reason. Click **Record approval**.
   In a real process these attestations must describe checks actually performed.
7. Alternatively, request corrections or reject with a reason. The driver can
   correct the application and resubmit. Review outcomes and reasons remain in
   the private application history.
8. After approval, the driver can explicitly go online. No document upload,
   download or AI result approves an application automatically.

The browser preserves unsaved detail fields during polling. If another window
changes the application, the old form retains its old version and cannot overwrite
the new one. Copy any needed edits before choosing **Load saved details**. Saving
is required before uploading or submitting. A network retry uses the same command
key; a stale review must be reassessed against the latest version.

## State and eligibility

| Application state | Driver action | Administrator action | New ride eligibility |
| --- | --- | --- | --- |
| Draft | Save details, upload/replace/remove files, submit | Read application | No |
| Awaiting review | Reopen to edit | Inspect files; approve, reject or request corrections | No |
| Corrections requested / rejected | Correct and resubmit | Read prior outcome | No |
| Review approved | Reopen to renew/change details | Read recorded evidence | Only while documents remain current |

Approval requires complete details, all five current documents, the reviewer’s
access to every current document ID, four explicit true check flags, a verification
reference and a reason. The version, reviewer ID, server timestamp, details snapshot
and document IDs/hashes/expiry dates are recorded together in an application event.
Downloads prove access, not that a person performed a meaningful check. The prototype
trusts the administrator’s attestations; it cannot establish document authenticity.

Expiry is the exclusive end of the stated day in Abuja (UTC+1). Eligibility is
checked on going online, availability updates and matching, selecting a new request,
customer booking confirmation, and starting a trip. Expiry removes online
availability. A trip already in progress can still finish; history, earnings,
receipts and cancellation of unstarted work remain accessible. No fare changes
or payment actions happen as a side effect of application review.

Application changes/reviews are blocked during any assigned negotiation, agreed
fare awaiting booking, or unfinished trip. Finish or cancel that work first.
Approval changes future profile data; each assigned ride keeps its driver name
and vehicle snapshot, so subsequent vehicle changes do not rewrite trip history.

## Module boundaries and API

The drivers module owns rules, SQL, application events and command retries. A
small injected Node adapter handles byte decoding and hashing. Accounts exposes
only the public vehicle/status and a safe eligibility summary. Availability and
rides consume that summary; they do not read document storage. Driver contact
numbers and licence details are absent from rider peers and the administrator
queue. Only opening the authorised private application returns them.

| Method and path | Access and result |
| --- | --- |
| `GET /api/driver/application` | Applicant’s private details, metadata and recent history |
| `POST /api/driver/application/save` | Applicant; `expectedVersion`, `details` |
| `POST /api/driver/application/upload` | Applicant; version, kind, name, MIME type, base64 and expiry |
| `POST /api/driver/application/remove` | Applicant; version and current document ID |
| `POST /api/driver/application/submit` | Applicant; complete/current evidence and version |
| `POST /api/driver/application/reopen` | Applicant; withdraw/reopen the exact version |
| `GET /api/admin/drivers` | Administrator; up to 100 application summaries, submitted first |
| `GET /api/admin/drivers/:id` | Administrator; private application and current download markers |
| `POST /api/admin/drivers/:id/review` | Administrator; version, decision, reason, approval checks/reference |
| `GET /api/driver-documents/:id` | Owner or administrator; file metadata and base64 bytes |

Every command requires a session, same-origin/CSRF validation and an idempotency
key. Uploads require the driver role before reading the larger body, and session
validity is checked again after the body arrives. Commands run synchronously in
one transaction with evidence, state, events and retry keys. There are no external
calls inside that transaction. Stale/conflicting commands return 409; neither the
API nor client automatically applies a review to a newer application version.

## Upload and storage limits

- A maximum of five current files per applicant, one per category, with a 2 MiB
  limit per file and a 128 MiB cap on current document bytes across the database.
- The upload route alone accepts a JSON body up to 2,800,000 bytes for base64
  encoding; other routes keep the 16 KiB limit. Writes retain the existing
  60-per-minute account limit; document downloads have a 30-per-minute account limit.
- Extension/MIME allowlists, safe display filenames, canonical base64, image
  signatures and basic PNG dimensions are checked. This is bounded envelope
  validation, not full image decoding, content safety or malware scanning.
- Bytes are private SQLite BLOBs, never files in the static web root. Download
  requests are authorised on every access, use `no-store`, are audited without
  content and return server-generated download names. The client downloads a
  Blob as an attachment; it does not embed document HTML or provide public URLs.
- Replacing/removing a file deletes its current BLOB and reviewer access rows.
  Audit events retain document IDs/hashes and review snapshots. Deletion is not
  guaranteed secure erasure from SQLite pages, WAL files, backups or files already
  downloaded to a reviewer’s device. There is no automatic retention scheduler.
- Database files and snapshots retain restrictive filesystem permissions. They
  are not encrypted by the application. Backups include private application
  details and documents; session/media/location sanitisation does not anonymise
  those records. Keep backups outside the repository and web root.

The upload design follows the layered principles in the
[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
Before real document collection, add operated malware scanning/image validation,
encrypted storage/backups, a defined retention/deletion process, tightly managed
reviewer access and a validated manual/provider verification process. No claim of
production readiness or regulatory compliance is made by these tests.

## Upgrade and verification

Version 0.12 introduces schema 8. Before upgrading a saved database, make a backup
using the matching previous release. The migration preserves accounts, rides,
fares, messages, payments and receipts, and backfills driver/vehicle snapshots.
All existing drivers receive a **draft** application with no invented evidence.
Their old test approval does not permit new work. Unstarted legacy work must be
cancelled before they can apply; already-started trips can finish. Nothing resets
or deletes saved journeys. Current backup/restore commands require schema 12 (see [vehicle identity](vehicle-identity.md));
restore an older backup with its matching release, then upgrade a separate copy.

`npm run verify` includes HTTP workflow/privacy tests, expiry boundaries, session
revocation during upload, stale/duplicate/racing commands, rollback/restart,
corrections, historical vehicle snapshots, old-schema preservation and backup
preservation of private documents. Client/DOM fixtures check account isolation,
late uploads/downloads, stale reviews and unsaved form fields. The complete
`npm run test:journey` now submits and reviews fictional documents before matching.

Real-browser layout, file-picker/download behaviour and assistive-technology
checks remain pending. The environment’s local browser-preview block remains in
place; the Node tests are not a replacement for browser acceptance. When browser
access is available, test the workflow above at phone/tablet/desktop widths,
keyboard navigation, two independent sessions, corrections/renewals, a dropped
upload response and a logout during a pending upload. Confirm files are downloaded
only for the active authorised account and that printing a receipt excludes the
private application panel. Hosting on Alibaba Cloud remains paused.

## Mobile registration and vehicle presentation

Release 0.16 brings the full owner application to iOS/Android using the same
manual review service, versions and idempotency records. Approved make, model,
year and colour now accompany the plate in new trip snapshots. Private document
images are not customer-facing artwork. See [vehicle identity](vehicle-identity.md)
for the shared cards, illustration limits and cross-device acceptance checklist.
