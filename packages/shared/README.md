# Shared domain rules

`src/fare-negotiation.mjs` exports `FareNegotiation` and `FareError`. The module
has no dependencies and runs as a JavaScript ES module.

```js
import { FareNegotiation } from './src/fare-negotiation.mjs';

const negotiation = new FareNegotiation({
  id: 'request-1-driver-1',
  customerId: 'customer-1',
  driverId: 'driver-1',
  suggestedFareKobo: 450_000,
});

const offered = negotiation.propose({
  actorId: 'driver-1',
  amountKobo: 480_000,
  expectedVersion: 0,
  channel: 'in_app',
});

const agreed = negotiation.accept({
  actorId: 'customer-1',
  offerId: offered.currentOffer.id,
  expectedVersion: offered.version,
});

console.log(agreed.agreement.amountKobo); // 480000 = NGN 4,800
```

Use `snapshot()` to get a detached copy of current state. Use `propose` again to
counteroffer; only the latest offer is acceptable. Either participant can
`cancel({ actorId, expectedVersion })` while the negotiation is open.

Mutation methods accept an optional `now` timestamp in milliseconds for tests;
production callers must supply trusted server time or use the default clock.
`propose` also accepts `validForMs`, defaulting to 120,000 milliseconds.

Errors have a stable `code`, for example `FORBIDDEN`, `STALE_VERSION`,
`STALE_OFFER`, `OFFER_EXPIRED`, `SELF_ACCEPTANCE` or `NEGOTIATION_CLOSED`.
The API should map these to appropriate responses without leaking participant
details.

`chat` and `voice_call` are context labels only. Do not call `accept` on the
basis of an AI transcription or free-text interpretation.
