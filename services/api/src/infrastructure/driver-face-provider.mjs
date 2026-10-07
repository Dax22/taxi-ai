import { RekognitionClient, DetectFacesCommand, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import { readDriverFaceConfig } from './driver-face-config.mjs';
import { normalizeDriverFaceImage } from './driver-face-image.mjs';

const unavailable = () => new Error('Automatic driver face comparison is unavailable. Please try again later.');
const validScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

function faceIssue(response) {
  if (!Array.isArray(response?.FaceDetails)) throw unavailable();
  if (response.FaceDetails.length === 0) return 'no_face';
  if (response.FaceDetails.length !== 1) return 'multiple_faces';
  if (!validScore(response.FaceDetails[0]?.Confidence)) throw unavailable();
  return response.FaceDetails[0].Confidence < 99 ? 'low_confidence' : null;
}

function deepfaceForm(fields, files) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
  for (const [name, bytes] of Object.entries(files)) {
    form.append(name, new Blob([bytes], { type: 'image/jpeg' }), `${name}.jpg`);
  }
  return form;
}

async function jsonBody(response) {
  try { return await response.json(); } catch { throw unavailable(); }
}

function deepfaceFaceIssue(response, body) {
  if (response.status === 400) return 'no_face';
  if (!response.ok || !Array.isArray(body?.results)) throw unavailable();
  if (body.results.length === 0) return 'no_face';
  if (body.results.length !== 1) return 'multiple_faces';
  return null;
}

function validatedConfig(config) {
  return readDriverFaceConfig({
    TAXI_DRIVER_FACE_PROVIDER: config.provider,
    AWS_REGION: config.region,
    TAXI_DRIVER_FACE_THRESHOLD: config.threshold,
    TAXI_DRIVER_FACE_TIMEOUT_MS: config.timeoutMs,
    TAXI_DRIVER_FACE_DEEPFACE_URL: config.deepfaceUrl,
    TAXI_DRIVER_FACE_MODEL: config.model,
    TAXI_DRIVER_FACE_DETECTOR: config.detector,
  });
}

/** One-to-one face similarity only: not liveness or licence authenticity verification. */
export function createDriverFaceProvider({ config = readDriverFaceConfig(), client, fetchImpl = fetch } = {}) {
  const settings = validatedConfig(config);
  const { provider, region, threshold, timeoutMs, deepfaceUrl, model, detector } = settings;
  const enabled = provider !== 'off';
  const sdk = provider === 'aws-rekognition' ? client ?? new RekognitionClient({ region, maxAttempts: 1,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: timeoutMs },
  }) : null;
  const result = (reason, similarity = null) => ({ provider, threshold, reason, similarity,
    status: reason === 'matched' ? 'matched' : 'needs_review' });

  async function compareAws(licence, selfie, signal) {
    const send = async (command) => {
      signal.throwIfAborted();
      return sdk.send(command, { abortSignal: signal });
    };
    for (const bytes of [licence, selfie]) {
      const issue = faceIssue(await send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['DEFAULT'] })));
      if (issue) return result(issue);
    }
    let comparison;
    try {
      comparison = await send(new CompareFacesCommand({ SourceImage: { Bytes: licence }, TargetImage: { Bytes: selfie },
        SimilarityThreshold: threshold, QualityFilter: 'AUTO' }));
    } catch (error) {
      if (error?.name === 'InvalidParameterException') return result('low_confidence');
      throw error;
    }
    if (!Array.isArray(comparison?.FaceMatches) || !validScore(comparison.SourceImageFace?.Confidence)
      || (comparison.UnmatchedFaces !== undefined && !Array.isArray(comparison.UnmatchedFaces))) throw unavailable();
    if (comparison.SourceImageFace.Confidence < 99) return result('low_confidence');
    if (comparison.FaceMatches.length + (comparison.UnmatchedFaces?.length ?? 0) > 1) return result('multiple_faces');
    if (!comparison.FaceMatches.length) return result('below_threshold');
    const match = comparison.FaceMatches[0];
    if (!validScore(match?.Similarity) || !validScore(match.Face?.Confidence)) throw unavailable();
    if (match.Face.Confidence < 99) return result('low_confidence');
    return result(match.Similarity >= threshold ? 'matched' : 'below_threshold', match.Similarity);
  }

  async function compareDeepface(licence, selfie, signal) {
    const post = async (path, form) => {
      signal.throwIfAborted();
      let response;
      try {
        response = await fetchImpl(`${deepfaceUrl}${path}`, { method: 'POST', body: form, signal, redirect: 'error' });
      } catch { throw unavailable(); }
      return { response, body: await jsonBody(response) };
    };

    for (const bytes of [licence, selfie]) {
      const { response, body } = await post('/represent', deepfaceForm(
        { model_name: model, detector_backend: detector, max_faces: 2 }, { img: bytes }));
      const issue = deepfaceFaceIssue(response, body);
      if (issue) return result(issue);
    }

    const { response, body } = await post('/verify', deepfaceForm(
      { model_name: model, detector_backend: detector, distance_metric: 'cosine' },
      { img1: licence, img2: selfie }));
    if (!response.ok || typeof body?.verified !== 'boolean' || !validScore(body?.confidence)
      || typeof body?.distance !== 'number' || !Number.isFinite(body.distance)
      || typeof body?.threshold !== 'number' || !Number.isFinite(body.threshold)
      || body.model !== model || body.detector_backend !== detector) throw unavailable();
    const matched = body.verified === true && body.confidence >= threshold;
    return result(matched ? 'matched' : 'below_threshold', body.confidence);
  }

  return Object.freeze({ provider, enabled, threshold,
    async compare({ licenceContent, selfieContent }) {
      if (!enabled) throw unavailable();
      let licence, selfie;
      try {
        [licence, selfie] = await Promise.all([normalizeDriverFaceImage(licenceContent), normalizeDriverFaceImage(selfieContent)]);
      } catch { return result('invalid_image'); }

      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          provider === 'deepface' ? compareDeepface(licence, selfie, controller.signal)
            : compareAws(licence, selfie, controller.signal),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs); }),
        ]);
      } catch {
        throw unavailable();
      } finally { clearTimeout(timer); }
    },
  });
}
