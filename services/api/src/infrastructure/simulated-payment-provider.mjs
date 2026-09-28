/** Pure local fixture. No credentials, network, checkout or money movement. */
export function simulatePayment({ reference, amountKobo, currency, outcome }) {
  return Object.freeze({ provider: 'simulator', mode: 'simulation', reference, amountKobo, currency,
    status: outcome === 'success' ? 'succeeded' : 'failed' });
}
