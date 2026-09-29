/** A lease is permission to compute. guard() in the write transaction grants commit permission. */
export function createWorkerCoordinator({ repository, ownerId, leaseMs = 15_000, clock = () => repository.now() }) {
  const validName = (name) => typeof name === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(name);
  return Object.freeze({
    async acquire(name) {
      if (!validName(name)) throw new Error('Invalid worker lease name.');
      const now = await clock();
      return await repository.acquire(name, ownerId, now, now + leaseMs) ?? null;
    },
    async renew(lease) {
      const now = await clock();
      return repository.renew(lease, now, now + leaseMs);
    },
    release: (lease) => repository.release(lease),
    guard: async (lease) => repository.guard(lease, await clock()),
  });
}
