import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';

export const CLOSED = ['completed','delivered','cancelled','rejected','expired'];
export const KINDS = ['ride','courier','food'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function recordId(value) { check(typeof value === 'string' && uuid.test(value), 'INVALID_INPUT', 'Select a valid record.'); return value; }
const day = time => new Date(time + 3600000).toISOString().slice(0, 10);
export function filters(input = {}, now) {
  fields(input, ['service','status','q','accountId','customerId','workerId','storeId','participation','paymentMode','paymentStatus','vehicleCategory','area','from','to','before','limit'], []);
  const service = input.service || 'all', status = input.status || 'all';
  check(['all',...KINDS].includes(service), 'INVALID_INPUT', 'Invalid service filter.');
  check(['all','active','requested','negotiating','agreed','booked','on_way','arrived','in_progress','completed','cancelled','expired','placed','accepted','preparing','ready','assigned','picked_up','delivered','rejected'].includes(status), 'INVALID_INPUT', 'Invalid status filter.');
  check(input.q === undefined || typeof input.q === 'string', 'INVALID_INPUT', 'Search must be text.');
  const q = input.q?.trim() || '', limit = input.limit === undefined ? 25 : Number(input.limit);
  check(q.length <= 100 && !/[\u0000-\u001f\u007f]/.test(q) && Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_INPUT', 'Use a valid search and a page size from 1 to 100.');
  const accountId = input.accountId || null, storeId = input.storeId || null;
  const customerId=input.customerId||null,workerId=input.workerId||null;
  for(const value of [accountId,storeId,customerId,workerId])if(value)recordId(value);
  const participation=input.participation||'all',paymentMode=input.paymentMode||'all',paymentStatus=input.paymentStatus||'all',vehicleCategory=input.vehicleCategory||'all';
  check(['all','customer','worker','vendor'].includes(participation)&& (participation==='all'||accountId), 'INVALID_INPUT', 'Participation filters require an account.');
  check(['all','simulation','test','live','unverified','unconfigured','paystack'].includes(paymentMode), 'INVALID_INPUT', 'Invalid payment-mode filter.');
  check(['all','not_recorded','not_charged','not_due','unpaid','initializing','pending','paid','failed','unknown','refund_required','expired'].includes(paymentStatus), 'INVALID_INPUT', 'Invalid payment-status filter.');
  check(['all','standard','suv','van','truck','motorcycle'].includes(vehicleCategory), 'INVALID_INPUT', 'Invalid vehicle filter.');
  check(input.area===undefined||typeof input.area==='string','INVALID_INPUT','Area must be text.');
  const area=(input.area||'').trim();check(area.length<=100&&!/[\u0000-\u001f\u007f]/.test(area),'INVALID_INPUT','Invalid area filter.');
  let start = 0, end = now + 1;
  if (input.from || input.to) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(input.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(input.to || ''), 'INVALID_INPUT', 'Choose both Nigeria dates.');
    start = Date.parse(input.from + 'T00:00:00+01:00'); const last = Date.parse(input.to + 'T00:00:00+01:00');
    check(Number.isFinite(start) && Number.isFinite(last) && day(start) === input.from && day(last) === input.to && start <= last && last - start < 366 * 86400000 && input.to <= day(now), 'INVALID_INPUT', 'Choose a valid date range of up to 366 days.');
    end = Math.min(now + 1, last + 86400000);
  }
  let before = null;
  if (input.before) {
    const parts = input.before.split('.');
    check(parts.length === 3 && /^\d{1,16}$/.test(parts[0]) && Number.isSafeInteger(Number(parts[0])) && KINDS.includes(parts[1]) && uuid.test(parts[2]), 'INVALID_INPUT', 'Invalid page cursor.');
    before = { createdAt: Number(parts[0]), service: parts[1], id: parts[2] };
  }
  return { service, status, q, accountId, customerId, workerId, storeId, participation, paymentMode, paymentStatus, vehicleCategory, area, start, end, before, limit };
}
export const cursor = row => `${row.createdAt}.${row.service}.${row.id}`;
export function project(row) {
  return { id: row.id, service: row.service, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    customer: { id: row.customerId, name: row.customerName }, worker: row.workerId ? { id: row.workerId, name: row.workerName } : null,
    store: row.storeId ? { id: row.storeId, name: row.storeName } : null,
    pickup: row.pickupName || row.pickupArea || 'Not recorded', destination: row.destinationName || row.destinationArea || 'Not recorded',
    amountKobo: row.amountKobo == null ? null : String(row.amountKobo), paymentMode: row.paymentMode || 'unconfigured',
    paymentStatus: row.paymentStatus || 'not_recorded', paymentTargetId: row.paymentTargetId || null,
    vehicleCategory: row.vehicleCategory || null };
}
export async function summarize(rows) {
  const groups = new Map(); let total = 0;
  for await (const row of rows) {
    const key = `${row.service}:${row.paymentMode || 'unconfigured'}`;
    const item = groups.get(key) || { service: row.service, paymentMode: row.paymentMode || 'unconfigured', transactions: 0, completed: 0, cancelled: 0, active: 0, amountKobo: 0n, unknownAmounts: 0 };
    item.transactions++; total++;
    if (['completed','delivered'].includes(row.status)) item.completed++;
    else if (CLOSED.includes(row.status)) item.cancelled++; else item.active++;
    if (row.amountKobo == null) item.unknownAmounts++; else item.amountKobo += BigInt(row.amountKobo);
    groups.set(key, item);
  }
  return { total, groups: [...groups.values()].map(row => ({ ...row, amountKobo: String(row.amountKobo) })),
    basis: 'All matching source transactions; food uses each kitchen order amount once. Amounts are not platform revenue, proof of payment, or payouts.' };
}
export function csv(rows) {
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return [['reference','service','status','created_at_utc','customer','worker','vendor','amount_kobo','payment_mode','payment_status'],
    ...rows.map(row => [row.id,row.service,row.status,new Date(row.createdAt).toISOString(),row.customer.name,row.worker?.name,row.store?.name,row.amountKobo,row.paymentMode,row.paymentStatus])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
