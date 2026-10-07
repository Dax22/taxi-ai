/** Case-scoped evidence reads. Never select passwords, PINs, device tokens, call SDP, biometric templates or raw private keys. */
export function createAdminInvestigationsRepository(db) {
  return Object.freeze({
    ride: id => db.prepare(`SELECT r.id,r.customer_id AS customerId,r.driver_id AS workerId,u.name AS customerName,u.email AS customerEmail,
      w.name AS workerName,w.email AS workerEmail,r.status AS requestStatus,r.closed_reason AS closedReason,r.vehicle_category AS vehicleCategory,
      r.created_at AS createdAt,r.matched_at AS matchedAt,r.updated_at AS updatedAt,r.suggested_fare_kobo AS suggestedFareKobo,
      r.driver_snapshot_json AS driverSnapshotJson,q.route_json AS routeJson,t.status AS tripStatus,t.fare_kobo AS agreedFareKobo,
      t.booked_at AS bookedAt,t.departed_at AS departedAt,t.arrived_at AS arrivedAt,t.started_at AS startedAt,t.completed_at AS completedAt,
      p.mode AS paymentMode,p.status AS paymentStatus,p.paid_at AS paidAt,pa.reference AS paymentReference,
      cp.status AS checkoutStatus,cp.reference AS checkoutReference,cp.paid_at AS checkoutPaidAt,
      d.details_json AS parcelDetailsJson,d.verified_at AS parcelVerifiedAt
      FROM rides r JOIN users u ON u.id=r.customer_id LEFT JOIN users w ON w.id=r.driver_id
      LEFT JOIN location_quotes q ON q.ride_id=r.id LEFT JOIN ride_trips t ON t.ride_id=r.id
      LEFT JOIN delivery_orders d ON d.ride_id=r.id LEFT JOIN payments p ON p.ride_id=r.id
      LEFT JOIN payment_attempts pa ON pa.id=p.current_attempt_id
      LEFT JOIN checkout_payments cp ON cp.kind='ride' AND cp.target_id=r.id WHERE r.id=?`).get(id),
    food: id => db.prepare(`SELECT o.id,o.store_id AS storeId,o.customer_id AS customerId,o.courier_id AS workerId,
      u.name AS customerName,u.email AS customerEmail,w.name AS workerName,w.email AS workerEmail,
      o.status AS orderStatus,o.created_at AS createdAt,o.updated_at AS updatedAt,
      o.snapshot_json AS snapshotJson,o.courier_json AS courierJson,o.events_json AS eventsJson,
      s.details_json AS storeDetailsJson,cp.reference AS checkoutReference,cp.status AS checkoutStatus,cp.paid_at AS checkoutPaidAt
      FROM eats_orders o JOIN users u ON u.id=o.customer_id LEFT JOIN users w ON w.id=o.courier_id
      JOIN eats_stores s ON s.id=o.store_id
      LEFT JOIN checkout_payments cp ON cp.kind='food' AND cp.target_id=json_extract(o.snapshot_json,'$.payment.targetId') WHERE o.id=?`).get(id),
    driver: id => db.prepare(`SELECT u.id,u.name,u.email,u.created_at AS accountCreatedAt,d.status AS driverStatus,
      d.vehicle_model AS vehicleModel,d.vehicle_plate AS vehiclePlate,d.reviewed_at AS driverReviewedAt,
      a.status AS applicationStatus,a.version AS applicationVersion,a.details_json AS detailsJson,
      a.submitted_at AS submittedAt,a.reviewed_at AS applicationReviewedAt,a.review_reason AS reviewReason,
      a.verification_json AS verificationJson FROM users u LEFT JOIN drivers d ON d.user_id=u.id
      LEFT JOIN driver_applications a ON a.driver_id=u.id WHERE u.id=?`).get(id),
    documents: id => db.prepare(`SELECT id,kind,name,mime_type AS mimeType,size_bytes AS sizeBytes,sha256,expires_on AS expiresOn,created_at AS createdAt
      FROM driver_documents WHERE driver_id=? ORDER BY kind,id`).all(id),
    document: id => db.prepare(`SELECT id,kind,mime_type AS mimeType,size_bytes AS sizeBytes,sha256,content FROM driver_documents WHERE id=?`).get(id),
    applicationEvents: id => db.prepare(`SELECT e.action,e.version,e.created_at AS createdAt,e.actor_id AS actorId,
      json_extract(e.payload_json,'$.reason') AS reason FROM driver_application_events e WHERE e.driver_id=? ORDER BY e.id ASC LIMIT 200`).all(id),
    fareEvents: id => db.prepare('SELECT version,type,payload FROM fare_events WHERE ride_id=? ORDER BY version LIMIT 501').all(id),
    rideEvents: id => db.prepare(`SELECT a.type,a.reason,a.created_at AS createdAt,a.actor_id AS actorId
      FROM ride_activity a WHERE a.ride_id=? ORDER BY a.id LIMIT 501`).all(id),
    dispatch: id => db.prepare(`SELECT id,driver_id AS driverId,status,eta_source AS etaSource,pickup_eta_seconds AS pickupEtaSeconds,
      estimated_at AS estimatedAt,created_at AS createdAt,expires_at AS expiresAt,closed_at AS closedAt
      FROM dispatch_offers WHERE ride_id=? ORDER BY created_at,id LIMIT 501`).all(id),
    messages: id => db.prepare(`SELECT sequence,sender_id AS senderId,body,created_at AS createdAt
      FROM chat_messages WHERE ride_id=? ORDER BY sequence LIMIT 501`).all(id),
    calls: id => db.prepare(`SELECT id,caller_id AS callerId,callee_id AS calleeId,mode,status,created_at AS createdAt,
      answered_at AS answeredAt,connected_at AS connectedAt,ended_at AS endedAt,reason FROM voice_calls WHERE ride_id=? ORDER BY created_at,id LIMIT 501`).all(id),
    rideLocation: id => db.prepare(`SELECT started_at AS startedAt,seen_at AS lastSeenAt,stopped_at AS stoppedAt,sequence,active
      FROM location_shares WHERE ride_id=? ORDER BY started_at,id LIMIT 501`).all(id),
    foodLocation: id => db.prepare(`SELECT started_at AS startedAt,seen_at AS lastSeenAt,stopped_at AS stoppedAt,sequence,active
      FROM eats_location_shares WHERE order_id=? ORDER BY started_at,id LIMIT 501`).all(id),
    safety: id => db.prepare(`SELECT id,reporter_id AS reporterId,kind,note,status,created_at AS createdAt,updated_at AS updatedAt,
      acknowledged_by AS acknowledgedBy,resolved_at AS resolvedAt FROM safety_incidents WHERE ride_id=? ORDER BY created_at,id LIMIT 501`).all(id),
    locationEvidence: (kind,id) => db.prepare(`SELECT resource_kind AS resourceKind,transaction_id AS transactionId,share_id AS shareId,
      driver_id AS driverId,sequence,latitude,longitude,accuracy_meters AS accuracyMeters,captured_at AS capturedAt,recorded_at AS recordedAt
      FROM investigation_location_evidence WHERE resource_kind=? AND transaction_id=? ORDER BY captured_at,share_id,sequence LIMIT 5001`)
      .all(kind==='food'?'food':'ride',id),
    locationEvidenceCount: (kind,id) => (db.prepare('SELECT count(*) AS n FROM investigation_location_evidence WHERE resource_kind=? AND transaction_id=?')
      .get(kind==='food'?'food':'ride',id)).n,
    guestPassenger: id => db.prepare('SELECT snapshot_json AS snapshotJson FROM guest_ride_passengers WHERE ride_id=?').get(id),
    handover: id => db.prepare(`SELECT verified_at AS verifiedAt,verification_method AS method,position_recorded AS positionRecorded
      FROM delivery_handover_evidence WHERE ride_id=?`).get(id),
    prior: (kind,id) => db.prepare(`SELECT id,actor_id AS actorId,case_reference AS caseReference,requesting_authority AS requestingAuthority,
      legal_basis AS legalBasis,included_documents AS includedDocuments,included_messages AS includedMessages,included_location AS includedLocation,
      archive_sha256 AS archiveSha256,created_at AS createdAt
      FROM investigation_exports WHERE service=? AND transaction_id=? ORDER BY created_at DESC,id DESC LIMIT 30`).all(kind,id),
    record: row => db.prepare(`INSERT INTO investigation_exports(id,actor_id,service,transaction_id,driver_id,case_reference,requesting_authority,
      authority_reference,legal_basis,purpose,included_documents,included_messages,included_location,manifest_sha256,archive_sha256,archive_bytes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.actorId,row.kind,row.transactionId,row.driverId,row.caseReference,row.requestingAuthority,row.authorityReference,
       row.legalBasis,row.purpose,row.includeDocuments?1:0,row.includeMessages?1:0,row.includeLocation?1:0,row.manifestSha256,row.archiveSha256,row.archiveBytes,row.createdAt),
  });
}
