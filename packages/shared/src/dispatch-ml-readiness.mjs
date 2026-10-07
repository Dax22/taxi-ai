export const DISPATCH_ML_MIN_REAL_OUTCOMES = 1500;

export function dispatchMlReadiness({ observedOutcomes = 0, model = null, mode = 'off' } = {}) {
  const approval = model?.approval ?? {};
  const dataReady = Number.isSafeInteger(observedOutcomes) && observedOutcomes >= DISPATCH_ML_MIN_REAL_OUTCOMES;
  const trainedOnRealOutcomes = approval.trainedOnRealOutcomes === true;
  const approvedForLive = approval.approvedForLive === true;
  const trainingRows = Number.isSafeInteger(approval.trainingRows) ? approval.trainingRows : 0;
  const artifactReady = trainedOnRealOutcomes && trainingRows >= 1000;
  const readyForControlledLive = dataReady && artifactReady && approvedForLive;
  return Object.freeze({ observedOutcomes, minimumOutcomes: DISPATCH_ML_MIN_REAL_OUTCOMES, dataReady,
    trainedOnRealOutcomes, artifactTrainingRows: trainingRows, approvedForLive,
    readyForControlledLive, currentMode: mode,
    next: !dataReady ? 'Collect more closed real Taxi AI offer outcomes.'
      : !artifactReady ? 'Train and validate a model artifact from the real-outcome export.'
        : !approvedForLive ? 'Complete offline, fairness and operational review before approving the artifact.'
          : mode !== 'live' ? 'Eligible for a small controlled live cohort; keep rollback and monitoring enabled.'
            : 'Controlled live ranking is enabled; continue monitoring outcome and drift gates.' });
}
