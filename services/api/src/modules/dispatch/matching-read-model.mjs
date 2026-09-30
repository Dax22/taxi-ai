import { AVAILABILITY_MS, POSITION_MS } from '../../../../../packages/shared/src/matching.mjs';
import { vehicleMatches } from '../../../../../packages/shared/src/transport-categories.mjs';
import { matchingPairKey } from '../../shared/matching-pair-key.mjs';

const PAGE = 200;
const unique = (ids) => [...new Set(ids)];

/**
 * Internal, read-only matching projection. This is deliberately not an account
 * or public-location API. SQL joins the owning modules' current records, while
 * eligibility and vehicle compatibility remain their existing domain policies.
 * Each call is bounded and has no process-wide cache. Discovery may reuse its
 * results only within one cycle; commit must call again inside its transaction.
 */
export function createMatchingReadModel({ repository, driverEligibility, clock, allowSimulation = false, includesRegion = () => true }) {
  async function drivers(ids, now) {
    const result = new Map(); ids = unique(ids);
    for (let offset = 0; offset < ids.length; offset += PAGE) {
      const page = ids.slice(offset, offset + PAGE), sessionNow = clock();
      const rows = await repository.driverRows(page, now, sessionNow);
      const documents = await repository.documents(page);
      const documentsByDriver = new Map();
      for (const document of documents) {
        if (!documentsByDriver.has(document.driverId)) documentsByDriver.set(document.driverId, []);
        documentsByDriver.get(document.driverId).push(document);
      }
      for (const row of rows) {
        if (row.role === 'admin' || !row.driverCapability || row.status !== 'approved' || !row.sessionActive
          || row.nativeSessionId && !row.customerCapability || row.driverBusy || row.customerBusy || row.eatsBusy) continue;
        const details = row.detailsJson ? JSON.parse(row.detailsJson) : null;
        const application = { status: row.applicationStatus, details,
          verification: row.verificationJson ? JSON.parse(row.verificationJson) : null };
        if (!driverEligibility(application, documentsByDriver.get(row.id) ?? [], clock()).eligible) continue;
        const position = row.positionJson ? JSON.parse(row.positionJson) : null;
        if (row.mode === 'sample' && !allowSimulation || now >= row.seenAt + AVAILABILITY_MS
          || row.mode === 'gps' && now >= position.capturedAt + POSITION_MS) continue;
        const approved = details.vehicle;
        const vehicle = { model: row.vehicleModel, plate: row.vehiclePlate,
          ...(approved ? { make: approved.make, modelName: approved.model, year: approved.year, colour: approved.colour,
            category: approved.category ?? 'standard', payloadKg: approved.payloadKg ?? null } : {}) };
        result.set(row.id, { vehicle, availability: { id: row.availabilityId, mode: row.mode, areaId: row.areaId, position } });
      }
    }
    return result;
  }
  async function rides(ids) {
    const result = new Map(); ids = unique(ids);
    for (let offset = 0; offset < ids.length; offset += PAGE) {
      const page = ids.slice(offset, offset + PAGE);
      const rows = await repository.rideRows(page);
      for (const { routeJson, deliveryJson, recipientId, ...ride } of rows) result.set(ride.id, {
        ride, route: routeJson ? JSON.parse(routeJson) : null,
        weightKg: deliveryJson ? JSON.parse(deliveryJson).weightKg : null, recipientId });
    }
    return result;
  }
  async function attemptedMany(edges) {
    const result = new Set();
    // Join only the requested pairs; historical attempts cannot grow a response
    // without bound. Keep parameters under SQLite's lowest supported limit.
    for (let offset = 0; offset < edges.length; offset += PAGE) {
      const page = edges.slice(offset, offset + PAGE);
      const rows = await repository.attemptedRows(page);
      for (const row of rows) result.add(matchingPairKey(row.rideId, row.driverId));
    }
    return result;
  }
  return Object.freeze({ drivers, rides, attemptedMany, enabledFor: includesRegion,
    matches: (context, driverId, vehicle) => context.ride.customerId !== driverId && context.recipientId !== driverId
      && vehicleMatches(vehicle, context.ride.vehicleCategory, context.weightKg) });
}
