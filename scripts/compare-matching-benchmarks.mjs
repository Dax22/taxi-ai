import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const round = (value) => Math.round(value * 100) / 100;
const workloadKeys = ['rate', 'durationSeconds', 'warmupSeconds', 'actors', 'apiInstances', 'workers', 'poolSize', 'idleAccounts'];

/** Compare identical fixtures; never infer capacity or combine unrelated p95s. */
export function compareMatchingBenchmarks(baseline, optimized) {
  if (!baseline?.passed || !optimized?.passed || baseline.configuration?.fastPath !== false || optimized.configuration?.fastPath !== true) {
    throw new Error('Comparison requires successful baseline and optimized benchmark reports.');
  }
  if (workloadKeys.some((key) => baseline.configuration[key] !== optimized.configuration[key])
    || baseline.providers !== optimized.providers || baseline.database !== optimized.database) {
    throw new Error('Benchmark workload and provider configuration must match.');
  }
  function metrics(report) {
    const completed = report.measurement.journeys.completed;
    const workers = report.processes.filter((process) => process.role === 'worker');
    if (!completed || !workers.length || workers.some(({ profiles }) => !Number.isFinite(profiles.queryCount))) {
      throw new Error('Benchmark report is missing completed journeys or query totals.');
    }
    const sum = (key) => workers.reduce((n, { profiles }) => n + profiles[key], 0);
    return { completedJourneys: completed,
      workerCycles: sum('cycles'), workerQueryCount: sum('queryCount'),
      workerQueriesPerJourney: round(sum('queryCount') / completed),
      workerQueryMsPerJourney: round(sum('queryMs') / completed),
      acceptedOfferP95Ms: report.measurement.journeys.timeToAcceptedOfferMs.p95,
      worstWorkerCycleP95Ms: Math.max(...workers.map(({ profiles }) => profiles.durationMs.p95 ?? 0)),
      transactionRetries: sum('retries') };
  }
  const before = metrics(baseline), after = metrics(optimized);
  if (before.completedJourneys !== after.completedJourneys) throw new Error('Completed journey counts must match.');
  return { baseline: before, optimized: after,
    workerQueryReductionPercent: before.workerQueryCount ? round(100 * (1 - after.workerQueryCount / before.workerQueryCount)) : null,
    interpretation: 'Same synthetic workload, separate disposable databases. Query totals cover sampled dispatch cycles, not all HTTP or wake-up queries. Accepted-offer latency includes one-second synthetic driver polling. Timing varies with CI hardware; this is not a capacity guarantee.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Pass baseline and optimized report paths.');
    const baseline = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const optimized = JSON.parse(await readFile(process.argv[3], 'utf8'));
    console.log(JSON.stringify(compareMatchingBenchmarks(baseline, optimized), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
