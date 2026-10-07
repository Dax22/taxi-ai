const MODES = ['off', 'aws-rekognition', 'deepface'];
const DEEPFACE_MODELS = ['SFace'];
const DEEPFACE_DETECTORS = ['opencv'];

function boundedNumber(value, fallback, minimum, maximum, name) {
  const text = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))
    || Number(text) < minimum || Number(text) > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return Number(text);
}

function serviceOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Server-only configuration. DeepFace is expected on a private service network. */
export function readDriverFaceConfig(env = process.env) {
  const provider = env.TAXI_DRIVER_FACE_PROVIDER || 'off';
  if (!MODES.includes(provider)) throw new Error('TAXI_DRIVER_FACE_PROVIDER must be off, aws-rekognition or deepface.');
  const region = env.AWS_REGION || null;
  if (provider === 'aws-rekognition' && (typeof region !== 'string' || !/^[a-z0-9-]{5,40}$/.test(region))) {
    throw new Error('Configure AWS_REGION for automatic driver face comparison.');
  }

  const deepfaceUrl = serviceOrigin(env.TAXI_DRIVER_FACE_DEEPFACE_URL || 'http://deepface:5000');
  if (provider === 'deepface' && !deepfaceUrl) {
    throw new Error('Configure TAXI_DRIVER_FACE_DEEPFACE_URL as an HTTP(S) service origin.');
  }
  const model = env.TAXI_DRIVER_FACE_MODEL || 'SFace';
  if (provider === 'deepface' && !DEEPFACE_MODELS.includes(model)) {
    throw new Error('TAXI_DRIVER_FACE_MODEL must be SFace.');
  }
  const detector = env.TAXI_DRIVER_FACE_DETECTOR || 'opencv';
  if (provider === 'deepface' && !DEEPFACE_DETECTORS.includes(detector)) {
    throw new Error('TAXI_DRIVER_FACE_DETECTOR must be opencv.');
  }

  return Object.freeze({
    provider,
    region,
    deepfaceUrl,
    model,
    detector,
    threshold: boundedNumber(env.TAXI_DRIVER_FACE_THRESHOLD, provider === 'deepface' ? 90 : 99, 90, 100, 'TAXI_DRIVER_FACE_THRESHOLD'),
    timeoutMs: boundedNumber(env.TAXI_DRIVER_FACE_TIMEOUT_MS, provider === 'deepface' ? 30_000 : 15_000, 1_000, 30_000, 'TAXI_DRIVER_FACE_TIMEOUT_MS'),
  });
}
