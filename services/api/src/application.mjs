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

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now }) {
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
  const rides = createRidesService({ repository: rideRepository,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock });
  const chat = createChatService({ repository: createChatRepository(db), getAccount: accounts.profile,
    getRideContext: rides.conversationContext, listConversationIds: rides.conversationIds, unitOfWork, audit, tokens, clock });
  const rateLimiter = createRateLimiter({ db, unitOfWork, digest: tokens.digest });
  return Object.freeze({ accounts, drivers, rides, chat, rateLimiter, clock });
}
