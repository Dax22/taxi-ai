import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness,participants,claimRide,requestRide,PASSWORD } from './helpers.mjs';
import { readCheckoutPaymentResponse } from '../../../packages/shared/src/checkout-payments.mjs';

function fixtureProvider() {
  const attempts=new Map();
  return {enabled:true,configured:true,attempts,
    async initialize({reference,amountKobo}) { attempts.set(reference,amountKobo);return {reference,checkoutUrl:'https://checkout.paystack.com/http-test'}; },
    async verify(reference) { return {reference,amountKobo:attempts.get(reference),currency:'NGN',domain:'test',status:'success',transactionId:reference}; },
  };
}
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
async function step(person,ride,action,extra={}) {return ok(await person.post(`/api/rides/${ride.id}/${action}`,{expectedVersion:ride.version,...extra})).ride;}
async function booked(customer,driver) {
  let ride=await claimRide(driver,await requestRide(customer));ride=await step(driver,ride,'offers',{amountKobo:470001});
  ride=await step(customer,ride,'accept',{offerId:ride.negotiation.currentOffer.id});return step(customer,ride,'confirm');
}

test('real ride HTTP checkout verifies through native and unlocks only the saved paid booking',async t=>{
  const paystackProvider=fixtureProvider(),h=await harness(t,{paystackProvider,persistent:true}),{customer,driver}=await participants(h);
  let ride=await booked(customer,driver);const pin=ride.trip.pickupPin,path=`/api/checkout-payments/ride/${ride.id}`;
  assert.equal(ride.trip.paymentMode,'paystack_test');
  let body=ok(await customer.send(path));assert.equal(body.canStart,true);assert.equal(body.payment,null);
  assert.ok(readCheckoutPaymentResponse(body,{kind:'ride',targetId:ride.id}));
  await driver.shareTripLocation(ride.id);ride=await step(driver,ride,'depart');ride=await step(driver,ride,'arrive');
  const blocked=await driver.post(`/api/rides/${ride.id}/start`,{expectedVersion:ride.version,pickupPin:pin});
  assert.equal(blocked.status,409,JSON.stringify(blocked.body));assert.equal(blocked.body.error.code,'PAYMENT_REQUIRED');
  body=ok(await customer.post(path+'/start',{expectedVersion:0}));assert.equal(body.payment.amountKobo,470001);assert.equal(paystackProvider.attempts.size,1);
  assert.ok(readCheckoutPaymentResponse(body,{kind:'ride',targetId:ride.id}));
  const driverBody=ok(await driver.send(path));assert.equal(driverBody.payment.reference,null);assert.equal(driverBody.payment.checkoutUrl,null);
  assert.ok(readCheckoutPaymentResponse(driverBody,{kind:'ride',targetId:ride.id}));
  assert.equal((await driver.post(path+'/refresh',{expectedVersion:body.payment.version})).status,403);
  const credentials=ok(await customer.send('/api/mobile/v1/auth/login',{method:'POST',data:{email:customer.user.email,password:PASSWORD,deviceName:'Checkout integration phone'},headers:{Origin:null,Cookie:null,'X-CSRF-Token':null}})).credentials;
  const paid=ok(await customer.send('/api/mobile/v1'+path.slice(4)+'/refresh',{method:'POST',data:{expectedVersion:body.payment.version},headers:{Origin:null,Cookie:null,'X-CSRF-Token':null,Authorization:`Bearer ${credentials.accessToken}`,'Idempotency-Key':randomUUID()}}));
  assert.equal(paid.payment.status,'paid');assert.ok(readCheckoutPaymentResponse(paid,{kind:'ride',targetId:ride.id}));
  await h.restart();assert.equal(ok(await customer.send(path)).payment.status,'paid');
  ride=await step(driver,ride,'start',{pickupPin:pin});ride=await step(driver,ride,'complete');assert.equal(ride.status,'completed');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n,0,'Paystack test trip must not create simulator receivables');
});

test('a real cancelled ride retains verified money as refund review and never starts',async t=>{
  const paystackProvider=fixtureProvider(),h=await harness(t,{paystackProvider}),{customer,driver}=await participants(h);
  const credentials=ok(await customer.send('/api/mobile/v1/auth/login',{method:'POST',data:{email:customer.user.email,password:PASSWORD,deviceName:'Cancellation review phone'},headers:{Origin:null,Cookie:null,'X-CSRF-Token':null}})).credentials;
  const nativeJourney=async id=>ok(await customer.send(`/api/mobile/v1/journeys/${id}`,{headers:{Origin:null,Cookie:null,'X-CSRF-Token':null,Authorization:`Bearer ${credentials.accessToken}`}})).ride;
  let ride=await booked(customer,driver);const path=`/api/checkout-payments/ride/${ride.id}`;
  ok(await customer.post(path+'/start',{expectedVersion:0}));ride=await step(customer,ride,'cancel');assert.equal(ride.status,'cancelled');
  assert.equal((await nativeJourney(ride.id)).paymentMode,'paystack_test','A cancelled confirmed trip retains its checkout entry point.');
  const pending=ok(await customer.send(path));const paid=ok(await customer.post(path+'/refresh',{expectedVersion:pending.payment.version}));
  assert.equal(paid.payment.status,'refund_required');assert.equal(paid.payment.refundAmountKobo,470001);
  assert.ok(readCheckoutPaymentResponse(paid,{kind:'ride',targetId:ride.id}));
  const unbooked=await step(customer,await requestRide(customer),'cancel');
  assert.equal((await nativeJourney(unbooked.id)).paymentMode,undefined,'A cancelled request without a trip has no checkout entry point.');
});
