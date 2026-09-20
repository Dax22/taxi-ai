import { createSafetyRepository } from './modules/safety/repository.mjs';
import { createSafetyService } from './modules/safety/service.mjs';
import { MAX_DRIVER_FILE_BYTES } from '../../../packages/shared/src/driver-onboarding.mjs';
import { createDriverDocumentCodec } from './infrastructure/driver-document-codec.mjs';
import { transaction } from './infrastructure/database.mjs';
import { passwords } from './infrastructure/passwords.mjs';
import { tokens } from './infrastructure/tokens.mjs';
import { createAudit } from './infrastructure/audit.mjs';
import { createRateLimiter } from './infrastructure/rate-limiter.mjs';
import { createAccountsRepository } from './modules/accounts/repository.mjs';
import { createAccountsService } from './modules/accounts/service.mjs';
import { createDriversRepository } from './modules/drivers/repository.mjs';
import { createDriversService } from './modules/drivers/service.mjs';
import { createRidesRepository } from './modules/rides/repository.mjs';
import { createRidesService } from './modules/rides/service.mjs';
import { createChatRepository } from './modules/chat/repository.mjs';
import { createChatService } from './modules/chat/service.mjs';
import { createCallsRepository } from './modules/calls/repository.mjs';
import { createCallsService } from './modules/calls/service.mjs';
import { createCallConfig } from './infrastructure/call-config.mjs';
import { createMapProvider } from './infrastructure/map-provider.mjs';
import { createLocationsRepository } from './modules/locations/repository.mjs';
import { createLocationsService } from './modules/locations/service.mjs';
import { createAvailabilityRepository } from './modules/availability/repository.mjs';
import { createAvailabilityService } from './modules/availability/service.mjs';
import { createPaymentsRepository } from './modules/payments/repository.mjs';
import { createPaymentsService } from './modules/payments/service.mjs';
import { simulatePayment } from './infrastructure/simulated-payment-provider.mjs';

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now, callConfig = createCallConfig(), mapProvider = createMapProvider(), allowSimulation = false }) {
  const unitOfWork = (run) => transaction(db, run);
  const audit = createAudit(db);
  const accountRepository = createAccountsRepository(db);
  const driverRepository = createDriversRepository(db);
  const rideRepository = createRidesRepository(db);
  let drivers;
  const accounts = createAccountsService({ repository: accountRepository,
    driverProfiles: { insert: driverRepository.insert, find: (id) => {
      const driver = driverRepository.find(id);
      return driver ? { ...driver, eligibility: drivers.eligibilityFor(id) } : null;
    } },
    passwords, tokens, unitOfWork, audit, hasRideHistory: rideRepository.hasHistory, clock });
  drivers = createDriversService({ repository: driverRepository,
    getAccount: accounts.profile, hasDriverWork: rideRepository.hasDriverWork, codec: createDriverDocumentCodec(MAX_DRIVER_FILE_BYTES),
    tokens, unitOfWork, audit, clock });
  let calls, locations, payments, safety;
  const availability = createAvailabilityService({ repository: createAvailabilityRepository(db),
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, isBusy: rideRepository.hasNegotiation,
    unitOfWork, tokens, audit, clock, allowSimulation });
  const rides = createRidesService({ repository: rideRepository,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock,
    routeForRide: (id) => locations.routeForRide(id),
    quoteForRide: (userId, id, now) => locations.quoteForRide(userId, id, now),
    bindQuote: (userId, id, rideId, now) => locations.bindQuote(userId, id, rideId, now),
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, allowSimulation,
    onTripCompleted: (data) => payments.recordCompletion(data),
    onRideClosed: (id, now) => { calls.closeRide(id, now); locations.closeRide(id, now); safety.closeRide(id, now); } });
  const chat = createChatService({ repository: createChatRepository(db), getAccount: accounts.profile,
    getRideContext: rides.conversationContext, listConversationIds: rides.conversationIds, unitOfWork, audit, tokens, clock });
  const rateLimiter = createRateLimiter({ db, unitOfWork, digest: tokens.digest });
  calls = createCallsService({ repository: createCallsRepository(db), getAccount: accounts.profile,
    sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, audit, tokens, clock, config: callConfig });
  locations = createLocationsService({ repository: createLocationsRepository(db), provider: mapProvider,
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, tokens, audit, clock });
  payments = createPaymentsService({ repository: createPaymentsRepository(db), getAccount: accounts.profile,
    tripForPayment: rides.paymentContext, simulate: simulatePayment, unitOfWork, tokens, audit, clock, allowSimulation });
  safety = createSafetyService({ repository: createSafetyRepository(db), getAccount: accounts.profile, getTrip: rides.safetyContext,
    locationForTrip: locations.safetyPosition, sessionOwner: accounts.sessionOwner, unitOfWork, tokens, audit, clock, allowSimulation });
  return Object.freeze({ accounts, drivers, rides, chat, calls, locations, availability, payments, safety, rateLimiter, clock });
}
