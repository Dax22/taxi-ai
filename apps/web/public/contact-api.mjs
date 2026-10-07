export function createContactApi({ fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  async function request(options) {
    const response = await fetchImpl('/api/contact', options);
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  }

  return {
    async available() {
      const response = await request({ headers: { Accept: 'application/json' }, cache: 'no-store' });
      return response.ok && response.body?.available === true;
    },
    send(data) {
      return request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      });
    },
  };
}
