import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readDriverFaceConfig } from '../src/infrastructure/driver-face-config.mjs';
import { normalizeDriverFaceImage } from '../src/infrastructure/driver-face-image.mjs';
import { createDriverFaceProvider } from '../src/infrastructure/driver-face-provider.mjs';

const config = readDriverFaceConfig({ TAXI_DRIVER_FACE_PROVIDER: 'aws-rekognition', AWS_REGION: 'eu-west-1' });
const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#cccccc' } }).png().toBuffer();
const input = { licenceContent: photo, selfieContent: photo };
const detection = (count = 1, confidence = 99.9) => ({ FaceDetails: Array.from({ length: count }, () => ({ Confidence: confidence })) });
const comparison = (similarity = 99.5) => ({ SourceImageFace: { Confidence: 99.9 },
  FaceMatches: [{ Similarity: similarity, Face: { Confidence: 99.9, Landmarks: [{ private: 'not returned' }] } }], UnmatchedFaces: [] });
function harness(replies = [detection(), detection(), comparison()], options = config) {
  const calls = [];
  const client = { async send(command, requestOptions) {
    calls.push({ name: command.constructor.name, input: command.input, requestOptions });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  } };
  return { calls, provider: createDriverFaceProvider({ config: options, client }) };
}

test('face provider is off by default and rejects invalid provider, region, threshold, and timeout config', async () => {
  assert.equal(readDriverFaceConfig({}).provider, 'off');
  assert.equal(config.threshold, 99);
  assert.equal(config.timeoutMs, 15_000);
  for (const values of [
    { TAXI_DRIVER_FACE_PROVIDER: 'untrusted' },
    { TAXI_DRIVER_FACE_PROVIDER: 'aws-rekognition' },
    { TAXI_DRIVER_FACE_PROVIDER: 'aws-rekognition', AWS_REGION: 'https://untrusted.invalid' },
    ...['89.99', '100.01', '-1', 'NaN', '99invalid', '1e2', 'Infinity'].map((TAXI_DRIVER_FACE_THRESHOLD) => ({ TAXI_DRIVER_FACE_THRESHOLD })),
    ...['999', '30001', 'invalid'].map((TAXI_DRIVER_FACE_TIMEOUT_MS) => ({ TAXI_DRIVER_FACE_TIMEOUT_MS })),
  ]) assert.throws(() => readDriverFaceConfig(values));
  assert.equal(readDriverFaceConfig({ TAXI_DRIVER_FACE_THRESHOLD: '99.7' }).threshold, 99.7);
  const { provider, calls } = harness([], readDriverFaceConfig({}));
  assert.equal(provider.enabled, false);
  await assert.rejects(provider.compare(input), /unavailable/);
  assert.equal(calls.length, 0);
});

test('face image decoding strips metadata and rotates orientation before sending private image bytes', async () => {
  const tagged = await sharp(photo).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const normalized = await normalizeDriverFaceImage(tagged);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 320);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.orientation, undefined);
});

test('face comparison requires one detected face in each image and returns only the minimal match result', async () => {
  const { provider, calls } = harness();
  assert.deepEqual(await provider.compare(input), { provider: 'aws-rekognition', threshold: 99,
    status: 'matched', reason: 'matched', similarity: 99.5 });
  assert.deepEqual(calls.map((call) => call.name), ['DetectFacesCommand', 'DetectFacesCommand', 'CompareFacesCommand']);
  assert.deepEqual(calls[0].input.Attributes, ['DEFAULT']);
  assert.equal(calls[2].input.SimilarityThreshold, 99);
  assert.equal(calls[2].input.QualityFilter, 'AUTO');
  assert.ok(calls[0].input.Image.Bytes instanceof Uint8Array);
  assert.deepEqual(calls[0].input.Image.Bytes, calls[2].input.SourceImage.Bytes);
  assert.deepEqual(calls[1].input.Image.Bytes, calls[2].input.TargetImage.Bytes);
  assert.equal(calls[0].requestOptions.abortSignal, calls[2].requestOptions.abortSignal);
});

