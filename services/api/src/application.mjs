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

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now, callConfig = createCallConfig(), mapProvider = createMapProvider() }) {
  const unitOfWork = (run) => transaction(db, run);
  const audit = createAudit(db);
  const accountRepository = createAccountsRepository(db);
  const driverRepository = createDriversRepository(db);
  const rideRepository = createRidesRepository(db);
  const accounts = createAccountsService({ repository: accountRepository,
    driverProfiles: { find: driverRepository.find, insert: driverRepository.insert },
    passwords, tokens, unitOfWork, audit, hasRideHistory: rideRepository.hasHistory, clock });
  const drivers = createDriversService({ repository: driverRepository,
    getAccount: accounts.profile, unitOfWork, audit, clock });
  let calls, locations;
  const rides = createRidesService({ repository: rideRepository,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock,
    routeForRide: (id) => locations.routeForRide(id),
    quoteForRide: (userId, id, now) => locations.quoteForRide(userId, id, now),
    bindQuote: (userId, id, rideId, now) => locations.bindQuote(userId, id, rideId, now),
    onRideClosed: (id, now) => { calls.closeRide(id, now); locations.closeRide(id, now); } });
  const chat = createChatService({ repository: createChatRepository(db), getAccount: accounts.profile,
    getRideContext: rides.conversationContext, listConversationIds: rides.conversationIds, unitOfWork, audit, tokens, clock });
  const rateLimiter = createRateLimiter({ db, unitOfWork, digest: tokens.digest });
  calls = createCallsService({ repository: createCallsRepository(db), getAccount: accounts.profile,
    sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, audit, tokens, clock, config: callConfig });
  locations = createLocationsService({ repository: createLocationsRepository(db), provider: mapProvider,
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, tokens, audit, clock });
  return Object.freeze({ accounts, drivers, rides, chat, calls, locations, rateLimiter, clock });
}
