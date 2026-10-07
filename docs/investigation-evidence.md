# Taxi AI — case-scoped investigation exports

**Who:** Staff with both `investigations.read` and `investigations.export` (Owner by default). Other staff roles do not inherit police disclosure capability. If original driver documents are requested, the export also requires `compliance.read`.

**Where:** Admin → Transactions → open the relevant Passenger ride, Courier or Food order → **Prepare investigation evidence ZIP**. Alternatively open **Admin → Transactions → Investigation evidence**, enter a service and UUID, and load its existing record.

**Authorization:** Verify a legitimate and appropriately scoped request using an official independent contact channel, document case/reference, requesting agency, legal basis/authority reference, purpose and minimum necessary categories. A staff-entered basis is not itself proof of legal authorization. If authorization is uncertain, seek qualified legal review before release. Do not make the system send evidence automatically to police.

**Output:** One ZIP per source transaction with:

- `summary.txt`: human-readable case, recorded participant identities, time stamps, payment/fare status and location limitations.
- `case.json`: export metadata, case reference, legal-basis declaration, staff preparer and agency.
- `trip.json`: source transaction, current status, rider/sender, assigned driver/courier, assignment-time vehicle snapshot, planned booking route and timestamps, fare/food totals and available payment-provider records.
- `driver.json`: available driver account and registration information **as of export time**, current uploaded document metadata/SHA-256 and available review history. Not a reconstruction of earlier registration state.
- `locations.csv`: planned booking pickup/drop-off coordinates where saved, plus location-sharing start/end metadata. **Not the driver's actual historical GPS route.**
- `timeline.csv`: available journey state changes, dispatch offer outcomes, call signaling metadata (not audio), safety incident metadata, location-sharing sessions and available courier handover verification.
- `chat.csv`: only if chat content is explicitly requested and authorized.
- `driver_documents/`: current stored original selfie, driver's licence and vehicle-document images only if separately selected and authorized. Each document is checked against its stored SHA-256 before export; an integrity failure refuses the export.
- `README.txt`: data limitations, custody and transfer warnings.
- `manifest.json`: paths, byte lengths and SHA-256 hashes of each content file in the ZIP. The SHA-256 of the ZIP itself is in the download receipt and server export audit log.

**Limits:** 500 rows per sensitive event type, up to 8 driver documents and 15 MB ZIP. If truncated evidence would be necessary, the export fails rather than silently produce a partial record. No PINs, password hashes, login/refresh secrets, push tokens, call SDP, call recordings, raw biometric templates, continuous GPS trail or unknown historical data are fabricated/included.

**Known location limitation:** A booking quote may save coordinates and planned road geometry. These are what the user and routing provider selected at booking time, **not evidence the assigned vehicle drove that route**. The live driver/courier `position_json` is cleared on closing the share; a complete timestamped route breadcrumb history does not currently exist. Historic turn-by-turn actual positions cannot be exported until a separately designed, consented and lawfully retained evidence pipeline has been implemented.

**Integrity and handover:** The browser downloads the archive only after checking the SHA-256 against the server response. Keep the ZIP and separate hash in access-controlled encrypted evidence storage. Record each recipient/officer identity, chain-of-custody time and secure handover channel in the real case file. The receipt and archive hashes show byte integrity, not a digitally signed certificate and not proof that every source claim is true.

**Access/audit:** Exports are limited to 5 per Owner per hour. Each generated archive writes an immutable application audit event and an export receipt including staff actor, transaction, case/authority references, optional disclosure choices, timestamps, ZIP SHA-256, manifest SHA-256 and archive size. Source transaction and driver records are not mutated. Archive bytes are returned to the authorized browser and are not stored in the investigation export audit table.