test('no face, multiple faces, and uncertain detection stop before comparing or charging remaining calls', async () => {
  for (const [response, reason] of [[detection(0), 'no_face'], [detection(2), 'multiple_faces'], [detection(1, 98), 'low_confidence']]) {
    for (const isSelfie of [false, true]) {
      const { provider, calls } = harness(isSelfie ? [detection(), response] : [response]);
      const result = await provider.compare(input);
      assert.equal(result.status, 'needs_review');
      assert.equal(result.reason, reason);
      assert.equal(result.similarity, null);
      assert.equal(calls.length, isSelfie ? 2 : 1);
    }
  }
});

test('a valid low similarity is needs_review and never an automatic driver rejection', async () => {
  const { provider } = harness([detection(), detection(), comparison(98.9)]);
  assert.deepEqual(await provider.compare(input), { provider: 'aws-rekognition', threshold: 99,
    status: 'needs_review', reason: 'below_threshold', similarity: 98.9 });
  const emptyMatch = comparison(); emptyMatch.FaceMatches = [];
  const empty = harness([detection(), detection(), emptyMatch]);
  assert.equal((await empty.provider.compare(input)).reason, 'below_threshold');
});

test('match at threshold is accepted but malformed or out-of-range scores cannot pass', async () => {
  assert.equal((await harness([detection(), detection(), comparison(99)]).provider.compare(input)).status, 'matched');
  for (const invalid of [101, -1, NaN, Infinity, '100', null, undefined]) {
    const response = comparison(); response.FaceMatches[0].Similarity = invalid;
    await assert.rejects(harness([detection(), detection(), response]).provider.compare(input), /unavailable/);
  }
});

test('unexpected extra comparison faces or low confidence need review even when similarity is high', async () => {
  const multiple = comparison(); multiple.UnmatchedFaces = [{ Confidence: 99.9 }];
  assert.equal((await harness([detection(), detection(), multiple]).provider.compare(input)).reason, 'multiple_faces');
  for (const part of ['SourceImageFace', 'FaceMatches']) {
    const response = comparison();
    if (part === 'FaceMatches') response.FaceMatches[0].Face.Confidence = 95;
    else response.SourceImageFace.Confidence = 95;
    assert.equal((await harness([detection(), detection(), response]).provider.compare(input)).reason, 'low_confidence');
  }
});

test('quality-filtered faces need review when AWS cannot compare them', async () => {
  const filtered = new Error('image-specific information'); filtered.name = 'InvalidParameterException';
  const { provider } = harness([detection(), detection(), filtered]);
  assert.equal((await provider.compare(input)).reason, 'low_confidence');
});

test('malformed, oversized, small, unsupported, and excessive-pixel images never reach AWS', async () => {
  const small = await sharp({ create: { width: 159, height: 240, channels: 3, background: '#cccccc' } }).png().toBuffer();
  const tooManyPixels = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: '#cccccc' } }).png().toBuffer();
  const webp = await sharp(photo).webp().toBuffer();
  for (const bad of [null, 'base64-secret-content', Buffer.from('malformed private image'), photo.subarray(0, 32),
    Buffer.alloc(2 * 1024 * 1024 + 1), small, tooManyPixels, webp]) {
    const { provider, calls } = harness();
    assert.equal((await provider.compare({ ...input, selfieContent: bad })).reason, 'invalid_image');
    assert.equal(calls.length, 0);
  }
});

test('upstream exceptions and malformed replies are sanitized without leaking data or retrying', async () => {
  const sensitive = new Error('private licence bytes, account key, request metadata');
  sensitive.cause = { image: 'private' };
  for (const responses of [[sensitive], [{}], [{ FaceDetails: [{}] }], [detection(), detection(), {}]]) {
    const { provider, calls } = harness(responses);
    await assert.rejects(provider.compare(input), (error) => {
      assert.equal(error.message, 'Automatic driver face comparison is unavailable. Please try again later.');
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes('private'), false);
      return true;
    });
    assert.ok(calls.length <= 3);
  }
});

test('the total provider timeout aborts pending work and does not start another chargeable operation', async () => {
  let calls = 0, signal;
  const client = { send(_command, options) {
    calls += 1; signal = options.abortSignal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private AWS message')), { once: true }));
  } };
  const provider = createDriverFaceProvider({ config: { ...config, timeoutMs: 1000 }, client });
  await assert.rejects(provider.compare(input), /unavailable/);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});
