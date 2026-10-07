import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { SETTLED, TEST_NOTICE, LIVE_NOTICE, target, contextAmount, checkoutUrl, verifyResult, retryDelay } from './domain.mjs';

/** Paystack test checkout: reserve durably, call provider outside transactions,
 * then reconcile verified money and target fulfillment in one transaction. */
export function createCheckoutPaymentsService({ repository, getAccount, contextFor, onPaid, provider, unitOfWork, tokens, audit, clock, enabled = false }) {
  const providerMode = ['test','live'].includes(provider.mode) ? provider.mode : 'test';
  const settings = Object.freeze({ provider: 'paystack', mode: providerMode, enabled: Boolean(enabled), walletStrategy: 'paystack_hosted', walletCandidates: ['apple_pay','google_pay'], walletAvailability: 'provider_device_eligibility' });
  const supported = context => context.paymentMode !== 'simulation';
  async function actor(userId, reauthenticate) {
    if (reauthenticate) check((await reauthenticate())?.id === userId, 'UNAUTHENTICATED', 'Sign in to continue.');
    const user = await getAccount(userId); check(user, 'UNAUTHENTICATED', 'Sign in to continue.'); return user;
  }
  async function current(userId,kind,targetId,reauthenticate) {
    target(kind,targetId); const user = await actor(userId,reauthenticate);
    return { user, context: contextAmount(await contextFor(user,kind,targetId)), payment: await repository.find(kind,targetId) };
  }
  async function view(row,isPayer) {
    if (!row) return null;
    const closures = await repository.closures(row.id);
    const total = closures.reduce((sum,item) => sum + BigInt(item.amountKobo),0n);
    return { id:row.id,kind:row.kind,targetId:row.targetId,status:row.status,amountKobo:row.amountKobo,currency:row.currency,providerMode:row.providerMode ?? 'test',version:row.version,
      checkoutUrl:isPayer && !row.closedAt && row.status === 'pending' ? row.checkoutUrl : null, reference:isPayer ? row.reference : null,
      refundRequired:row.status === 'refund_required', refundAmountKobo:row.status === 'refund_required' ? Number(total > BigInt(row.amountKobo) ? BigInt(row.amountKobo) : total || BigInt(row.amountKobo)) : null,
      createdAt:row.createdAt,updatedAt:row.updatedAt,paidAt:row.paidAt,
      receipt:isPayer && row.receiptJson ? JSON.parse(row.receiptJson) : null };
  }
  async function response(userId,kind,targetId,replayed,reauthenticate) {
    const {user,context,payment} = await current(userId,kind,targetId,reauthenticate), isPayer = context.customerId === user.id;
    const active = enabled && supported(context);
    return { settings:{...settings,enabled:Boolean(active)},payment:await view(payment,isPayer),isPayer,
      canStart:Boolean(active && isPayer && context.eligible && (!context.expiresAt || context.expiresAt > clock()) && !payment),
      ...(replayed === undefined ? {} : {replayed}) };
  }
  const get = (userId,kind,targetId) => response(userId,kind,targetId);
  async function initialize(payment,user,leaseToken) {
    let url = null,error = null;
    try {
      const result = await provider.initialize({email:user.email,amountKobo:payment.amountKobo,reference:payment.reference});
      check(result?.reference === payment.reference,'PAYMENT_VERIFICATION_FAILED','The checkout reference could not be verified.');
      url = checkoutUrl(result.checkoutUrl);
    } catch { error = 'initialization_unavailable'; }
    // Even a timeout might have created a provider transaction. Never initialize
    // another reference or repeat this call after the durable reservation exists.
    await unitOfWork(async () => { await repository.initialized(payment.id,leaseToken,url,clock(),error); });
  }
  async function command({userId,kind,targetId,action,key,data,reauthenticate}) {
    target(kind,targetId); check(['start','refresh'].includes(action),'NOT_FOUND','Payment action not found.');
    fields(data,['expectedVersion']); check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0,'INVALID_VERSION','A payment version is required.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify([kind,targetId,action,data.expectedVersion]));
    const reservation = await unitOfWork(async () => {
      const {user,context,payment:existing} = await current(userId,kind,targetId,reauthenticate);
      check(context.customerId === user.id,'FORBIDDEN','Only the booking account can manage this payment.');
      const previous = await repository.command(userId,key);
      if (previous) { check(previous.fingerprint === fingerprint,'KEY_REUSED','This key belongs to another payment action.'); return {replayed:true}; }
      check(existing || enabled && supported(context),'FORBIDDEN','Paystack test checkout is unavailable for this booking.');
      check((existing?.version ?? 0) === data.expectedVersion,'STALE_VERSION','This payment changed. Refresh before trying again.');
      let payment = existing, initializeToken = null;
      if (!payment) {
        check(action === 'start','PAYMENT_NOT_READY','Start a test checkout first.');
        check(context.eligible && (!context.expiresAt || context.expiresAt > clock()),'PAYMENT_NOT_READY','This booking is no longer available for payment.');
        const now = clock(), id = tokens.id(); initializeToken = tokens.id();
        const inserted = await repository.insert({id,kind,targetId,customerId:user.id,amountKobo:context.amountKobo,currency:context.currency,
          reference:`TA-${providerMode === 'live' ? 'LIVE' : 'TEST'}-${id}`,providerMode,now,leaseToken:initializeToken});
        check(inserted,'STALE_VERSION','A checkout already exists. Refresh its status.');
        payment = await repository.byId(id);
        await audit.record(userId,'checkout.test_reserved',id,now);
      }
      check(payment.customerId === user.id && payment.amountKobo === context.amountKobo && payment.currency === context.currency,
        'PAYMENT_NOT_READY','The saved booking no longer matches this payment.');
      await repository.saveCommand(userId,key,fingerprint,payment.id);
      return {payment,user,initializeToken,replayed:false};
    });
    if (!reservation.replayed) {
      if (reservation.initializeToken) await initialize(reservation.payment,reservation.user,reservation.initializeToken);
      else if (action === 'refresh') await reconcile(reservation.payment.id,true);
    }
    return response(userId,kind,targetId,reservation.replayed,reauthenticate);
  }
  async function settlementContext(payment) {
    const user = await getAccount(payment.customerId);
    if (!user) return null;
    try { return contextAmount(await contextFor(user,payment.kind,payment.targetId)); }
    catch(error) { if (['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED','PAYMENT_NOT_READY'].includes(error.code)) return null; throw error; }
  }
  async function reconcile(id,force=false) {
    const token = tokens.id();
    const claimed = await unitOfWork(async () => {
      if (!await repository.claim(id,token,clock(),force)) return null;
      return repository.byId(id);
    });
    if (!claimed) return false;
    let result,error = null;
    try { result = verifyResult(await provider.verify(claimed.reference),claimed); }
    catch(failure) { error = failure.code === 'PAYMENT_VERIFICATION_FAILED' ? 'verification_mismatch' : 'verification_unavailable'; }
    // A valid payment is settled even if the requesting browser signed out.
    // The final authenticated response below independently rechecks its session.
    return unitOfWork(async () => {
      const payment = await repository.byId(id);
      if (!payment || payment.leaseToken !== token || SETTLED.includes(payment.status)) return false;
      const now = clock();
      if (error || result.status !== 'success') {
        const status = error ? 'unknown' : ['failed','abandoned','reversed'].includes(result.status) ? 'failed' : 'pending';
        await repository.retry(id,token,status,error,now,now+retryDelay(payment.checkCount)); return false;
      }
      const context = await settlementContext(payment);
      const eligible = Boolean(context && context.customerId === payment.customerId && context.amountKobo === payment.amountKobo
        && context.currency === payment.currency && context.eligible && (!context.expiresAt || context.expiresAt > now) && !payment.closedAt);
      const record = {...payment,provider:'paystack',mode:payment.providerMode,paidAt:now,eligible};
      const outcome = context ? await onPaid(record) : {applied:false};
      check(outcome && typeof outcome.applied === 'boolean','PAYMENT_NOT_READY','Payment fulfillment could not be recorded.');
      check(!outcome.applied || eligible,'PAYMENT_NOT_READY','An unavailable booking cannot be fulfilled.');
      const applied = eligible && outcome.applied;
      if (!applied && !(await repository.closures(id)).length) await repository.saveClosure(id,'settlement_unavailable',payment.amountKobo,'target_unavailable',now);
      const receipt = {reference:payment.reference,amountKobo:payment.amountKobo,currency:payment.currency,paidAt:now,
        provider:'paystack',mode:payment.providerMode,notice:payment.providerMode === 'live' ? LIVE_NOTICE : TEST_NOTICE};
      check(await repository.settle(id,token,applied ? 'paid' : 'refund_required',receipt,result.transactionId ?? null,now),
        'STALE_VERSION','This payment changed during verification.');
      await audit.record(payment.customerId,applied ? `checkout.${payment.providerMode}_paid` : `checkout.${payment.providerMode}_refund_required`,id,now);
      return true;
    });
  }
  async function handleVerifiedReference(reference) {
    check(typeof reference === 'string' && /^[A-Za-z0-9_.=-]{1,128}$/.test(reference),'INVALID_INPUT','Invalid payment reference.');
    if (!/^TA-(TEST|LIVE)-[a-f0-9-]{36}$/.test(reference)) return {accepted:false};
    const payment = await repository.byReference(reference);
    if (!payment) return {accepted:false};
    await reconcile(payment.id,true); return {accepted:true};
  }
  async function reconcileDue({limit=25}={}) {
    const rows = await repository.due(clock(),limit); let checked = 0;
    for (const row of rows) {
      try { await reconcile(row.id); } catch { /* The durable lease expires and the next worker retries atomically. */ }
      checked++;
    }
    return {checked};
  }
  // These narrow database-only ports join the caller's domain transaction.
  async function requirePaid(context) {
    const payment = await repository.find(context.kind,context.targetId);
    check(payment?.status === 'paid' && payment.customerId === context.customerId && payment.amountKobo === context.amountKobo
      && payment.currency === context.currency && !payment.closedAt,'PAYMENT_REQUIRED','Complete the Paystack test checkout before continuing.');
    return payment;
  }
  async function close(context) {
    const payment = await repository.find(context.kind,context.targetId); if (!payment) return;
    check(context.customerId === payment.customerId,'FORBIDDEN','Payment closure does not match this booking.');
    const amount = context.refundAmountKobo ?? payment.amountKobo;
    check(Number.isSafeInteger(amount) && amount > 0 && amount <= payment.amountKobo,'INVALID_INPUT','Invalid refund review amount.');
    const closureKey = context.orderId ?? context.targetId, now = context.closedAt ?? clock();
    const saved = await repository.saveClosure(payment.id,closureKey,amount,'target_cancelled',now);
    if (saved) { await repository.close(payment.id,now); await audit.record(payment.customerId,'checkout.test_closed',payment.id,now); }
  }
  return Object.freeze({enabled:Boolean(enabled),get,command,handleVerifiedReference,reconcileDue,requirePaid,close});
}
