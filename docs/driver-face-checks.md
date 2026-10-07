# Automatic driver face comparison

Taxi AI compares a driver's saved selfie with the portrait on the **front** of
their licence. The production self-hosted provider is DeepFace using the SFace
recognition model and OpenCV detector. Amazon Rekognition remains an optional
adapter, but no AWS account is required for the DeepFace path.

This is **one-to-one face similarity only**. It does not establish liveness,
validate the licence with its issuer, prove document authenticity, or approve a
driver for trips. A similarity/confidence score is evidence for staff review,
not a probability of identity.

## Workflow

1. Save driver details, a clear selfie, and a readable licence front.
2. Read the provider-neutral consent and choose **Compare my face**.
3. Taxi AI decodes and re-encodes both images in memory, strips metadata, and
   sends only the normalized JPEGs to the private DeepFace container.
4. DeepFace checks that each image contains one face and compares the pair.
5. Taxi AI stores only bounded result metadata: provider, status, reason,
   confidence threshold, confidence, timestamps, and document hashes.
6. Results are **Face comparison passed**, **Staff review needed**, or
   **Comparison could not finish**. None of these automatically approves or
   rejects a driver.
7. Staff still inspect the licence, selfie, vehicle evidence, and any other
   required documents before using the audited approval action.

Edits, replaced/removed documents, reopening, and profile deletion invalidate
the current result. Existing approved drivers are not silently revoked when a
provider is enabled.

## Production DeepFace configuration

DeepFace runs on the private Docker network and exposes no host port. The app
container reaches it at the internal service origin only.

```dotenv
TAXI_DRIVER_FACE_PROVIDER=deepface
TAXI_DRIVER_FACE_DEEPFACE_URL=http://deepface:5000
TAXI_DRIVER_FACE_MODEL=SFace
TAXI_DRIVER_FACE_DETECTOR=opencv
TAXI_DRIVER_FACE_THRESHOLD=90
TAXI_DRIVER_FACE_TIMEOUT_MS=30000
```

The production Docker image is pinned by digest. Its model/cache directory is a
named volume so model weights survive restarts. SFace is selected because the
OpenCV SFace model files are Apache-2.0 licensed; DeepFace itself is MIT
licensed. Review dependency/model licences again before changing models.

Taxi AI first calls DeepFace `/represent` for each image with a two-face cap.
Zero faces returns `no_face`; more than one returns `multiple_faces`. It then
calls `/verify` using SFace/cosine distance. A match requires both DeepFace's
model-specific verified decision and Taxi AI's configured confidence threshold.
Anything uncertain becomes `needs_review`, never an automatic rejection.

## Optional AWS configuration

The legacy AWS Rekognition adapter remains available:

```dotenv
TAXI_DRIVER_FACE_PROVIDER=aws-rekognition
AWS_REGION=eu-west-1
TAXI_DRIVER_FACE_THRESHOLD=99
TAXI_DRIVER_FACE_TIMEOUT_MS=15000
```

The IAM identity requires `rekognition:DetectFaces` and
`rekognition:CompareFaces`. Never put AWS credentials in browser/mobile
configuration, Git, or `EXPO_PUBLIC_*` variables.

## Privacy and operational safeguards

- Original images stay in the existing private driver-document store.
- The provider adapter normalizes to JPEG in memory and strips EXIF/ICC metadata.
- DeepFace receives images over the private Docker network; no public DeepFace
  port is published.
- Provider errors are sanitized before they reach clients.
- Results never store embeddings or DeepFace response payloads.
- Maximum five face-comparison attempts per driver in a rolling 24 hours, with
  a cooldown and durable idempotency.
- Provider work runs outside database transactions; delayed results cannot attach
  to changed documents or a newer application version.
- A completed comparison is evidence only. Admin approval remains explicit.

Existing document storage/backups still require appropriate encryption,
retention/deletion policy, restricted reviewer access, and a reviewed privacy
notice before collecting real production identity documents.

## API

`POST /api/driver/application/face-check` and
`POST /api/mobile/v1/driver/application/face-check` take:

```json
{ "expectedVersion": 7, "consent": true }
```

with an `Idempotency-Key`. Web uses its same-origin authenticated session;
native uses its bearer session. Client-supplied scores, provider results, image
URLs, or another driver's ID are never accepted.

`application.faceCheck` returns provider availability, provider name, status,
reason, checked time, similarity/confidence, Taxi AI threshold, consent version,
and retry-after time.

Run focused provider tests plus the driver face-check workflow tests before
deployment, then perform an authorized real-image acceptance test. Do not treat
a synthetic-image or health-check result as evidence that accuracy is calibrated
for Nigerian licence photos.
