// Family data stays in the authenticated inbox. Push carries only its opaque ID.
// A provider receipt confirms provider handoff, never that a person saw an alert.
export function createFamilyDeliveryService({ repository, provider, familyTargets, validFamilyTarget,
  disableTarget, dispatchable, unitOfWork, tokens, clock, onChanged = async () => {} }) {
  let running = false, stopped = false, drain = null, resolveDrain = null;
  const enabled = () => provider?.enabled === true;
  const eligible = async (job) => (await dispatchable(job.eventId,job.userId)) && (await validFamilyTarget(job));

  // Called inside the family event transaction. Do not retroactively send old
  // events when a device opts in or push is enabled later.
  async function enqueue(eventId,userId) {
    if (!enabled() || !(await dispatchable(eventId,userId))) return;
    for (const target of await familyTargets(userId)) {
      if (await validFamilyTarget({ ...target,userId })) await repository.add({
        id:tokens.id(),eventId,userId,sessionId:target.sessionId,token:target.token,now:clock() });
    }
  }

  async function deliveryFor(eventId,userId) {
    const rows = await repository.statuses(eventId,userId);
    const status = ['delivered','provider_accepted','queued','failed','suppressed']
      .find(value => rows.some(row => row.status === value)) ?? 'saved';
    const first = field => {
      const values = rows.map(row => row[field]).filter(value => value !== null);
      return values.length ? Math.min(...values) : null;
    };
    return { status,configured:enabled(),acceptedAt:first('acceptedAt'),
      providerConfirmedAt:first('providerConfirmedAt'),deliveredAt:first('deliveredAt') };
  }

  async function finish(job,attempts,result) {
    await repository.finish({ id:job.id,attempts,status:result.status,nextAt:result.nextAt ?? clock(),
      ticket:result.ticket ?? job.ticket,acceptedAt:result.acceptedAt ?? null,
      providerConfirmedAt:result.providerConfirmedAt ?? null,deliveredAt:result.deliveredAt ?? null });
    await onChanged(job.userId);
  }

  async function deliverPending() {
    if (stopped || running || !enabled()) return;
    running = true;
    // Server shutdown awaits this barrier before closing the shared database.
    // It covers claims and authorization reads as well as provider I/O.
    drain = new Promise(resolve => { resolveDrain = resolve; });
    try {
      for (const job of await repository.due(clock())) {
        if (stopped) break;
        const attempts = job.attempts + 1;
        const claimed = await unitOfWork(async () => {
          if (!(await repository.claim(job.id,job.attempts,clock()))) return false;
          if (!(await eligible(job))) { await finish(job,attempts,{status:'suppressed'}); return false; }
          if (job.attempts >= 8 || clock() >= job.createdAt+86_400_000) {
            await finish(job,attempts,{status:'failed'}); return false;
          }
          return true;
        });
        if (stopped) break;
        if (!claimed) continue;
        // Recheck after leaving the transaction, immediately before external I/O.
        if (!(await eligible(job))) {
          if (stopped) break;
          await unitOfWork(async () => {
            if (await repository.ownsLease(job.id,attempts,clock())) await finish(job,attempts,{status:'suppressed'});
          });
          continue;
        }
        if (stopped) break;
        let result;
        try {
          result = job.status === 'provider_accepted' && job.ticket
            ? await provider.receipt(job.ticket)
            : await provider.send({token:job.token,familyEventId:job.eventId});
        } catch { result = {status:'retry'}; }
        if (stopped) break;
        await unitOfWork(async () => {
          if (!(await repository.ownsLease(job.id,attempts,clock()))) return;
          if (!(await eligible(job))) { await finish(job,attempts,{status:'suppressed'}); return; }
          const now = clock();
          if (result?.status === 'unregistered') await disableTarget(job.token);
          if (result?.status === 'delivered') {
            await finish(job,attempts,{status:'delivered',acceptedAt:now,providerConfirmedAt:now,deliveredAt:now});
          } else if (result?.status === 'ok') {
            await finish(job,attempts,{status:'provider_accepted',acceptedAt:now,providerConfirmedAt:now});
          } else if (result?.status === 'ticket' && typeof result.ticket === 'string' && result.ticket.length > 0 && result.ticket.length <= 1000) {
            await finish(job,attempts,{status:'provider_accepted',ticket:result.ticket,acceptedAt:now,nextAt:now+15*60_000});
          } else if (['unregistered','error'].includes(result?.status)) {
            await finish(job,attempts,{status:'failed'});
          } else {
            await finish(job,attempts,{status:job.status,nextAt:now+Math.min(60_000*2**job.attempts,3_600_000)});
          }
        });
      }
    } finally { running = false; resolveDrain(); resolveDrain = null; drain = null; }
  }
  return Object.freeze({ enqueue,deliveryFor,deliverPending,stop:() => { stopped=true; return drain ?? Promise.resolve(); } });
}
