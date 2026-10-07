import { createAccountControlsRepository } from './modules/account-controls/repository.mjs';
import { createAccountControlsService } from './modules/account-controls/service.mjs';
import { createAdminWorkRepository } from './modules/admin-work-items/repository.mjs';
import { createAdminWorkService } from './modules/admin-work-items/service.mjs';
import { createAdminInsightsRepository } from './modules/admin-insights/repository.mjs';
import { createAdminInsightsService } from './modules/admin-insights/service.mjs';
import { filters as transactionFilters, summarize as transactionSummary } from './modules/admin-transactions/domain.mjs';
import { createAdminTransactionsRepository } from './modules/admin-transactions/repository.mjs';
import { createAdminTransactionsService } from './modules/admin-transactions/service.mjs';
import { createAdminInvestigationsRepository } from './modules/admin-investigations/repository.mjs';
import { createAdminInvestigationsService } from './modules/admin-investigations/service.mjs';
import { evidenceZip, sha256 as evidenceSha256 } from './infrastructure/evidence-zip.mjs';
import { deliveryOperationState } from './modules/delivery-operations/domain.mjs';
import { createAdminSafetyAlertsRepository } from './modules/admin-safety-alerts/repository.mjs';
import { createAdminSafetyAlertsService } from './modules/admin-safety-alerts/service.mjs';
import { createPaystackConfig } from './infrastructure/paystack-config.mjs';
import { createPaystackProvider } from './infrastructure/paystack-provider.mjs';
import { createCheckoutPaymentsRepository } from './modules/checkout-payments/repository.mjs';
import { createCheckoutPaymentsService } from './modules/checkout-payments/service.mjs';
import { createDeliveryUpdatesRepository } from './modules/delivery-updates/repository.mjs';
import { createDeliveryUpdatesService } from './modules/delivery-updates/service.mjs';
import { createDeliveryEtaProvider } from './infrastructure/delivery-eta.mjs';
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
import { createDeliveryOperationsRepository } from './modules/delivery-operations/repository.mjs';
import { createDeliveryOperationsService } from './modules/delivery-operations/service.mjs';
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
import { vehicleDetails, eligibility } from './modules/drivers/domain.mjs';
import { createRidesRepository } from './modules/rides/repository.mjs';
import { createDeliveriesRepository } from './modules/deliveries/repository.mjs';
import { createDeliveriesService } from './modules/deliveries/service.mjs';
import { createRidesService } from './modules/rides/service.mjs';
import { createRidePilotConfig } from '../../../packages/shared/src/ride-pilot.mjs';
import { createEatsRepository } from './modules/eats/repository.mjs';
import { deliveryAreas, EATS_LEGACY_AREA_IDS } from '../../../packages/shared/src/eats.mjs';
import { insideNigeria, distanceMeters } from '../../../packages/shared/src/locations.mjs';
import { NIGERIAN_STATES, foodAreaId } from '../../../packages/shared/src/nigeria-areas.mjs';
import { normaliseFoodPhoto } from './infrastructure/food-photo-codec.mjs';
import { createEatsService } from './modules/eats/service.mjs';
import { normalizeDishPhoto } from './infrastructure/eats-photo-codec.mjs';
import { createChatRepository } from './modules/chat/repository.mjs';
import { createChatService } from './modules/chat/service.mjs';
import { createCallsRepository } from './modules/calls/repository.mjs';
import { createCallsService } from './modules/calls/service.mjs';
import { createCallConfig } from './infrastructure/call-config.mjs';
import { createMapProvider } from './infrastructure/map-provider.mjs';
import { createFoodLocationProvider } from './infrastructure/food-location-provider.mjs';
import { createPickupEtaProvider } from './infrastructure/pickup-eta.mjs';
import { createDispatchConfig } from './infrastructure/dispatch-config.mjs';
import { readMatchingFastConfig } from './infrastructure/matching-fast-config.mjs';
import { createDispatchRepository, createMatchingRepository, createDispatchPerformanceRepository } from './modules/dispatch/repository.mjs';
import { createMatchingReadModel } from './modules/dispatch/matching-read-model.mjs';
import { createDispatchService } from './modules/dispatch/service.mjs';
import { createDispatchPerformanceService } from './modules/dispatch/performance.mjs';
import { readDispatchMlConfig } from './infrastructure/dispatch-ml-config.mjs';
import { loadDispatchMlArtifact } from './infrastructure/dispatch-ml-artifact.mjs';
import { createDispatchMlRepository } from './modules/dispatch/ml/repository.mjs';
import { createDispatchMlRanker } from './modules/dispatch/ml-ranker.mjs';
import { createLocationsRepository, createFoodTrackingRepository } from './modules/locations/repository.mjs';
import { createLocationsService } from './modules/locations/service.mjs';
import { createBackgroundLocationRepository } from './modules/background-locations/repository.mjs';
import { createBackgroundLocationService } from './modules/background-locations/service.mjs';
import { check } from './shared/errors.mjs';
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
import { createAdminMatchingRepository } from './modules/admin-matching/repository.mjs';
import { createAdminMatchingService } from './modules/admin-matching/service.mjs';
import { createAdminAcceptanceRepository } from './modules/admin-acceptance/repository.mjs';
import { createAdminAcceptanceService } from './modules/admin-acceptance/service.mjs';
import { createMobileOperationsRepository } from './modules/mobile-operations/repository.mjs';
import { createMobileOperationsService } from './modules/mobile-operations/service.mjs';
import { readMobileReleasePolicy } from './modules/mobile-operations/domain.mjs';
import { createAdminMobileRepository } from './modules/admin-mobile/repository.mjs';
import { createAdminMobileService } from './modules/admin-mobile/service.mjs';
import { createAnnouncementsRepository } from './modules/announcements/repository.mjs';
import { createAnnouncementsService } from './modules/announcements/service.mjs';

