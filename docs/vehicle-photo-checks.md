# AI vehicle photo checks

The rider can now take or choose a vehicle photo from a confirmed journey on web,
Android and iOS. After previewing it and agreeing to send it to OpenAI, the rider
gets an automatic comparison against the approved vehicle record saved for that
trip. This feature is optional and disabled until configured. Manual comparison,
pickup PINs, cancellation and reporting continue to work without it.

## What the check does

1. The native camera/photo picker or web file input supplies one user-selected
   image. Clients resize it; the server accepts JPEG/PNG up to 2 MiB, decodes it
   with a 16-megapixel limit and a three-second processing timeout, rejects tiny or malformed inputs, rotates it
   using orientation metadata and re-encodes it without EXIF/GPS metadata.
2. The OpenAI Responses adapter extracts a plate, make, model, body type and
   colour with a strict structured schema. The expected plate, driver identity,
   route, documents, GPS and PIN are **not sent**. Instructions embedded in the
   photo are untrusted. No tools or autonomous account actions are available.
3. Server rules compare the observation to the trip's immutable vehicle snapshot.
   Plates ignore case, spaces and hyphens, but never substitute O/0, I/1 or other
   lookalike characters. Unclear/absent/multiple vehicles produce an inconclusive
   result. Unknown paint colours remain unknown. Model/trim text is informational;
   it is not treated as a reliable mismatch signal.
4. A readable matching plate yields **Plate appears to match** unless a clearly
   observed make, category/body type or supported colour differs. A difference
   yields **Possible different vehicle**, with expected and observed values.
   An unreadable plate without a clear difference is **Photo is inconclusive**.
   No model-generated numeric confidence is presented as a measured probability.
5. **Report concern with this result** opens the existing safety form. Submission
   is separate and explicit. The server checks result ownership, trip and expiry
   before copying the comparison into the private incident snapshot for review.
   A classification alone does not create an incident, suspend a driver, change
   an approved vehicle, cancel a trip, charge money or dispatch emergency services.

This is AI-assisted photo comparison, not vehicle authentication or an agent that
controls the trip. A plate can be cloned, an image can be old or manipulated, and
vision can misread characters or appearance. A possible match is not permission
to board. Riders must compare the actual car and driver before sharing their PIN.
The driver-registration evidence remains under the existing manual review process;
private registration photos are not automatically sent to an AI provider.

## Activation

Set these **only on the backend** (local `.env`, or staging secrets/environment):

```dotenv
TAXI_AI_VEHICLE_VISION_MODE=openai
TAXI_AI_VEHICLE_VISION_API_KEY=<project API key>
TAXI_AI_VEHICLE_VISION_MODEL=gpt-4.1-mini-2025-04-14
```

Keep the API key out of source control, mobile configuration, `EXPO_PUBLIC_`
variables and browser code. `off` makes no provider requests. `npm run config:check`
validates settings without printing or exercising the key. The server uses the
fixed HTTPS Responses endpoint, rejects redirects and caps each call at 20 seconds
and 500 output tokens. Select another compatible vision/structured-output model
only after evaluating it. Configure provider project spending limits as well.

Install dependencies with `npm ci` and `npm --prefix apps/mobile ci`. The native
app adds `expo-image-picker` and `expo-image-manipulator`; **rebuild and reinstall
the device app** for the camera permission/plugin to take effect. Camera access
is requested only after pressing Take vehicle photo. Audio and background-location
permissions remain blocked. The browser account page permits its own camera;
other pages do not. A browser can offer a file picker instead of live capture.

Schema 18 is applied by the normal migration runner. It adds one table and indexes
without modifying trip or approval records. Back up persistent databases using the
existing procedure before upgrading; reverting application code cannot read a
newer schema. No live deployment or credentials are included in this change.

## Privacy, lifetime and failure behaviour

- Taxi AI does not store submitted images in its database, logs or file storage.
  Native picker/manipulator cache copies are removed after reading; device originals
  are untouched. A selected preview exists in screen memory until sent, cleared or
  navigation/logout. Browser canvas previews need no public image URL.
- Results, expected fields, a request fingerprint, consent version and model ID are
  stored for up to 24 hours. API reads and regular maintenance delete expired rows;
  maintenance resumes when the server is running. Existing database backups may
  contain earlier result rows and follow the backup retention policy. An explicitly
  attached comparison remains with the safety incident under its retention policy.
- Provider requests use `store: false`. This does **not** promise zero provider
  retention; review the provider's project data controls before enabling the feature.
- Access is rider-owned and session-checked before and after asynchronous decoding
  and provider I/O. A revoked session cannot receive a late result. If pickup ends
  during analysis, a new positive comparison is discarded. Previously saved results
  are marked historical after five minutes or once pickup ends.
- An account/request key reserves one persisted job before provider I/O. Concurrent
  retries with that key return the same pending/result row without another call;
  changed payloads cannot reuse it. A lost reply is recovered with GET. No automatic
  provider retries occur. Pending rows expire after 60 seconds, including after a
  crash; the photo is not retained for background reprocessing. Keys expire with
  their result after 24 hours.
- The database limits requests to five per rider/trip/hour, ten per rider/hour,
  100 globally/hour and two pending checks globally. These are cost/memory bounds,
  not a production capacity promise. Provider errors/refusals/malformed outputs
  produce **Photo check unavailable**, never a fabricated match.

## Validation and remaining acceptance

Automated tests use synthetic image pixels and mocked model observations to verify
real image decoding/metadata removal, conservative comparison, web/native access,
consent, idempotency/concurrency, session revocation, cancellation, limits,
restart/migration, expiry, report attachment and screen/account resets. These
tests are **not a measurement of live model recognition accuracy**.

Before enabling for riders, evaluate a consented labelled photo set from the target
market, including Nigerian plate formats, motorcycles, vans, trucks and SUVs;
day/night, glare, blur, occlusion, small plates, O/0 and I/1; multiple cars, colour
variants, wrong vehicles and matching plates on different cars. Report the confusion
matrix, false-match and false-warning rates, unreadable/abstention rate, latency and
cost separately. Define acceptance thresholds before scoring. Keep repeated cars
and photos from the same capture out of both tuning and evaluation splits.

Signed Android/iOS device checks remain required: first permission request/denial,
camera return through session revalidation, photo-library cancellation, large HEIC
input converted to JPEG, long/large text, offline/lost replies, logout during
analysis and explicit result reporting. Browser visual acceptance, live provider
accuracy/latency and deployment remain pending.

Official references: [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision),
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[model snapshot](https://developers.openai.com/api/docs/models/gpt-4.1-mini),
[provider data controls](https://developers.openai.com/api/docs/guides/your-data),
[Expo image picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[image manipulation](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/)
and [Sharp output metadata defaults](https://sharp.pixelplumbing.com/api-output/).
