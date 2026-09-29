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

/** One-to-one face similarity only: not liveness or licence authenticity verification. */
export function createDriverFaceProvider({ config = readDriverFaceConfig(), client } = {}) {
  // Validate injected configuration as strictly as environment configuration.
  const settings = readDriverFaceConfig({ TAXI_DRIVER_FACE_PROVIDER: config.provider, AWS_REGION: config.region,
    TAXI_DRIVER_FACE_THRESHOLD: config.threshold, TAXI_DRIVER_FACE_TIMEOUT_MS: config.timeoutMs });
  const { provider, region, threshold, timeoutMs } = settings;
  const enabled = provider === 'aws-rekognition';
  const sdk = enabled ? client ?? new RekognitionClient({ region, maxAttempts: 1,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: timeoutMs },
  }) : null;
  const result = (reason, similarity = null) => ({ provider, threshold, reason, similarity,
    status: reason === 'matched' ? 'matched' : 'needs_review' });

  return Object.freeze({ provider, enabled, threshold,
    async compare({ licenceContent, selfieContent }) {
      if (!enabled) throw unavailable();
      let licence, selfie;
      try {
        [licence, selfie] = await Promise.all([normalizeDriverFaceImage(licenceContent), normalizeDriverFaceImage(selfieContent)]);
      } catch { return result('invalid_image'); }

      const controller = new AbortController();
      let timer;
      const send = async (command) => {
        controller.signal.throwIfAborted();
        return sdk.send(command, { abortSignal: controller.signal });
      };
      try {
        return await Promise.race([
          (async () => {
            // CompareFaces alone silently selects the largest source face. Count BOTH images first.
            // Sequential detection also avoids another charge when the first image is unsuitable.
            for (const bytes of [licence, selfie]) {
              const issue = faceIssue(await send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['DEFAULT'] })));
              if (issue) return result(issue);
            }
            let comparison;
            try {
              comparison = await send(new CompareFacesCommand({ SourceImage: { Bytes: licence }, TargetImage: { Bytes: selfie },
                SimilarityThreshold: threshold, QualityFilter: 'AUTO' }));
            } catch (error) {
              // Quality filtering can leave no comparable face even after detection succeeds.
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
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs); }),
        ]);
      } catch {
        // Do not expose AWS messages, request metadata, landmarks, or image bytes to logs/clients.
        throw unavailable();
      } finally { clearTimeout(timer); }
    },
  });
}
