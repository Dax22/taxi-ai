import { createDeviceSessionsRepository } from './modules/device-sessions/repository.mjs';
import { createDeviceSessionsService } from './modules/device-sessions/service.mjs';
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
import { vehicleDetails } from './modules/drivers/domain.mjs';
import { createRidesRepository } from './modules/rides/repository.mjs';
import { createDeliveriesRepository } from './modules/deliveries/repository.mjs';
import { createDeliveriesService } from './modules/deliveries/service.mjs';
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
import { createAdminConsoleRepository } from './modules/admin-console/repository.mjs';
import { createAdminConsoleService } from './modules/admin-console/service.mjs';
import { createGoogleAuthRepository } from './modules/google-auth/repository.mjs';
import { createGoogleAuthService } from './modules/google-auth/service.mjs';
import { createGoogleProvider } from './infrastructure/google-provider.mjs';
import { createGoogleConfig } from './infrastructure/google-config.mjs';
import { createAccountMail } from './infrastructure/account-mail.mjs';
import { createAccountEmailRepository } from './modules/account-email/repository.mjs';
import { createAccountEmailService } from './modules/account-email/service.mjs';

import { createNotificationsRepository } from './modules/notifications/repository.mjs';
import { createNotificationsService } from './modules/notifications/service.mjs';
import { createPushProvider } from './infrastructure/push-provider.mjs';
import { createVehicleVisionProvider } from './infrastructure/vehicle-vision-provider.mjs';
import { createVehiclePhotoCodec } from './infrastructure/vehicle-photo-codec.mjs';
import { createVehicleChecksRepository } from './modules/vehicle-checks/repository.mjs';
import { createVehicleChecksService } from './modules/vehicle-checks/service.mjs';

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now, callConfig = createCallConfig(), mapProvider = createMapProvider(), allowSimulation = false,
  accountMail = createAccountMail(), pushProvider = createPushProvider(), vehicleVisionProvider = createVehicleVisionProvider(),
  googleProvider = createGoogleProvider({ config: createGoogleConfig({}), clock }) }) {
  const unitOfWork = (run) => transaction(db, run);
  const audit = createAudit(db);
  const accountRepository = createAccountsRepository(db);
  const driverRepository = createDriversRepository(db);
  const rideRepository = createRidesRepository(db);
  let drivers, devices, accountEmail;
  const accounts = createAccountsService({ repository: accountRepository,
    driverProfiles: { insert: driverRepository.insert, remove: driverRepository.remove,
      version: (id) => driverRepository.application(id)?.version, hasWork: rideRepository.hasDriverWork,
      stopWork: (id, now) => { availability.onProfileDeleted(id, now); notifications.onProfileDeleted(id, now); },
      validateVehicle: (data) => vehicleDetails(data, clock()), find: (id) => {
      const driver = driverRepository.find(id);
      return driver ? { ...driver, eligibility: drivers.eligibilityFor(id) } : null;
    } },
    passwords, tokens, unitOfWork, audit, revokeDevices: (id) => devices.revokeUser(id),
    onRegistered: (id) => accountEmail.onRegistered(id), hasRideHistory: rideRepository.hasHistory, clock });
  devices = createDeviceSessionsService({ repository: createDeviceSessionsRepository(db),
    authenticate: accounts.login, validatePasswordLogin: accounts.validatePasswordLogin,
    getAccount: accounts.profile, tokens, unitOfWork, audit, clock });
  drivers = createDriversService({ repository: driverRepository,
    getAccount: accounts.profile, hasDriverWork: rideRepository.hasDriverWork, codec: createDriverDocumentCodec(MAX_DRIVER_FILE_BYTES),
    tokens, unitOfWork, audit, clock });
  let calls, locations, payments, safety, notifications;
  const availability = createAvailabilityService({ repository: createAvailabilityRepository(db),
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, nativeSessionFor: devices.sessionFor, nativeSessionOwner: devices.sessionOwner, isBusy: (id) => rideRepository.hasNegotiation(id) || rideRepository.hasCustomerWork(id, clock()),
    unitOfWork, tokens, audit, clock, allowSimulation });
  const rides = createRidesService({ repository: rideRepository,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock,
    deliveries: createDeliveriesService({ repository: createDeliveriesRepository(db), tokens }),
    routeForRide: (id) => locations.routeForRide(id),
    quoteForRide: (userId, id, now) => locations.quoteForRide(userId, id, now),
    bindQuote: (userId, id, rideId, now) => locations.bindQuote(userId, id, rideId, now),
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, availableDriverIds: availability.driverIds, allowSimulation,
    onEvent: ({ kind, ride, actorId, recipients = [], eventKey, now }) => {
      const targets = kind === 'request' ? recipients : [ride.customerId,ride.driverId].filter((id) => id && id !== actorId);
      for (const userId of targets) notifications.publish({ userId, rideId: ride.id, kind,
        mode: userId === ride.customerId ? 'customer' : 'work', eventKey, now });
    },
    onTripCompleted: (data) => payments.recordCompletion(data),
    onRideClosed: (id, now) => { calls.closeRide(id, now); locations.closeRide(id, now); safety.closeRide(id, now); } });
  const chat = createChatService({ repository: createChatRepository(db), getAccount: accounts.profile,
    getRideContext: rides.conversationContext, listConversationIds: rides.conversationIds, unitOfWork, audit, tokens, clock,
    onMessage: ({ ride, message }) => {
      const userId = ride.customerId === message.senderId ? ride.driverId : ride.customerId;
      notifications.publish({ userId, rideId: ride.id, kind: 'message', mode: userId === ride.customerId ? 'customer' : 'work', eventKey: `message:${message.id}` });
    } });
  notifications = createNotificationsService({ repository: createNotificationsRepository(db), getAccount: accounts.profile,
    sessionOwner: devices.sessionOwner, provider: pushProvider, unitOfWork, clock,
    getArrival: (userId, rideId) => {
      const ride = rideRepository.find(rideId), trip = rideRepository.findTrip(rideId);
      if (ride?.customerId !== userId || !trip?.arrivedAt || !ride.driverSnapshotJson) return null;
      return { status: trip.status, driver: JSON.parse(ride.driverSnapshotJson) };
    },
    canOpen: (user, notification) => {
      if (notification.kind === 'request') {
        const available = rides.list(user, 'work').available.some((r) => r.id === notification.rideId);
        if (!available) rides.conversationContext(user, notification.rideId);
      } else rides.conversationContext(user, notification.rideId);
    } });
  const rateLimiter = createRateLimiter({ db, unitOfWork, digest: tokens.digest });
  accountEmail = createAccountEmailService({ repository: createAccountEmailRepository(db), accounts, mail: accountMail,
    passwords, tokens, unitOfWork, rateLimiter, audit, clock });
  calls = createCallsService({ repository: createCallsRepository(db), getAccount: accounts.profile,
    sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, audit, tokens, clock, config: callConfig });
  locations = createLocationsService({ repository: createLocationsRepository(db), provider: mapProvider,
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, nativeAccessOwner: devices.accessOwner, nativeSessionOwner: devices.sessionOwner,
    getRideContext: rides.conversationContext, unitOfWork, tokens, audit, clock });
  payments = createPaymentsService({ repository: createPaymentsRepository(db), getAccount: accounts.profile,
    tripForPayment: rides.paymentContext, simulate: simulatePayment, unitOfWork, tokens, audit, clock, allowSimulation });
  const vehicleChecks = createVehicleChecksService({ repository:createVehicleChecksRepository(db),provider:vehicleVisionProvider,
    codec:createVehiclePhotoCodec(),getAccount:accounts.profile,getTrip:rides.safetyContext,sessionOwner:accounts.sessionOwner,
    nativeSessionOwner:devices.sessionOwner,unitOfWork,tokens,clock });
  safety = createSafetyService({ repository: createSafetyRepository(db), getAccount: accounts.profile, getTrip: rides.safetyContext,
    vehicleCheckEvidence:vehicleChecks.evidence,
    locationForTrip: locations.safetyPosition, sessionOwner: accounts.sessionOwner, nativeSessionOwner: devices.sessionOwner, unitOfWork, tokens, audit, clock, allowSimulation });
  const adminConsole = createAdminConsoleService({ repository: createAdminConsoleRepository(db), audit, clock, unitOfWork });
  const googleAuth = createGoogleAuthService({ repository: createGoogleAuthRepository(db), provider: googleProvider,
    accounts, devices, tokens, unitOfWork, clock });
  return Object.freeze({ accounts, devices, drivers, rides, chat, calls, locations, availability, payments, safety, vehicleChecks, adminConsole, googleAuth, accountEmail, notifications, rateLimiter, clock });
}