/** Composition root: the only place that wires business modules to adapters. */
export function createApplication({ db, clock = Date.now, callConfig = createCallConfig(), mapProvider = createMapProvider(), allowSimulation = false,
  paystackProvider = createPaystackProvider({ config: createPaystackConfig({}) }),
  resolveDeliveryLocation = createFoodLocationProvider({ env: { ...process.env, TAXI_AI_MAPS_MODE: mapProvider.mode ?? 'off' },
    insideNigeria, distanceMeters, foodAreaId, states: NIGERIAN_STATES }).resolveDeliveryLocation,
  deliveryMapSettings = () => {
    const tiles = mapProvider.describe?.().tiles ?? null;
    return { tiles, attribution: tiles ? '© OpenStreetMap contributors' : '' };
  },
  ridePilot = createRidePilotConfig(), dispatchProfiler = null, matchingFast = readMatchingFastConfig(),
  dispatchConfig = createDispatchConfig(), dispatchMlConfig = readDispatchMlConfig(), dispatchMlModel = loadDispatchMlArtifact(dispatchMlConfig),
  workerConfig = createWorkerConfig(), staffMfa = createStaffMfaConfig(),
  driverFaceProvider = createDriverFaceProvider({ config: readDriverFaceConfig() }),
  safetyAlertProvider = createSafetyAlertProvider(), accountMail = createAccountMail(), pushProvider = createPushProvider(), vehicleVisionProvider = createVehicleVisionProvider(),
  googleProvider = createGoogleProvider({ config: createGoogleConfig({}), clock }) }) {
  db = asAsyncDatabase(db);
  if (dispatchProfiler) db = dispatchProfiler.wrap(db);
  const unitOfWork = async (run) => (await db.transaction(run));
  const dispatchWorkerUnitOfWork = async (run, region) => (await db.transaction(run, {
    isolation: matchingFast.includesRegion(region) ? 'READ COMMITTED' : 'SERIALIZABLE',
  }));
  const audit = createAudit(db);
  const realtime = createRealtimeService({ repository: createRealtimeRepository(db), clock });
  const workerCoordinator = createWorkerCoordinator({ repository: createWorkerCoordinationRepository(db),
    ownerId: workerConfig.ownerId, leaseMs: workerConfig.leaseMs });
  const accountRepository = createAccountsRepository(db);
  const driverRepository = createDriversRepository(db);
  const rideRepository = createRidesRepository(db);
  const guestRepository = createGuestRidesRepository(db);
  const deliveryRepository = createDeliveriesRepository(db);
  const parcelRepository = createParcelTrackingRepository(db);
  const eatsRepository = createEatsRepository(db, { deliveryAreas, legacyAreaIds: EATS_LEGACY_AREA_IDS, distanceMeters, clock });
  const hasDriverWork = async (id) => (await rideRepository.hasDriverWork(id)) || (await eatsRepository.hasWork(id));
  let drivers, devices, accountEmail, accountControls;
  const accounts = createAccountsService({ repository: accountRepository,
    driverProfiles: { insert: driverRepository.insert, remove: driverRepository.remove,
      version: async (id) => (await driverRepository.application(id))?.version, hasWork: hasDriverWork,
      stopWork: async (id, now) => { (await availability.onProfileDeleted(id, now)); (await notifications.onProfileDeleted(id, now)); },
      validateVehicle: (data) => vehicleDetails(data, clock()), find: async (id) => {
      const driver = (await driverRepository.find(id));
      return driver ? { ...driver, eligibility: (await drivers.eligibilityFor(id)) } : null;
    } },
    restrictionsFor: id => accountControls ? accountControls.summary(id) : Promise.resolve({scopes:[],notices:[],moreNotices:false}),
    passwords, tokens, unitOfWork, audit, revokeDevices: async (id) => (await devices.revokeUser(id)),
    revokeRecoveryLinks: async (id) => {
      const recovery = createAccountEmailRepository(db);
      await recovery.deleteUserTokens(id); await recovery.deleteUserJobs(id);
    },
    onRegistered: async (id, context) => (await accountEmail.onRegistered(id, context)), hasRideHistory: rideRepository.hasHistory, clock });
  devices = createDeviceSessionsService({ repository: createDeviceSessionsRepository(db),
    authenticate: accounts.login, validatePasswordLogin: accounts.validatePasswordLogin, consumePasswordLogin: accounts.consumePasswordLogin,
    getAccount: accounts.profile, tokens, unitOfWork, audit, clock });
  const mobileOperations = createMobileOperationsService({ repository: createMobileOperationsRepository(db), clock,
    sampleEvery: Number(process.env.TAXI_AI_MOBILE_API_SAMPLE_EVERY ?? 20) });
  drivers = createDriversService({ repository: driverRepository,
    getAccount: accounts.profile, hasDriverWork, codec: createDriverDocumentCodec(MAX_DRIVER_FILE_BYTES),
    faceProvider: driverFaceProvider, faceChecksFactory: createDriverFaceChecks, tokens, unitOfWork, audit, clock });
  let calls, locations, foodTracking, payments, checkoutPayments, safety, guestRides, parcelTracking, notifications, deliveryUpdates, family, familyDelivery, adminCases;
  let deliveryOperations;
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
  const matching = matchingFast.enabled ? createMatchingReadModel({ repository: createMatchingRepository(db),
    driverEligibility: eligibility, clock, allowSimulation, includesRegion: matchingFast.includesRegion }) : null;
  const dispatchMl = createDispatchMlRanker({ config: dispatchMlConfig, model: dispatchMlModel,
    repository: createDispatchMlRepository(db), tokens, clock });
  const dispatchPerformance = createDispatchPerformanceService({ repository: createDispatchPerformanceRepository(db), tokens, clock });
  const dispatch = createDispatchService({ repository: createDispatchRepository(db), getAccount: accounts.profile, coordinator: workerCoordinator,
    candidates: async (now, options) => (await rides.dispatchCandidates(now, options)), candidateFor: async (rideId, driverId, now) => (await rides.dispatchCandidateFor(rideId, driverId, now)),
    ...(matching ? { candidatesFor: (edges, now) => rides.dispatchCandidatesFor(edges, now),
      attemptedMany: matching.attemptedMany, batchEnabledFor: matching.enabledFor } : {}),
    estimateMany: pickupEta.estimateMany, config: dispatchConfig, unitOfWork, workerUnitOfWork: dispatchWorkerUnitOfWork, tokens, audit, clock, profile: dispatchProfiler, ranker: dispatchMl,
    onOffer: async (offer) => (await notifications.publish({ userId: offer.driverId, rideId: offer.rideId, kind: 'request',
      mode: 'work', eventKey: `dispatch:${offer.id}`, now: offer.createdAt })) });
  const rides = createRidesService({ repository: rideRepository,
    checkoutPayments: { enabled: paystackProvider.enabled, requirePaid: data => checkoutPayments.requirePaid(data), close: data => checkoutPayments.close(data) },
    dispatch, matching, nearbyMatchingDriverIds: availability.nearbyMatchingDriverIds,
    isParcelRecipient: async (userId, rideId) => await parcelTracking.isRecipient(userId, rideId),
    passengerForRide: guestRepository.passenger, savePassenger: guestRepository.savePassenger,
    hasOtherWork: eatsRepository.hasWork,
    getAccount: accounts.profile, unitOfWork, audit, tokens, clock,
    deliveries: createDeliveriesService({ repository: deliveryRepository, tokens,
      requireHandover: id => deliveryOperations.requireHandover(id),
      handoverContext: async (id, now) => {
        const ride = await rideRepository.find(id);
        return { courierId: ride.driverId, position: await locations.freshPositionFor(ride.driverId, id, now) };
      } }),
    routeForRide: async (id) => (await locations.routeForRide(id)),
    quoteForRide: async (userId, id, now) => (await locations.quoteForRide(userId, id, now)),
    bindQuote: async (userId, id, rideId, now) => (await locations.bindQuote(userId, id, rideId, now)),
    requireTripLocation: async (driverId, rideId) => {
      check(await locations.freshPositionFor(driverId, rideId, clock()), 'TRIP_LOCATION_REQUIRED', 'Share a recent location before continuing this job. Open Share my location and keep tracking active.');
    },
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, availableDriverIds: availability.driverIds,
    nearbyDriverIds: availability.nearbyDriverIds, allowSimulation, ridePilot,
    onEvent: async ({ kind, ride, actorId, recipients = [], eventKey, now }) => {
      if (kind !== 'delivery_arrive') await dispatch.observe({ kind, rideId: ride.id, locationMode: (await locations.routeForRide(ride.id)) ? 'gps' : 'sample', now });
      const parcel = ['start', 'delivery_arrive', 'complete'].includes(kind) && await deliveryRepository.find(ride.id);
      if (parcel) {
        const route = kind === 'start' ? await locations.routeForRide(ride.id) : null;
        const from = kind === 'start' ? await locations.freshPositionFor(ride.driverId, ride.id, now) : null;
        await deliveryUpdates.publish({ kind: 'parcel', targetId: ride.id, customerId: ride.customerId,
          phase: ({ start: 'picked_up', delivery_arrive: 'arrived', complete: 'delivered' })[kind],
          eventKey: `parcel:${ride.id}:${kind}`, now,
          route: from && route?.destination ? { from, to: route.destination } : null });
      }
      const targets = kind === 'request' ? recipients : [ride.customerId,ride.driverId].filter((id) => id && id !== actorId);
      if (kind !== 'delivery_arrive') for (const userId of targets) {
        if (parcel && userId === ride.customerId) continue;
        await notifications.publish({ userId, rideId: ride.id, kind,
          mode: userId === ride.customerId ? 'customer' : 'work', eventKey, now });
      }
      if (kind !== 'delivery_arrive') await family.onRideEvent({ rideId: ride.id, kind, eventKey, now });
    },
    onTripCompleted: async (data) => { if (data.paymentMode !== 'paystack_test') await payments.recordCompletion(data); },
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
    sessionOwner: async (key) => typeof key === 'string' && key.startsWith('native:') ? devices.sessionOwner(key.slice(7)) : accounts.sessionOwner(key),
    getRideContext: rides.conversationContext, unitOfWork, audit, tokens, clock, config: callConfig });
  locations = createLocationsService({ repository: createLocationsRepository(db), provider: mapProvider,
    ridePilot,
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
    sessionOwner:accounts.sessionOwner,nativeSessionOwner:devices.sessionOwner,unitOfWork,tokens,audit,clock,simulation:allowSimulation});
  guestRides = createGuestRidesService({ repository: guestRepository, getAccount: accounts.profile, getTrip: rides.guestContext,
    locationForTrip: locations.safetyPosition, sessionOwner: accounts.sessionOwner, nativeSessionOwner: devices.sessionOwner, unitOfWork, tokens, audit, clock });
  parcelTracking = createParcelTrackingService({ repository: parcelRepository, getAccount: accounts.profile,
    getTrip: async (user, rideId) => {
      const ride = await rides.get(user, rideId);
      return { rideId: ride.id, customerId: ride.customer.id, driverId: ride.driver?.id ?? null,
        status: ride.status, destination: ride.destination.name, driver: ride.driver,
        delivery: ride.delivery, updatedAt: ride.updatedAt };
    }, locationForTrip: locations.safetyPosition, unitOfWork, tokens, audit, clock });
  deliveryOperations = createDeliveryOperationsService({ repository: createDeliveryOperationsRepository(db),
    getAccount: accounts.profile,
    getTrip: async id => {
      const ride = await rideRepository.find(id);
      if (!ride) return null;
      const trip = await rideRepository.findTrip(id);
      return { ...ride, status: trip?.status ?? ride.status, delivery: Boolean(await deliveryRepository.find(id)) };
    },
    isVerifiedRecipient: async (userId, id) => {
      try { await parcelTracking.received(userId, id); return true; }
      catch (error) { if (['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code)) return false; throw error; }
    }, closeReturn: rides.closeReturnedDelivery, unitOfWork, tokens, audit, clock });
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
  accountControls = createAccountControlsService({repository:createAccountControlsRepository(db),requirePermission:staffAccess.requirePermission,unitOfWork,tokens,audit,clock,
    onRestricted:async(userId,scope,now)=>{
      if(['driver','vehicle','account'].includes(scope))await availability.onProfileDeleted(userId,now);
      if(['customer','driver','vehicle','account'].includes(scope))await dispatch.withdrawForUser(userId,now,scope);
    },revokeSessions:async id=>{await accountRepository.deleteUserSessions(id);await devices.revokeUser(id);},publish:realtime.publish});
  const transactionRepository = createAdminTransactionsRepository(db);
  const adminWork = createAdminWorkService({repository:createAdminWorkRepository(db),requirePermission:staffAccess.requirePermission,
    listEligible:staffAccess.listEligible,unitOfWork,tokens,audit,clock});
  const adminInsights = createAdminInsightsService({repository:createAdminInsightsRepository(db),requirePermission:staffAccess.requirePermission,
    readSummary:(query,now)=>transactionSummary(transactionRepository.facts(transactionFilters(query,now),now)),validateFilters:transactionFilters,
    configuration:()=>({maps:mapProvider.describe().mode,calls:callConfig.describe().mode,
      accountEmail:accountMail.enabled===true,payments:paystackProvider.enabled?paystackProvider.mode:'off',
      push:pushProvider.enabled===true,passengerRides:ridePilot.describe?.()??{paused:ridePilot.paused},
      staffMfaConfigured:Boolean(staffMfa.factor?.available)}),unitOfWork,audit,tokens,clock});
  const adminInvestigations = createAdminInvestigationsService({ repository: createAdminInvestigationsRepository(db),
    requirePermission: staffAccess.requirePermission, audit, unitOfWork, tokens, clock,
    archiveCodec: { zip: evidenceZip, sha256: evidenceSha256 } });
  const adminTransactions = createAdminTransactionsService({ repository: createAdminTransactionsRepository(db),
    requirePermission: staffAccess.requirePermission, audit, unitOfWork, clock,
    deliveryStateFor: deliveryOperationState,
    driverProfile: async id => (await accounts.profile(id))?.driver ?? null,
    mapSettings: () => mapProvider.describe(),
    restrictionScopes: async id => (await accountControls.summary(id)).scopes,
    isStoreRestricted: id => createAccountControlsRepository(db).storeBlocked(id,clock()),
    locationFor: (kind,id) => kind === 'food' ? foodTracking.safetyPosition(id) : locations.safetyPosition(id) });
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
    getEligibility: drivers.eligibilityFor, getFaceCheck: drivers.faceStatusFor,
    approveDriverException: async ({ userId, id, expectedVersion, key }) => drivers.command(await accounts.profile(userId), id, 'approve-exception', { expectedVersion }, key),
    readDriverDocument: async ({ userId, driverId, documentId }) => {
      const result = await drivers.download(await accounts.profile(userId), documentId);
      check(result.document.driverId === driverId, 'NOT_FOUND', 'Driver document not found.'); return result;
    },
    requirePermission: staffAccess.requirePermission, unitOfWork, tokens, audit, clock });
  const adminDemand = createAdminDemandService({ repository: createAdminDemandRepository(db),
    requirePermission: staffAccess.requirePermission, unitOfWork, clock, allowSimulation });
  const adminMatching = createAdminMatchingService({ repository: createAdminMatchingRepository(db),
    requirePermission: staffAccess.requirePermission, unitOfWork, clock,
    configuration: () => ({ fastEnabled: matchingFast.enabled, fastRegions: matchingFast.regions ?? [], dispatchMode: dispatchConfig.mode,
      mlMode: dispatchMlConfig.mode, mlModel: dispatchMlModel?.version ?? null, mlRegions: dispatchMlConfig.regions ?? [],
      mlLive: dispatchMlConfig.mode === 'live', modelArtifact: dispatchMlModel ?? null }) });
  const adminMobile = createAdminMobileService({ repository: createAdminMobileRepository(db), requirePermission: staffAccess.requirePermission,
    unitOfWork, audit, clock, releasePolicy: readMobileReleasePolicy(process.env), sampleEvery: mobileOperations.sampleEvery });
  const adminAcceptance = createAdminAcceptanceService({ repository: createAdminAcceptanceRepository(db),
    requirePermission: staffAccess.requirePermission, unitOfWork, tokens, audit, clock,
    automaticChecks: async () => ({
      'platform.postgres': { passed: db.kind === 'postgres' && await db.healthy(), evidenceRef: 'runtime:postgres-current-schema',
        note: 'Current application database health and schema verification.' },
      'platform.fast_matching': { passed: matchingFast.includesRegion('ng:181:148'), evidenceRef: 'runtime:fast:ng:181:148',
        note: 'Controlled fast-matching pilot configuration for the Abuja grid cell.' },
      'platform.ml_shadow': { passed: dispatchMlConfig.mode === 'shadow' && dispatchMlConfig.includesRegion('ng:181:148'), evidenceRef: `runtime:ml:${dispatchMlModel?.version ?? 'none'}`,
        note: 'ML is scoring the pilot region in shadow mode and has no live dispatch authority.' },
      'accounts.google_web_configured': { passed: googleProvider.config?.enabled === true, evidenceRef: 'runtime:google-web',
        note: 'Google web OAuth configuration is present. This does not prove a device sign-in flow.' },
      'providers.push_configured': { passed: pushProvider.enabled === true, evidenceRef: 'runtime:push',
        note: 'Push provider configuration is enabled. Background delivery must still be accepted on a real device.' },
      'providers.call_relay_configured': { passed: callConfig.mode === 'relay', evidenceRef: `runtime:calls:${callConfig.mode}`,
        note: 'Hosted audio relay configuration status. A real two-phone call remains a separate acceptance test.' },
      'providers.paystack_live_configured': { passed: paystackProvider.enabled === true && paystackProvider.mode === 'live', evidenceRef: `runtime:paystack:${paystackProvider.mode}`,
        note: 'Live Paystack configuration status. A real low-value payment remains a separate acceptance test.' },
      'providers.native_google_configured': { passed: (googleProvider.config?.nativeClientIds?.length ?? 0) > 0, evidenceRef: 'runtime:google-native',
        note: 'Native Google OAuth client configuration status. Android/iOS acceptance remains separate.' },
    }) });
  const eats = createEatsService({ repository: eatsRepository, paymentsEnabled: paystackProvider.enabled,
    onDeliveryEvent: async ({ order, phase, eventKey, now }) => {
      const from = phase === 'picked_up' ? await foodTracking.freshPositionFor(order.courierId, order.id, now) : null;
      await deliveryUpdates.publish({ kind: 'food', targetId: order.id, customerId: order.customerId, phase, eventKey, now,
        route: from && order.snapshot.address?.point ? { from, to: order.snapshot.address.point } : null });
    },
    onPaymentClosed: data => checkoutPayments.close(data), getAccount: accounts.profile, photoCodec: { normalize: normalizeDishPhoto },
    foodTracking: {
      tracking: (...args) => foodTracking.tracking(...args), shareCommand: (...args) => foodTracking.shareCommand(...args),
      update: (...args) => foodTracking.update(...args), freshPositionFor: (...args) => foodTracking.freshPositionFor(...args),
      closeRide: (...args) => foodTracking.closeRide(...args),
    },
    assertStoreAvailable: id => accountControls.assertStore(id),
    resolveDeliveryLocation, deliveryMapSettings,
    hasOtherWork: async (id) => (await rideRepository.hasDriverWork(id)) || (await rideRepository.hasCustomerWork(id, clock())),
    availabilityFor: availability.positionFor, onClaim: availability.onClaim, tokens, unitOfWork, audit, clock, normalisePhoto: normaliseFoodPhoto });
  checkoutPayments = createCheckoutPaymentsService({ repository: createCheckoutPaymentsRepository(db), getAccount: accounts.profile,
    contextFor: (user, kind, targetId) => kind === 'ride' ? rides.checkoutPaymentContext(user, targetId) : eats.paymentContext(user, targetId),
    onPaid: record => record.kind === 'food' ? eats.applyPayment(record) : { applied: record.eligible },
    provider: paystackProvider, enabled: paystackProvider.enabled, unitOfWork, tokens, audit, clock });
  foodTracking = createLocationsService({ repository: createFoodTrackingRepository(db), provider: mapProvider,
    getAccount: accounts.profile, sessionOwner: accounts.sessionOwner, nativeAccessOwner: devices.accessOwner, nativeSessionOwner: devices.sessionOwner,
    getRideContext: (user, id) => eats.trackingContext(user, id), canShare: status => ['assigned','picked_up','arrived'].includes(status),
    resourceLabel: 'food delivery', unitOfWork, tokens, audit, clock });
  const deliveryEta = createDeliveryEtaProvider({ mapProvider, now: clock });
  deliveryUpdates = createDeliveryUpdatesService({ repository: createDeliveryUpdatesRepository(db), getAccount: accounts.profile,
    targetIds: async (kind, id, customerId) => {
      const link = kind === 'parcel' ? await parcelRepository.latest(id) : null;
      return [...new Set([customerId, ...(link?.active && link.recipientId ? [link.recipientId] : [])])];
    },
    access: async (user, kind, id) => {
      if (kind === 'food') {
        const order = await eatsRepository.order(id);
        check(order?.customerId === user.id && order.snapshot.fulfillment !== 'pickup', 'NOT_FOUND', 'Delivery update not found.');
        return { screen: 'food-order', id };
      }
      const ride = await rideRepository.find(id), delivery = await deliveryRepository.find(id);
      check(ride && delivery, 'NOT_FOUND', 'Delivery update not found.');
      if (ride.customerId === user.id) return { screen: 'journey', id };
      check(ride.driverId !== user.id && await accounts.profile(ride.customerId) && await parcelRepository.received(user.id, id),
        'NOT_FOUND', 'Delivery update not found.');
      return { screen: 'parcels', id };
    },
    phaseFor: async (kind, id) => {
      if (kind === 'food') {
        const order = await eatsRepository.order(id);
        return order && ['picked_up', 'arrived', 'delivered'].includes(order.status) ? order.status : null;
      }
      const trip = await rideRepository.findTrip(id), delivery = await deliveryRepository.find(id);
      return !delivery ? null : trip?.status === 'completed' ? 'delivered'
        : trip?.status === 'in_progress' ? delivery.arrivedAt ? 'arrived' : 'picked_up' : null;
    },
    familyTargets: notifications.familyTargets, validTarget: notifications.validFamilyTarget, disableTarget: notifications.disableFamilyTarget,
    provider: pushProvider, estimateEta: deliveryEta.estimate, unitOfWork, tokens, clock });
  const backgroundLocations = createBackgroundLocationService({ repository: createBackgroundLocationRepository(db),
    trackerFor: kind => kind === 'food' ? foodTracking : locations, nativeSessionOwner: devices.sessionOwner, unitOfWork, tokens, clock });
  const googleAuth = createGoogleAuthService({ repository: createGoogleAuthRepository(db), provider: googleProvider,
    accounts, devices, tokens, unitOfWork, clock });
  const adminSafetyAlerts = createAdminSafetyAlertsService({ repository: createAdminSafetyAlertsRepository(db),
    requirePermission: staffAccess.requirePermission, getAccount: accounts.profile,
    getTrip: async id => { const ride = await rideRepository.find(id); if (!ride) return null;
      const trip = await rideRepository.findTrip(id); return { customerId: ride.customerId, driverId: ride.driverId, status: trip?.status ?? ride.status }; },
    getPassenger: guestRepository.passenger, locationForTrip: locations.safetyPosition,
    mapSettings: () => ({ enabled: mapProvider.mode !== 'off', tiles: mapProvider.describe?.().tiles ?? null }),
    providerReadiness: () => ({ vehicleVisionConfigured: vehicleVisionProvider.enabled === true,
      faceComparisonConfigured: driverFaceProvider.enabled === true, notificationGatewayConfigured: safetyAlertProvider.available === true,
      emergencyPartnerConfigured: Boolean(safetyAlertProvider.available && safetyAlertProvider.emergencyService),
      liveAcceptanceVerified: false, notice: 'Configuration flags only. Real-device and provider acceptance must be verified separately.' }),
    unitOfWork, tokens, audit, clock });
  return Object.freeze({ adminSafetyAlerts, accountControls, adminInvestigations, adminTransactions, adminWork, adminInsights, accounts, devices, mobileOperations, drivers, rides, dispatch, dispatchMl, dispatchPerformance, eats, chat, calls, locations, foodTracking, backgroundLocations, availability, payments, checkoutPayments, safety, safetyMonitoring, guestRides, parcelTracking, deliveryOperations, family, familyDelivery, vehicleChecks, adminConsole, staffAccess, adminCases, adminOperations, adminFinance, adminCompliance, adminDemand, adminMatching, adminMobile, adminAcceptance, announcements, googleAuth, accountEmail, notifications, deliveryUpdates, rateLimiter, realtime, workerCoordinator, clock });
}
