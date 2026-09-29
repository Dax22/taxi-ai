const MODES = ['off', 'aws-rekognition'];

function boundedNumber(value, fallback, minimum, maximum, name) {
  const text = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))
    || Number(text) < minimum || Number(text) > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return Number(text);
}

/** Server-only configuration; credentials use the AWS SDK default credential chain. */
export function readDriverFaceConfig(env = process.env) {
  const provider = env.TAXI_DRIVER_FACE_PROVIDER || 'off';
  if (!MODES.includes(provider)) throw new Error('TAXI_DRIVER_FACE_PROVIDER must be off or aws-rekognition.');
  const region = env.AWS_REGION || null;
  if (provider !== 'off' && (typeof region !== 'string' || !/^[a-z0-9-]{5,40}$/.test(region))) {
    throw new Error('Configure AWS_REGION for automatic driver face comparison.');
  }
  return Object.freeze({ provider, region,
    threshold: boundedNumber(env.TAXI_DRIVER_FACE_THRESHOLD, 99, 90, 100, 'TAXI_DRIVER_FACE_THRESHOLD'),
    timeoutMs: boundedNumber(env.TAXI_DRIVER_FACE_TIMEOUT_MS, 15_000, 1_000, 30_000, 'TAXI_DRIVER_FACE_TIMEOUT_MS'),
  });
}
