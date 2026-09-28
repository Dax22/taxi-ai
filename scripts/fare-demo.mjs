import { FareNegotiation } from '../packages/shared/src/fare-negotiation.mjs';

const money = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
});
const format = (kobo) => money.format(kobo / 100);
const negotiation = new FareNegotiation({
  id: 'demo-wuse-maitama',
  customerId: 'demo-customer',
  driverId: 'demo-driver',
  suggestedFareKobo: 450_000,
});

console.log('Taxi Ai — fare negotiation demonstration');
console.log('Wuse II → Maitama, Abuja');
console.log('Fictional prices; no live booking, call, payment or AI estimator.\n');
console.log(`App suggestion: ${format(negotiation.snapshot().suggestedFareKobo)}`);

const driverOffer = negotiation.propose({
  actorId: 'demo-driver', amountKobo: 500_000, expectedVersion: 0,
});
console.log(`Driver offers: ${format(driverOffer.currentOffer.amountKobo)}`);

// A voice discussion does not confirm the fare. Here the customer explicitly
// submits a structured offer after that hypothetical conversation.
const counter = negotiation.propose({
  actorId: 'demo-customer', amountKobo: 470_000,
  expectedVersion: driverOffer.version, channel: 'voice_call',
});
console.log(`Customer submits a counteroffer: ${format(counter.currentOffer.amountKobo)}`);

const final = negotiation.accept({
  actorId: 'demo-driver', offerId: counter.currentOffer.id,
  expectedVersion: counter.version,
});
console.log(`Driver accepts the exact offer. Agreed fare: ${format(final.agreement.amountKobo)}`);
console.log(`Status: ${final.status}; both participants have consented.`);
console.log('This records a fare agreement only. Booking and dispatch come later.');
