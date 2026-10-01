interface WorkLocation {
  now: number;
  stale: boolean;
  uncertain?: boolean;
  data: {
    required?: boolean;
    share: { active: boolean; stale: boolean; position: { capturedAt: number } | null } | null;
  } | null;
}

/** UI guidance only. The server rechecks location and work eligibility on every action. */
export function workLocationRequired(state: WorkLocation): boolean { return state.data?.required === true; }
export function freshWorkLocation(state: WorkLocation): boolean {
  const share = state.data?.share, capturedAt = share?.position?.capturedAt;
  if (state.stale || state.uncertain || !share?.active || share.stale || capturedAt === undefined) return false;
  const age = state.now - capturedAt;
  return Number.isFinite(age) && age >= -5_000 && age < 30_000;
}
export function workLocationBlocks(kind: 'ride' | 'food', action: string, state: WorkLocation): boolean {
  const advancesWork = kind === 'food' ? ['pickup', 'arrive'].includes(action) : ['depart', 'arrive', 'start'].includes(action);
  return advancesWork && workLocationRequired(state) && !freshWorkLocation(state);
}
