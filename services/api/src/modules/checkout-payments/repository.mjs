const columns = `id,kind,target_id AS targetId,customer_id AS customerId,amount_kobo AS amountKobo,currency,reference,provider_mode AS providerMode,status,version,
  checkout_url AS checkoutUrl,receipt_json AS receiptJson,provider_transaction_id AS providerTransactionId,created_at AS createdAt,
  updated_at AS updatedAt,paid_at AS paidAt,closed_at AS closedAt,next_check_at AS nextCheckAt,check_count AS checkCount,
  lease_token AS leaseToken,lease_until AS leaseUntil,last_error AS lastError`;
const bounded = (n = 25) => Math.max(1, Math.min(25, Number.isSafeInteger(n) ? n : 25));
export function createCheckoutPaymentsRepository(db) {
  return Object.freeze({
    find: async (kind, targetId) => await db.prepare(`SELECT ${columns} FROM checkout_payments WHERE kind=? AND target_id=?`).get(kind, targetId) ?? null,
    byId: async id => await db.prepare(`SELECT ${columns} FROM checkout_payments WHERE id=?`).get(id) ?? null,
    byReference: async reference => await db.prepare(`SELECT ${columns} FROM checkout_payments WHERE reference=?`).get(reference) ?? null,
    async insert(row) {
      return (await db.prepare(`INSERT INTO checkout_payments(id,kind,target_id,customer_id,amount_kobo,currency,reference,provider_mode,status,created_at,updated_at,next_check_at,lease_token,lease_until)
        VALUES(?,?,?,?,?,?,?,?,'initializing',?,?,?,?,?) ON CONFLICT(kind,target_id) DO NOTHING`)
        .run(row.id,row.kind,row.targetId,row.customerId,row.amountKobo,row.currency,row.reference,row.providerMode,row.now,row.now,row.now+60_000,row.leaseToken,row.now+60_000)).changes === 1;
    },
    async initialized(id, leaseToken, url, now, error = null) {
      return (await db.prepare(`UPDATE checkout_payments SET status=?,checkout_url=?,last_error=?,updated_at=?,version=version+1,
        next_check_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status NOT IN ('paid','refund_required')`)
        .run(url ? 'pending' : 'unknown',url,error,now,now+30_000,id,leaseToken)).changes === 1;
    },
    command: async (actorId, key) => await db.prepare('SELECT fingerprint,payment_id AS paymentId FROM checkout_payment_commands WHERE actor_id=? AND key=?').get(actorId,key) ?? null,
    async saveCommand(actorId,key,fingerprint,paymentId) {
      await db.prepare('INSERT INTO checkout_payment_commands(actor_id,key,fingerprint,payment_id) VALUES(?,?,?,?)').run(actorId,key,fingerprint,paymentId);
    },
    due: async (now, limit) => await db.prepare(`SELECT ${columns} FROM checkout_payments WHERE next_check_at<=? AND (lease_until IS NULL OR lease_until<=?)
      ORDER BY next_check_at,id LIMIT ?`).all(now,now,bounded(limit)),
    async claim(id,token,now,force=false) {
      return (await db.prepare(`UPDATE checkout_payments SET lease_token=?,lease_until=? WHERE id=? AND status NOT IN ('paid','refund_required')
        AND (lease_until IS NULL OR lease_until<=?) AND (?=1 OR next_check_at<=?)`).run(token,now+60_000,id,now,force ? 1 : 0,now)).changes === 1;
    },
    async retry(id,token,status,error,now,next) {
      return (await db.prepare(`UPDATE checkout_payments SET status=?,last_error=?,updated_at=?,version=version+1,check_count=check_count+1,
        next_check_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status NOT IN ('paid','refund_required')`)
        .run(status,error,now,next,id,token)).changes === 1;
    },
    async settle(id,token,status,receipt,transactionId,now) {
      return (await db.prepare(`UPDATE checkout_payments SET status=?,receipt_json=?,provider_transaction_id=?,paid_at=?,updated_at=?,version=version+1,
        checkout_url=NULL,next_check_at=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL
        WHERE id=? AND lease_token=? AND status NOT IN ('paid','refund_required')`)
        .run(status,JSON.stringify(receipt),transactionId,now,now,id,token)).changes === 1;
    },
    async close(id, now) {
      await db.prepare(`UPDATE checkout_payments SET closed_at=COALESCE(closed_at,?),status=CASE WHEN status='paid' THEN 'refund_required' ELSE status END,
        updated_at=?,version=version+1,next_check_at=CASE WHEN status IN ('paid','refund_required') THEN NULL ELSE CAST(? AS BIGINT) END WHERE id=?`).run(now,now,now,id);
    },
    async saveClosure(id, key, amount, reason, now) {
      return (await db.prepare(`INSERT INTO checkout_payment_closures(payment_id,closure_key,amount_kobo,reason,closed_at)
        VALUES(?,?,?,?,?) ON CONFLICT(payment_id,closure_key) DO NOTHING`).run(id,key,amount,reason,now)).changes === 1;
    },
    closures: async id => await db.prepare('SELECT closure_key AS closureKey,amount_kobo AS amountKobo,reason,closed_at AS closedAt FROM checkout_payment_closures WHERE payment_id=? ORDER BY closed_at,closure_key').all(id),
  });
}
