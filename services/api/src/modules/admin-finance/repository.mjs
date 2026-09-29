// Read-only finance projection. No account names, routes, coordinates, payment
// credentials or receipt payloads leave this repository. A receipt is inspected
// internally with a 16 KiB cap, then reduced to allowlisted scalar metadata.
const joins = `FROM payments p
  JOIN ride_trips trip ON trip.ride_id=p.ride_id
  LEFT JOIN payment_attempts attempt ON attempt.id=p.current_attempt_id
  LEFT JOIN payment_receipts receipt ON receipt.ride_id=p.ride_id`;
const columns = `p.ride_id AS rideId,CAST(p.amount_kobo AS TEXT) AS amountKobo,p.currency,p.mode,p.status,
  p.completed_at AS completedAt,p.updated_at AS updatedAt,p.paid_at AS paidAt,p.current_attempt_id AS currentAttemptId,
  attempt.ride_id AS attemptRideId,attempt.reference AS currentReference,CAST(attempt.amount_kobo AS TEXT) AS attemptAmountKobo,
  attempt.currency AS attemptCurrency,attempt.provider AS attemptProvider,attempt.status AS attemptStatus,attempt.created_at AS attemptCreatedAt,
  receipt.attempt_id AS receiptAttemptId,
  CASE WHEN length(receipt.payload_json)<=16384 THEN receipt.payload_json ELSE NULL END AS receiptJson,
  CASE WHEN trip.status='completed' AND trip.fare_kobo=p.amount_kobo AND trip.completed_at=p.completed_at
    AND trip.customer_id=p.customer_id AND trip.driver_id=p.driver_id THEN 1 ELSE 0 END AS tripMatches,
  CASE WHEN EXISTS (SELECT 1 FROM payment_attempts succeeded WHERE succeeded.ride_id=p.ride_id AND succeeded.status='succeeded'
    AND (p.status<>'paid' OR p.current_attempt_id IS NULL OR succeeded.id<>p.current_attempt_id)) THEN 1 ELSE 0 END AS succeededMismatch`;
function where(filter) {
  const clauses = ['p.completed_at>=$start', 'p.completed_at<$end'];
  const values = { start: filter.range.start, end: filter.range.end };
  if (filter.status !== 'all') { clauses.push('p.status=$status'); values.status = filter.status; }
  if (filter.q) {
    clauses.push(`(substr(lower(p.ride_id),1,$qLength)=$q OR EXISTS (SELECT 1 FROM payment_attempts searched
      WHERE searched.ride_id=p.ride_id AND substr(lower(searched.reference),1,$qLength)=$q))`);
    values.q = filter.q; values.qLength = filter.q.length;
  }
  return { clauses, values };
}
function seek(clauses, values, before, time, id) {
  if (!before) return;
  clauses.push(`(${time}<$cursorTime OR (${time}=$cursorTime AND ${id}<$cursorId))`);
  values.cursorTime = before.time; values.cursorId = before.id;
}
function metadata(row) {
  if (!row) return null;
  const { receiptJson, ...result } = row;
  result.receiptMetadata = null;
  if (typeof receiptJson !== 'string') return result;
  try {
    const parsed = JSON.parse(receiptJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result.receiptMetadata = Object.fromEntries(
      ['rideId', 'number', 'reference', 'mode', 'currency', 'amountKobo', 'completedAt', 'paidAt']
        .map((key) => [key, ['string', 'number'].includes(typeof parsed[key]) ? parsed[key] : null]));
  } catch { /* Malformed receipt metadata becomes a local integrity finding. */ }
  return result;
}
export function createAdminFinanceRepository(db) {
  async function records(filter, before, limit) {
    const { clauses, values } = where(filter);
    seek(clauses, values, before, 'p.completed_at', 'p.ride_id'); values.limit = limit;
    const rows = await db.prepare(`SELECT ${columns} ${joins} WHERE ${clauses.join(' AND ')}
      ORDER BY p.completed_at DESC,p.ride_id DESC LIMIT $limit`).all(values);
    return rows.map(metadata);
  }
  return Object.freeze({
    list: (filter) => records(filter, filter.before, filter.limit + 1),
    async *facts(filter) {
      let before = null;
      while (true) {
        const rows = await records(filter, before, 1000);
        for (const row of rows) yield row;
        if (rows.length < 1000) return;
        const last = rows.at(-1); before = { time: Number(last.completedAt), id: last.rideId };
      }
    },
    async get(id) { return metadata(await db.prepare(`SELECT ${columns} ${joins} WHERE p.ride_id=?`).get(id)); },
    async attempts(id, filter) {
      const clauses = ['ride_id=$id'], values = { id, limit: filter.limit + 1 };
      seek(clauses, values, filter.before, 'created_at', 'id');
      return db.prepare(`SELECT id,reference,CAST(amount_kobo AS TEXT) AS amountKobo,currency,provider,status,
        created_at AS createdAt,resolved_at AS resolvedAt FROM payment_attempts WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC,id DESC LIMIT $limit`).all(values);
    },
  });
}
