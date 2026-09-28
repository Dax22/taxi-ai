import { createSafetyMonitoringRepository } from './modules/safety-monitoring/repository.mjs';
import { createSafetyMonitoringService } from './modules/safety-monitoring/service.mjs';
import { createSafetyAlertProvider } from './infrastructure/safety-alert-provider.mjs';
import { createDeviceSessionsRepository } from './modules/device-sessions/repository.mjs';
import { createDeviceSessionsService } from './modules/device-sessions/service.mjs';
import { createSafetyRepository } from './modules/safety/repository.mjs';
import { createSafetyService } from './modules/safety/service.mjs';
import { createGuestRidesRepository } from './modules/guest-rides/repository.mjs';
import { createGuestRidesService } from './modules/guest-rides/service.mjs';
import { createParcelTrackingRepository } from './modules/parcel-tracking/repository.mjs';
import { createParcelTrackingService } from './modules/parcel-tracking/service.mjs';
import { MAX_DRIVER_FILE_BYTES } from '../../../packages/shared/src/driver-onboarding.mjs';
import { createDriverDocumentCodec } from './infrastructure/driver-document-codec.mjs';
import { createDriverFaceProvider } from './infrastructure/driver-face-provider.mjs';
import { readDriverFaceConfig } from './infrastructure/driver-face-config.mjs';
import { asAsyncDatabase } from './infrastructure/async-database.mjs';
import { passwords } from './infrastructure/passwords.mjs';
import { tokens } from './infrastructure/tokens.mjs';
import { createAudit } from './infrastructure/audit.mjs';
import { createRateLimiter } from './infrastructure/rate-limiter.mjs';
import { createAccountsRepository } from './modules/accounts/repository.mjs';
import { createAccountsService } from './modules/accounts/service.mjs';
import { createDriversRepository } from './modules/drivers/repository.mjs';
import { createDriversService } from './modules/drivers/service.mjs';
import { createDriverFaceChecks } from './modules/driver-face-checks/service.mjs';
import { vehicleDetails } from './modules/drivers/domain.mjs';
import { createRidesRepository } from './modules/rides/repository.mjs';
import { createDeliveriesRepository } from './modules/deliveries/repository.mjs';
import { createDeliveriesService } from './modules/deliveries/service.mjs';
import { createRidesService } from './modules/rides/service.mjs';
import { createEatsRepository } from './modules/eats/repository.mjs';
import { deliveryAreas, EATS_LEGACY_AREA_IDS } from '../../../packages/shared/src/eats.mjs';
import { distanceMeters } from '../../../packages/shared/src/locations.mjs';
import { normaliseFoodPhoto } from './infrastructure/food-photo-codec.mjs';
import { createEatsService } from './modules/eats/service.mjs';
import { normalizeDishPhoto } from './infrastructure/eats-photo-codec.mjs';
import { createChatRepository } from './modules/chat/repository.mjs';
import { createChatService } from './modules/chat/service.mjs';
import { createCallsRepository } from './modules/calls/repository.mjs';
import { createCallsService } from './modules/calls/service.mjs';
import { createCallConfig } from './infrastructure/call-config.mjs';
import { createMapProvider } from './infrastructure/map-provider.mjs';
import { createPickupEtaProvider } from './infrastructure/pickup-eta.mjs';
import { createDispatchConfig } from './infrastructure/dispatch-config.mjs';
import { createDispatchRepository } from './modules/dispatch/repository.mjs';
import { createDispatchService } from './modules/dispatch/service.mjs';
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
import { createRealtimeRepository } from './modules/realtime/repository.mjs';
import { createRealtimeService } from './modules/realtime/service.mjs';
import { createWorkerCoordinationRepository } from './modules/worker-coordination/repository.mjs';
import { createWorkerCoordinator } from './infrastructure/worker-coordinator.mjs';
import { createWorkerConfig } from './infrastructure/worker-config.mjs';
import { createFamilyRepository } from './modules/family/repository.mjs';
import { createFamilyService } from './modules/family/service.mjs';
import { createFamilyDeliveryRepository } from './modules/family-delivery/repository.mjs';
import { createFamilyDeliveryService } from './modules/family-delivery/service.mjs';
import { createStaffAccessRepository } from './modules/staff-access/repository.mjs';
import { createStaffAccessService } from './modules/staff-access/service.mjs';
import { createStaffMfaConfig } from './infrastructure/staff-config.mjs';
import { createAdminCasesRepository } from './modules/admin-cases/repository.mjs';
import { createAdminCasesService } from './modules/admin-cases/service.mjs';
import { createAdminOperationsRepository } from './modules/admin-operations/repository.mjs';
import { createAdminOperationsService } from './modules/admin-operations/service.mjs';
import { createAdminFinanceRepository } from './modules/admin-finance/repository.mjs';
import { createAdminFinanceService } from './modules/admin-finance/service.mjs';
import { createAdminComplianceRepository } from './modules/admin-compliance/repository.mjs';
import { createAdminComplianceService } from './modules/admin-compliance/service.mjs';
import { createAdminDemandRepository } from './modules/admin-demand/repository.mjs';
import { createAdminDemandService } from './modules/admin-demand/service.mjs';
import { createAnnouncementsRepository } from './modules/announcements/repository.mjs';
import { createAnnouncementsService } from './modules/announcements/service.mjs';

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now, callConfig = createCallConfig(), mapProvider = createMapProvider(), allowSimulation = false,
  dispatchConfig = createDispatchConfig(), workerConfig = createWorkerConfig(), staffMfa = createStaffMfaConfig(),
  driverFaceProvider = createDriverFaceProvider({ config: readDriverFaceConfig({}) }),
  safetyAlertProvider = createSafetyAlertProvider(), accountMail = createAccountMail(), pushProvider = createPushProvider(), vehicleVisionProvider = createVehicleVisionProvider(),
  googleProvider = createGoogleProvider({ config: createGoogleConfig({}), clock }) }) {
  db = asAsyncDatabase(db);
  const unitOfWork = async (run) => (await db.transaction(run));
  const audit = createAudit(db);
  const realtime = createRealtimeService({ repository: createRealtimeRepository(db), clock });
  const workerCoordinator = createWorkerCoordinator({ repository: createWorkerCoordinationRepository(db),
    ownerId: workerConfig.ownerId, leaseMs: workerConfig.leaseMs });
  const accountRepository = createAccountsRepository(db);
  const driverRepository = createDriversRepository(db);
  const rideRepository = createRidesRepository(db);
  const guestRepository = createGuestRidesRepository(db);
  const eatsRepository = createEatsRepository(db, { deliveryAreas, legacyAreaIds: EATS_LEGACY_AREA_IDS, distanceMeters });
  const hasDriverWork = async (id) => (await rideRepository.hasDriverWork(id)) || (await eatsRepository.hasWork(id));
  let drivers, devices, accountEmail;
  const accounts = createAccountsService({ repository: accountRepository,
    driverProfiles: { insert: driverRepository.insert, remove: driverRepository.remove,
      version: async (id) => (await driverRepository.application(id))?.version, hasWork: hasDriverWork,
      stopWork: async (id, now) => { (await availability.onProfileDeleted(id, now)); (await notifications.onProfileDeleted(id, now)); },
      validateVehicle: (data) => vehicleDetails(data, clock()), find: async (id) => {
      const driver = (await driverRepository.find(id));
      return driver ? { ...driver, eligibility: (await drivers.eligibilityFor(id)) } : null;
    } },
    passwords, tokens, unitOfWork, audit, revokeDevices: async (id) => (await devices.revokeUser(id)),
    revokeRecoveryLinks: async (id) => {
      const recovery = createAccountEmailRepository(db);
      await recovery.deleteUserTokens(id); await recovery.deleteUserJobs(id);
    },
    onRegistered: async (id) => (await accountEmail.onRegistered(id)), hasRideHistory: rideRepository.hasHistory, clock });
  devices = createDeviceSessionsService({ repository: createDeviceSessionsRepository(db),
    authenticate: accounts.login, validatePasswordLogin: accounts.validatePasswordLogin, consumePasswordLogin: accounts.consumePasswordLogin,
    getAccount: accounts.profile, tokens, unitOfWork, audit, clock });
  drivers = createDriversService({ repository: driverRepository,
    getAccount: accounts.profile, hasDriverWork, codec: createDriverDocumentCodec(MAX_DRIVER_FILE_BYTES),
    faceProvider: driverFaceProvider, faceChecksFactory: createDriverFaceChecks, tokens, unitOfWork, audit, clock });
  let calls, locations, payments, safety, guestRides, parcelTracking, notifications, family, familyDelivery, adminCases;
  const staffAccess = createStaffAccessService({ repository: createStaffAccessRepository(db), getAccount: accounts.profile,
    getAccountByEmail: async email => {
      const record = await accountRepository.findByEmail(email);
      return record ? await accounts.profile(record.id) : null;
    }, verifyPassword: async (userId, password) => {
      const account = await accounts.profile(userId);
      return Boolean(account && (await accounts.login({ email: account.email, password })).id === userId);
    }, sessionOwner: async token => (await accounts.sessionFor(token))?.user.id ?? null,
    revokeSessions: async id => { await accountRepository.deleteUserSessions(id); await devices.revokeUser(id); },
    factor: staffMfa.factor, mfaRequired: staffMfa.required, tokens, unitOfWork, audit, clock });
  const availability = createAvailabilityService({ repository: createAvailabilityRepository(db),
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, nativeSessionFor: devices.sessionFor, nativeSessionOwner: devices.sessionOwner, isBusy: async (id) => (await rideRepository.hasNegotiation(id)) || (await rideRepository.hasCustomerWork(id, clock())) || (await eatsRepository.hasWork(id)),
    unitOfWork, tokens, audit, clock, allowSimulation });
  const pickupEta = createPickupEtaProvider({ mapProvider, now: clock });
  const dispatch = createDispatchService({ repository: createDispatchRepository(db), getAccount: accounts.profile, coordinator: workerCoordinator,
    candidates: async (now, options) => (await rides.dispatchCandidates(now, options)), candidateFor: async (rideId, driverId, now) => (await rides.dispatchCandidateFor(rideId, driverId, now)),
    estimateMany: pickupEta.estimateMany, config: dispatchConfig, unitOfWork, tokens, audit, clock,
    onOffer: async (offer) => (await notifications.publish({ userId: offer.driverId, rideId: offer.rideId, kind: 'request',
      mode: 'work', eventKey: `dispatch:${offer.id}`, now: offer.createdAt })) });
  const rides = createRidesService({ repository: rideRepository,
    dispatch,
    isParcelRecipient: async (userId, rideId) => await parcelTracking.isRecipient(userId, rideId),
    passengerForRide: guestRepository.passenger, savePassenger: guestRepository.savePassenger,
    hasOtherWork: eatsRepository.hasWork,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock,
    deliveries: createDeliveriesService({ repository: createDeliveriesRepository(db), tokens }),
    routeForRide: async (id) => (await locations.routeForRide(id)),
    quoteForRide: async (userId, id, now) => (await locations.quoteForRide(userId, id, now)),
    bindQuote: async (userId, id, rideId, now) => (await locations.bindQuote(userId, id, rideId, now)),
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, availableDriverIds: availability.driverIds,
    nearbyDriverIds: availability.nearbyDriverIds, allowSimulation,
    onEvent: async ({ kind, ride, actorId, recipients = [], eventKey, now }) => {
      (await dispatch.observe({ kind, rideId: ride.id, locationMode: (await locations.routeForRide(ride.id)) ? 'gps' : 'sample', now }));
      const targets = kind === 'request' ? recipients : [ride.customerId,ride.driverId].filter((id) => id && id !== actorId);
      for (const userId of targets) (await notifications.publish({ userId, rideId: ride.id, kind,
        mode: userId === ride.customerId ? 'customer' : 'work', eventKey, now }));
      await family.onRideEvent({ rideId: ride.id, kind, eventKey, now });
    },
    onTripCompleted: async (data) => (await payments.recordCompletion(data)),
    onRideClosed: async (id, now) => { (await calls.closeRide(id, now)); (await locations.closeRide(id, now)); (await safety.closeRide(id, now)); (await guestRides.closeRide(id, now)); } });
  const chat = createChatService({ repository: createChatRepository(db), getAccount: accounts.profile,
    getRideContext: rides.conversationContext, listConversationIds: rides.conversationIds, unitOfWork, audit, tokens, clock,
    onMessage: async ({ ride, message }) => {
      const userId = ride.customerId === message.senderId ? ride.driverId : ride.customerId;
      (await notifications.publish({ userId, rideId: ride.id, kind: 'message', mode: userId === ride.customerId ? 'customer' : 'work', eventKey: `message:${message.id}` }));
    } });
  notifications = createNotificationsService({ repository: createNotificationsRepository(db), getAccount: accounts.profile,
    sessionOwner: devices.sessionOwner, provider: pushProvider, unitOfWork, clock,
    shouldSendRequest: async (userId, rideId) => !dispatch.enabled || (await dispatch.forDriver(userId, clock()))?.rideId === rideId,
    getArrival: async (userId, rideId) => {
      const ride = (await rideRepository.find(rideId)), trip = (await rideRepository.findTrip(rideId));
      if (ride?.customerId !== userId || !trip?.arrivedAt || !ride.driverSnapshotJson) return null;
      return { status: trip.status, driver: JSON.parse(ride.driverSnapshotJson) };
    },
    canOpen: async (user, notification) => {
      if (notification.kind === 'request') {
        const available = (await rides.list(user, 'work')).available.some((r) => r.id === notification.rideId);
        if (!available) (await rides.conversationContext(user, notification.rideId));
      } else (await rides.conversationContext(user, notification.rideId));
    } });
  const announcements = createAnnouncementsService({ repository: createAnnouncementsRepository(db),
    requirePermission: staffAccess.requirePermission, provider: pushProvider,
    validPushTarget: notifications.validFamilyTarget, disablePushTarget: notifications.disableFamilyTarget,
    unitOfWork, tokens, audit, clock });
  const rateLimiter = createRateLimiter({ db, unitOfWork, digest: tokens.digest });
  accountEmail = createAccountEmailService({ repository: createAccountEmailRepository(db), accounts, mail: accountMail,
    passwords, tokens, unitOfWork, rateLimiter, audit, clock });
  calls = createCallsService({ repository: createCallsRepository(db), getAccount: accounts.profile,
    sessionOwner: accounts.sessionOwner, getRideContext: rides.conversationContext, unitOfWork, audit, tokens, clock, config: callConfig });
  locations = createLocationsService({ repository: createLocationsRepository(db), provider: mapProvider,
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, nativeAccessOwner: devices.accessOwner, nativeSessionOwner: devices.sessionOwner,
    getRideContext: rides.conversationContext, unitOfWork, tokens, audit, clock,
    onChange: async (rideId, now) => await family.onLocationEvent(rideId, now) });
  payments = createPaymentsService({ repository: createPaymentsRepository(db), getAccount: accounts.profile,
    tripForPayment: rides.paymentContext, simulate: simulatePayment, unitOfWork, tokens, audit, clock, allowSimulation });
  const vehicleChecks = createVehicleChecksService({ repository:createVehicleChecksRepository(db),provider:vehicleVisionProvider,
    codec:createVehiclePhotoCodec(),getAccount:accounts.profile,getTrip:rides.safetyContext,sessionOwner:accounts.sessionOwner,
    nativeSessionOwner:devices.sessionOwner,unitOfWork,tokens,clock });
  safety = createSafetyService({ repository: createSafetyRepository(db), getAccount: accounts.profile, getTrip: rides.safetyContext,
    vehicleCheckEvidence:vehicleChecks.evidence,
    locationForTrip: locations.safetyPosition, sessionOwner: accounts.sessionOwner, nativeSessionOwner: devices.sessionOwner, unitOfWork, tokens, audit, clock, allowSimulation,
    requireStaffPermission: staffAccess.requirePermission,
    onIncident: async data => await adminCases.onIncident(data),
    onIncidentReviewed: async data => await adminCases.syncIncident(data) });
  const safetyMonitoring = createSafetyMonitoringService({repository:createSafetyMonitoringRepository(db),provider:safetyAlertProvider,
    getAccount:accounts.profile,getTrip:rides.guestContext,locationForTrip:locations.safetyPosition,routeForTrip:locations.routeForRide,
    sessionOwner:accounts.sessionOwner,nativeSessionOwner:devices.sessionOwner,unitOfWork,tokens,audit,clock});
  guestRides = createGuestRidesService({ repository: guestRepository, getAccount: accounts.profile, getTrip: rides.guestContext,
    locationForTrip: locations.safetyPosition, sessionOwner: accounts.sessionOwner, nativeSessionOwner: devices.sessionOwner, unitOfWork, tokens, audit, clock });
  parcelTracking = createParcelTrackingService({ repository: createParcelTrackingRepository(db), getAccount: accounts.profile,
    getTrip: async (user, rideId) => {
      const ride = await rides.get(user, rideId);
      return { rideId: ride.id, customerId: ride.customer.id, driverId: ride.driver?.id ?? null,
        status: ride.status, destination: ride.destination.name, driver: ride.driver,
        delivery: ride.delivery, updatedAt: ride.updatedAt };
    }, locationForTrip: locations.safetyPosition, unitOfWork, tokens, audit, clock });
  family = createFamilyService({ repository: createFamilyRepository(db), getAccount: accounts.profile,
    getAccountByEmail: async (email) => {
      const account = await accountRepository.findByEmail(email);
      return account ? { id: account.id } : null;
    }, getTrip: rides.familyContext,
    listTrips: async (user) => (await rides.list(user, 'customer')).rides.map(ride => ({
      rideId: ride.id, customerId: user.id, status: ride.trip?.status ?? ride.status,
      pickup: ride.pickup.name, destination: ride.destination.name,
      passenger: ride.passenger, vehicleCategory: ride.vehicleCategory, service: ride.service })),
    locationForTrip: locations.safetyPosition, unitOfWork, tokens, audit, clock,
    publish: realtime.publish,
    enqueue: async (eventId, userId) => await familyDelivery.enqueue(eventId, userId),
    deliveryFor: async (eventId, userId) => await familyDelivery.deliveryFor(eventId, userId) });
  familyDelivery = createFamilyDeliveryService({ repository: createFamilyDeliveryRepository(db), provider: pushProvider,
    familyTargets: notifications.familyTargets, validFamilyTarget: notifications.validFamilyTarget,
    disableTarget: notifications.disableFamilyTarget, dispatchable: family.dispatchable,
    unitOfWork, tokens, clock, onChanged: async (userId) => await realtime.publish([userId]) });
  const adminConsole = createAdminConsoleService({ repository: createAdminConsoleRepository(db), audit, clock, unitOfWork,
    requirePermission: async (user, permission) => await staffAccess.requirePermission(user.id, permission) });
  adminCases = createAdminCasesService({ repository: createAdminCasesRepository(db),
    requirePermission: staffAccess.requirePermission, listEligibleStaff: staffAccess.listEligible,
    getTripEvidence: async (rideId, userId) => {
      const { trip } = await adminConsole.trip(await accounts.profile(userId), rideId);
      return { rideId: trip.id, status: trip.status, pickup: trip.pickup, destination: trip.destination,
        customer: trip.customer, driver: trip.driver ? { ...trip.driver, vehicle: trip.vehicle } : null };
    }, getIncidentEvidence: safety.staffCaseEvidence, reviewIncident: safety.staffCaseReview,
    unitOfWork, tokens, audit, clock });
  const adminOperations = createAdminOperationsService({ repository: createAdminOperationsRepository(db),
    requirePermission: staffAccess.requirePermission, clock, unitOfWork, locationForTrip: locations.safetyPosition, allowSimulation });
  const adminFinance = createAdminFinanceService({ repository: createAdminFinanceRepository(db),
    requirePermission: staffAccess.requirePermission, unitOfWork, clock, audit });
  const adminCompliance = createAdminComplianceService({ repository: createAdminComplianceRepository(db),
    getEligibility: drivers.eligibilityFor, requirePermission: staffAccess.requirePermission,
    unitOfWork, tokens, audit, clock });
  const adminDemand = createAdminDemandService({ repository: createAdminDemandRepository(db),
    requirePermission: staffAccess.requirePermission, unitOfWork, clock, allowSimulation });
  const eats = createEatsService({ repository: eatsRepository, getAccount: accounts.profile, photoCodec: { normalize: normalizeDishPhoto },
    hasOtherWork: async (id) => (await rideRepository.hasDriverWork(id)) || (await rideRepository.hasCustomerWork(id, clock())),
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, tokens, unitOfWork, audit, clock, normalisePhoto: normaliseFoodPhoto });
  const googleAuth = createGoogleAuthService({ repository: createGoogleAuthRepository(db), provider: googleProvider,
    accounts, devices, tokens, unitOfWork, clock });
  return Object.freeze({ accounts, devices, drivers, rides, dispatch, eats, chat, calls, locations, availability, payments, safety, safetyMonitoring, guestRides, parcelTracking, family, familyDelivery, vehicleChecks, adminConsole, staffAccess, adminCases, adminOperations, adminFinance, adminCompliance, adminDemand, announcements, googleAuth, accountEmail, notifications, rateLimiter, realtime, workerCoordinator, clock });
}
