# Automatic driver face comparison

Taxi AI compares a driver's saved selfie with the portrait on the **front** of
their licence using Amazon Rekognition. Web, iOS and Android share the same
private backend result. The provider is off by default; no AWS account is created
and no paid service is activated by installing this change.

This checks facial similarity only. It does not establish liveness, validate the
licence with its issuer, prove document authenticity or approve a driver for
trips. A similarity score is not a probability of identity. Existing document
review and staff approval remain required.

## Workflow

1. Save driver details and the five required documents. Use a clear selfie and a
   readable licence front. Native apps offer front/rear camera capture and image
   selection. Supported mobile browsers receive a camera hint; desktop browsers
   use a file picker. Camera capture is not a liveness check.
2. Read the consent naming Amazon Rekognition, enable consent and choose
   **Compare my face**. Uploading, opening or polling an application never starts
   a provider call.
3. The server validates and re-encodes both images, removes metadata, checks for
   one face in each and compares them. No face collection, search or S3 bucket is
   used by this integration.
4. Results are **Face comparison passed**, **Staff review needed**, or
   **Comparison could not finish**. Uncertain results are not automatic rejection.
5. When configured, submission and approval require a completed current attempt.
   Recorded provider failure also permits staff review, not a fabricated match.
   Staff still inspect all documents and record checks, a reference and reason.
   Approval evidence includes the current face-comparison result.

Edits, replaced/removed documents, reopening and profile deletion invalidate the
current result; submission retains it. On first enabling the provider, already
submitted applications without a check need reopening/corrections and another
submission. Existing approved applications are not silently revoked by enabling
the provider; renewals/reviews use the current workflow.

## Configure the server

Install dependencies with `npm ci`. In the private server environment set:

```dotenv
TAXI_DRIVER_FACE_PROVIDER=aws-rekognition
AWS_REGION=eu-west-1
TAXI_DRIVER_FACE_THRESHOLD=99
TAXI_DRIVER_FACE_TIMEOUT_MS=15000
```

The region is an example, not a Nigerian data-residency claim. Choose a processing
region appropriate for your data policy. Credentials use the AWS SDK default
credential chain: preferably the server's IAM role, or a private named profile
(`AWS_PROFILE`) for local development. Never put AWS credentials in browser code,
mobile configuration, `EXPO_PUBLIC_`, Git or chat.

The IAM identity needs `rekognition:DetectFaces` and `rekognition:CompareFaces`.
These operations use `Resource: "*"`, not a bucket or collection ARN; restrict
actions and processing region to the deployment's needs. Run
`npm run config:check`, then restart the backend. This check makes no paid calls
and does not validate credentials, IAM access or connectivity.

The threshold is configurable from 90–100, default 99. This initial policy is
**not calibrated for Nigerian licence portraits**. Evaluate false matches and
false non-matches with representative, consenting testers before production.
Timeout is 1,000–30,000 ms; clients allow 45 seconds for provider, image and DB work.

## Costs and protections

- At most three billable AWS calls per attempt: two face detections and one
  comparison. Unsuitable images stop processing early; the SDK makes no automatic
  retries. A timeout may still have incurred a charge.
- Maximum five attempts per driver in a rolling 24 hours, with a 60-second
  cooldown, including across edits/restarts. Configure AWS billing alerts before
  public rollout.
- Durable idempotency reservation prevents duplicate calls for the same request
  key. Provider work happens outside database transactions. Finalization checks
  the reserved application version and both image IDs/hashes; delayed results
  cannot approve changed evidence. Stuck pending attempts become unavailable
  after 60 seconds.
- Results are private to the applicant and authorised application reviewers.
  Raw provider responses, facial landmarks, image bytes and AWS error bodies are
  not written to logs. The new table stores consent version/time, document
  references/hashes and limited result metadata, without a second image copy.

Existing document storage and backups are **not encrypted by the application**
and there is no automatic retention scheduler. Before collecting real documents,
operate encrypted storage/backups, retention/deletion, restricted reviewer access
and a reviewed consent/privacy notice covering the provider's processing and
retention terms. These existing production prerequisites remain outstanding.

## API and migration

`POST /api/driver/application/face-check` and
`POST /api/mobile/v1/driver/application/face-check` take
`{ "expectedVersion": 7, "consent": true }` and `Idempotency-Key`. Web uses its
same-origin session and CSRF token; native uses its bearer session. Both
reauthenticate before returning private results. Client-supplied scores, image
URLs, another driver's ID or provider results are not accepted.

`application.faceCheck` supplies availability, provider, status, reason, checked
time, similarity/threshold, consent version and retry-after timestamp. This never
changes the driver application's status to approved by itself.

Back up before updating. SQLite migration 37 applies on startup; PostgreSQL
migration 9 requires `npm run db:postgres:migrate` before deploying updated API
instances. Existing journeys and documents are preserved.

Automated tests use generated images and injected provider responses without
live AWS calls. Complete real-device camera tests, browser acceptance and an
authorised live-provider test before real onboarding.

References: [CompareFaces](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html),
[DetectFaces](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html),
[AWS pricing](https://aws.amazon.com/rekognition/pricing/).
