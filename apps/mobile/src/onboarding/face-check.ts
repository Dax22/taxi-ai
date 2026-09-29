import type { DriverOnboarding } from '../../../../packages/shared/src/mobile-contracts.mjs';

export function canCompareDriverFace(application: DriverOnboarding | null, { consent, blocked = false, now = Date.now() }: { consent: boolean; blocked?: boolean; now?: number }): boolean {
  const check = application?.faceCheck;
  return !!application && !!check?.available && consent && !blocked && !application.busy
    && ['draft', 'changes_requested', 'rejected'].includes(application.status)
    && !['pending', 'matched'].includes(check.status)
    && (check.retryAfter === null || check.retryAfter <= now)
    && ['profile_photo', 'driving_licence'].every((kind) => application.documents.some((doc) => doc.kind === kind));
}

/** Reads only: a lost provider response must never trigger another comparison or a late account update. */
export function pollDriverFaceCheck({ read, current, busy, update, timeout, intervalMs = 2_000, maxMs = 90_000 }:
  { read(signal: AbortSignal): Promise<DriverOnboarding>; current(): boolean; busy(): boolean;
    update(app: DriverOnboarding): void; timeout(): void; intervalMs?: number; maxMs?: number }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const valid = () => !controller.signal.aborted && current();
  const cancel = () => { controller.abort(); clearTimeout(timer); clearTimeout(deadline); };
  const deadline = setTimeout(() => { if (valid()) timeout(); cancel(); }, maxMs);
  const schedule = () => { if (valid()) timer = setTimeout(() => void tick(), intervalMs); else cancel(); };
  async function tick() {
    if (!valid()) { cancel(); return; }
    if (busy()) { schedule(); return; }
    try {
      const app = await read(controller.signal);
      if (!valid()) { cancel(); return; }
      if (!busy()) {
        update(app);
        if (app.faceCheck?.status !== 'pending') { cancel(); return; }
      }
    } catch { /* Transient reads retry until the bounded deadline. */ }
    schedule();
  }
  schedule(); return cancel;
}
