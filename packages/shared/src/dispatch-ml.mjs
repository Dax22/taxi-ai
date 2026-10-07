const FEATURE_NAMES = Object.freeze(['pickupCostSeconds','distanceMeters','waitSeconds','driverAcceptanceRate',
  'driverCompletionRate','driverOfferLog1p','roadEstimate','fallbackEstimate']);
const finite = (value) => Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function validateDispatchMlArtifact(artifact, { live = false } = {}) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.type !== 'linear_logit'
    || typeof artifact.version !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(artifact.version)
    || !artifact.features || !artifact.weights || !artifact.approval || !finite(artifact.intercept)) {
    throw new TypeError('Invalid dispatch ML model artifact.');
  }
  for (const name of FEATURE_NAMES) {
    const spec = artifact.features[name];
    if (!spec || !finite(spec.mean) || !finite(spec.scale) || spec.scale <= 0 || !finite(artifact.weights[name])) {
      throw new TypeError(`Invalid dispatch ML feature: ${name}`);
    }
  }
  if (live && (artifact.approval.trainedOnRealOutcomes !== true || artifact.approval.approvedForLive !== true
    || !Number.isSafeInteger(artifact.approval.trainingRows) || artifact.approval.trainingRows < 1000)) {
    throw new TypeError('Live ML ranking requires a real-outcome-trained, explicitly approved model with at least 1,000 training rows.');
  }
  return artifact;
}

export function dispatchMlFeatures(candidate, history = {}, now) {
  if (!candidate || !Number.isSafeInteger(now) || now < candidate.createdAt) throw new TypeError('Invalid dispatch ML candidate.');
  const road = finite(candidate.pickupEtaSeconds);
  const distance = finite(candidate.distanceMeters) ? clamp(candidate.distanceMeters, 0, 10_000) : 10_000;
  const pickupCostSeconds = road ? clamp(candidate.pickupEtaSeconds, 0, 7200)
    : candidate.distanceMeters === null ? 1200 : clamp(distance / 5 + 300, 0, 7200);
  const offers = Number.isSafeInteger(history.offers) && history.offers >= 0 ? history.offers : 0;
  const accepted = Number.isSafeInteger(history.accepted) && history.accepted >= 0 ? history.accepted : 0;
  const completed = Number.isSafeInteger(history.completed) && history.completed >= 0 ? history.completed : 0;
  // Beta-prior smoothing keeps new drivers neutral rather than punishing missing history.
  const driverAcceptanceRate = (accepted + 2) / (offers + 4);
  const driverCompletionRate = (completed + 2) / (accepted + 4);
  return Object.freeze({
    pickupCostSeconds,
    distanceMeters: distance,
    waitSeconds: clamp((now - candidate.createdAt) / 1000, 0, 300),
    driverAcceptanceRate: clamp(driverAcceptanceRate, 0, 1),
    driverCompletionRate: clamp(driverCompletionRate, 0, 1),
    driverOfferLog1p: Math.log1p(offers),
    roadEstimate: road ? 1 : 0,
    fallbackEstimate: road ? 0 : 1,
  });
}

export function scoreDispatchMl(artifact, features) {
  validateDispatchMlArtifact(artifact);
  let logit = artifact.intercept;
  for (const name of FEATURE_NAMES) {
    const value = features?.[name], spec = artifact.features[name];
    if (!finite(value)) throw new TypeError(`Missing dispatch ML feature: ${name}`);
    logit += artifact.weights[name] * ((value - spec.mean) / spec.scale);
  }
  const bounded = clamp(logit, -30, 30);
  return 1 / (1 + Math.exp(-bounded));
}

export const DISPATCH_ML_FEATURE_NAMES = FEATURE_NAMES;
