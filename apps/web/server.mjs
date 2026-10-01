import { createPaystackConfig } from '../../services/api/src/infrastructure/paystack-config.mjs';
import { createPaystackProvider } from '../../services/api/src/infrastructure/paystack-provider.mjs';
import { createPaystackWebhook, PAYSTACK_WEBHOOK_PATH } from '../../services/api/src/http/paystack-webhook.mjs';
import { createSafetyAlertProvider } from '../../services/api/src/infrastructure/safety-alert-provider.mjs';
import { readDriverFaceConfig } from '../../services/api/src/infrastructure/driver-face-config.mjs';
import { createDriverFaceProvider } from '../../services/api/src/infrastructure/driver-face-provider.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openPostgresDatabase } from '../../services/api/src/infrastructure/postgres.mjs';
import { asAsyncDatabase } from '../../services/api/src/infrastructure/async-database.mjs';
import { createWorkerConfig } from '../../services/api/src/infrastructure/worker-config.mjs';
import { createWorkerRuntime } from '../../services/api/src/infrastructure/worker-runtime.mjs';
import { openDatabase } from '../../services/api/src/infrastructure/database.mjs';
import { createApplication } from '../../services/api/src/application.mjs';
import { createMobileRouter } from '../../services/api/src/http/mobile-router.mjs';
import { createApiRouter } from '../../services/api/src/http/router.mjs';
import { sendError, json } from '../../services/api/src/http/responses.mjs';
import { requestContext, requireStagingAccess, isInternalHealth } from '../../services/api/src/http/security.mjs';
import { createCallConfig } from '../../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../../services/api/src/infrastructure/map-provider.mjs';
import { createDispatchConfig } from '../../services/api/src/infrastructure/dispatch-config.mjs';
import { readMatchingFastConfig } from '../../services/api/src/infrastructure/matching-fast-config.mjs';
import { createRuntimeConfig } from '../../services/api/src/infrastructure/runtime-config.mjs';
import { createHealth } from '../../services/api/src/infrastructure/health.mjs';
import { createDispatchProfiler } from '../../services/api/src/infrastructure/dispatch-profiler.mjs';
import { createTelemetry } from '../../services/api/src/infrastructure/telemetry.mjs';
import { VEHICLE_COLOURS } from '../../packages/shared/src/vehicle-profile.mjs';
import { VEHICLE_CATEGORIES } from '../../packages/shared/src/vehicle-categories.mjs';
import { check } from '../../services/api/src/shared/errors.mjs';
import { createGoogleConfig } from '../../services/api/src/infrastructure/google-config.mjs';
import { createGoogleProvider } from '../../services/api/src/infrastructure/google-provider.mjs';
import { createGoogleCallback } from '../../services/api/src/modules/google-auth/routes.mjs';
import { createEmailConfig } from '../../services/api/src/infrastructure/email-config.mjs';
import { createPushProvider } from '../../services/api/src/infrastructure/push-provider.mjs';
import { createVehicleVisionProvider } from '../../services/api/src/infrastructure/vehicle-vision-provider.mjs';
import { createAccountMail } from '../../services/api/src/infrastructure/account-mail.mjs';
import { createStaffMfaConfig } from '../../services/api/src/infrastructure/staff-config.mjs';
import { createRidePilotConfig } from '../../packages/shared/src/ride-pilot.mjs';

// Explicit allowlist: never serve the repository root or arbitrary disk paths.
const routes = new Map([
  ['/shared/realtime-client.mjs', ['../../packages/shared/src/realtime-client.mjs', 'text/javascript; charset=utf-8']],
  ...['/admin', '/admin/', '/admin/accounts', '/admin/trips', '/admin/analytics', '/admin/operations', '/admin/announcements', '/admin/staff', '/admin/audit', '/admin/cases', '/admin/finance', '/admin/compliance', '/admin/demand', '/admin/coverage'].map((path) => [path, ['../admin/public/index.html', 'text/html; charset=utf-8']]),
  ['/admin/styles.css', ['../admin/public/styles.css', 'text/css; charset=utf-8']],
  ...['app', 'api-client', 'controller', 'view', 'navigation', 'pages', 'charts', 'ui', 'forms', 'operations-page', 'staff-pages', 'case-pages', 'finance-pages', 'compliance-pages', 'demand-page', 'coverage-page', 'coverage-map', 'coverage-map-model', 'announcements-page'].map((name) => [`/admin/${name}.mjs`, [`../admin/public/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/devices', ['public/devices.html', 'text/html; charset=utf-8']],
  ['/devices.mjs', ['public/devices.mjs', 'text/javascript; charset=utf-8']],
  ['/download.mjs', ['public/download.mjs', 'text/javascript; charset=utf-8']],
  ['/app-release.mjs', ['public/app-release.mjs', 'text/javascript; charset=utf-8']],
  ['/app', ['public/dashboard.html', 'text/html; charset=utf-8']],
  ['/family', ['public/family.html', 'text/html; charset=utf-8']],
  ['/family.css', ['public/family.css', 'text/css; charset=utf-8']],
  ['/family.mjs', ['public/family.mjs', 'text/javascript; charset=utf-8']],
  ...['controller', 'view'].map(name => [`/family/${name}.mjs`, [`public/family/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/shared/family.mjs', ['../../packages/shared/src/family.mjs', 'text/javascript; charset=utf-8']],
  ['/eats', ['public/eats.html', 'text/html; charset=utf-8']],
  ['/eats/sell', ['public/eats.html', 'text/html; charset=utf-8']],
  ['/eats.mjs', ['public/eats.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/eats-hero.png', ['public/assets/eats-hero.png', 'image/png']],
  ['/eats.css', ['public/eats.css', 'text/css; charset=utf-8']],
  ['/eats/meal-view.mjs', ['public/eats/meal-view.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/delivery-form.mjs', ['public/eats/delivery-form.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/location-fields.mjs', ['public/eats/location-fields.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/nigeria-areas.mjs', ['../../packages/shared/src/nigeria-areas.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/nigeria-map-places.mjs', ['../../packages/shared/src/nigeria-map-places.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/view.mjs', ['public/eats/view.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/photo-view.mjs', ['public/eats/photo-view.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/photo-upload.mjs', ['public/eats/photo-upload.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/photo-manager.mjs', ['public/eats/photo-manager.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/transport.mjs', ['public/eats/transport.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/tracking.mjs', ['public/eats/tracking.mjs', 'text/javascript; charset=utf-8']],
  ['/eats/tracking-view.mjs', ['public/eats/tracking-view.mjs', 'text/javascript; charset=utf-8']],
  ['/typography.css', ['public/typography.css', 'text/css; charset=utf-8']],
  ...['eats', 'eats-contracts', 'eats-controller', 'eats-meals', 'eats-delivery', 'food-tracking'].map((name) => [`/shared/${name}.mjs`, [`../../packages/shared/src/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/account-access', ['public/account-access.html', 'text/html; charset=utf-8']],
  ['/account-access.mjs', ['public/account-access.mjs', 'text/javascript; charset=utf-8']],
  ['/account-recovery', ['public/account-recovery.html', 'text/html; charset=utf-8']],
  ['/account-recovery.mjs', ['public/account-recovery.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/account-recovery-controller.mjs', ['public/dashboard/account-recovery-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/google-auth.mjs', ['public/dashboard/google-auth.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/sign-in-methods.mjs', ['public/dashboard/sign-in-methods.mjs', 'text/javascript; charset=utf-8']],
  ['/trip-share', ['public/trip-share.html', 'text/html; charset=utf-8']],
  ['/trip-share.mjs', ['public/trip-share.mjs', 'text/javascript; charset=utf-8']],
  ['/parcels', ['public/parcels.html', 'text/html; charset=utf-8']],
  ['/parcels.mjs', ['public/parcels.mjs', 'text/javascript; charset=utf-8']],
  ...['controller', 'view'].map((name) => [`/parcels/${name}.mjs`, [`public/parcels/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/dashboard/parcel-links-panel.mjs', ['public/dashboard/parcel-links-panel.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/mobile-contracts.mjs', ['../../packages/shared/src/mobile-contracts.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/parcels.mjs', ['../../packages/shared/src/parcels.mjs', 'text/javascript; charset=utf-8']],
  ['/guest-trip', ['public/guest-trip.html', 'text/html; charset=utf-8']],
  ['/guest-trip.mjs', ['public/guest-trip.mjs', 'text/javascript; charset=utf-8']],
  ...['guest-rides-panel', 'guest-rides-transport', 'guest-trip-controller'].map((name) => [`/dashboard/${name}.mjs`, [`public/dashboard/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ...['guest-rides', 'guest-rides-controller'].map((name) => [`/shared/${name}.mjs`, [`../../packages/shared/src/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/dashboard/safety-controller.mjs', ['public/dashboard/safety-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-view.mjs', ['public/dashboard/safety-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/vehicle-checks.mjs', ['public/dashboard/vehicle-checks.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/vehicle-photo.mjs', ['public/dashboard/vehicle-photo.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-checks.mjs', ['../../packages/shared/src/vehicle-checks.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-check-controller.mjs', ['../../packages/shared/src/vehicle-check-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-format.mjs', ['public/dashboard/safety-format.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-share-controller.mjs', ['public/dashboard/trip-share-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/safety-monitoring-controller.mjs', ['../../packages/shared/src/safety-monitoring-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/safety-monitoring.mjs', ['../../packages/shared/src/safety-monitoring.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-monitoring.mjs', ['public/dashboard/safety-monitoring.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-sensors.mjs', ['public/dashboard/safety-sensors.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/safety.mjs', ['../../packages/shared/src/safety.mjs', 'text/javascript; charset=utf-8']],
  ['/vehicle.css', ['public/vehicle.css', 'text/css; charset=utf-8']],
  ['/vehicle-categories.css', ['public/vehicle-categories.css', 'text/css; charset=utf-8']],
  ['/dashboard/vehicle-categories.mjs', ['public/dashboard/vehicle-categories.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/transport-categories.mjs', ['../../packages/shared/src/transport-categories.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-categories.mjs', ['../../packages/shared/src/vehicle-categories.mjs', 'text/javascript; charset=utf-8']],
  ...VEHICLE_CATEGORIES.filter((category) => category.id !== 'standard').map((category) => [category.assetPath, [`public${category.assetPath}`, 'image/png']]),
  ['/dashboard/vehicle-card.mjs', ['public/dashboard/vehicle-card.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/nigeria-boundary.mjs', ['../../packages/shared/src/nigeria-boundary.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-profile.mjs', ['../../packages/shared/src/vehicle-profile.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/pickup-identity.mjs', ['../../packages/shared/src/pickup-identity.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-registration.mjs', ['../../packages/shared/src/vehicle-registration.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/vehicle-fields.mjs', ['public/dashboard/vehicle-fields.mjs', 'text/javascript; charset=utf-8']],
  ...[...VEHICLE_COLOURS.map((c) => c.id), 'neutral'].map((id) => [`/assets/vehicles/sedan-${id}.png`, [`public/assets/vehicles/sedan-${id}.png`, 'image/png']]),
  ['/dashboard.css', ['public/dashboard.css', 'text/css; charset=utf-8']],
  ['/dashboard/account-mode-view.mjs', ['public/dashboard/account-mode-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/announcements.mjs', ['public/dashboard/announcements.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/kemmy-setup.mjs', ['public/dashboard/kemmy-setup.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/account-modes.mjs', ['../../packages/shared/src/account-modes.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard.mjs', ['public/dashboard.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/onboarding-controller.mjs', ['public/dashboard/onboarding-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/onboarding-view.mjs', ['public/dashboard/onboarding-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/driver-face-view.mjs', ['public/dashboard/driver-face-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/driver-files.mjs', ['public/dashboard/driver-files.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/api-client.mjs', ['public/dashboard/api-client.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/page-controller.mjs', ['public/dashboard/page-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/auth-form.mjs', ['public/dashboard/auth-form.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/dom.mjs', ['public/dashboard/dom.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/views.mjs', ['public/dashboard/views.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-model.mjs', ['public/dashboard/trip-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-view.mjs', ['public/dashboard/trip-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-media.mjs', ['public/dashboard/call-media.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-controller.mjs', ['public/dashboard/call-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-view.mjs', ['public/dashboard/call-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/map-view.mjs', ['public/dashboard/map-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-planner.mjs', ['public/dashboard/location-planner.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-view.mjs', ['public/dashboard/location-view.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/kemmy.mjs', ['../../packages/shared/src/kemmy.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-sharing.mjs', ['public/dashboard/location-sharing.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/availability-controller.mjs', ['public/dashboard/availability-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/availability-view.mjs', ['public/dashboard/availability-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/checkout-payments.mjs', ['public/dashboard/checkout-payments.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/checkout-payment-view.mjs', ['public/dashboard/checkout-payment-view.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/checkout-payments.mjs', ['../../packages/shared/src/checkout-payments.mjs', 'text/javascript; charset=utf-8']],
  ['/payment-return', ['public/payment-return.html', 'text/html; charset=utf-8']],
  ['/dashboard/payments-controller.mjs', ['public/dashboard/payments-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/payments-view.mjs', ['public/dashboard/payments-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/geolocation.mjs', ['public/dashboard/geolocation.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-model.mjs', ['public/dashboard/conversation-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-controller.mjs', ['public/dashboard/conversation-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-view.mjs', ['public/dashboard/conversation-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/chat-reports-view.mjs', ['public/dashboard/chat-reports-view.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/homepage.css', ['public/homepage.css', 'text/css; charset=utf-8']],
  ['/homepage-carousel.mjs', ['public/homepage-carousel.mjs', 'text/javascript; charset=utf-8']],
  ['/page-scenes.mjs', ['public/page-scenes.mjs', 'text/javascript; charset=utf-8']],
  ['/page-scenes.css', ['public/page-scenes.css', 'text/css; charset=utf-8']],
  ['/companion-pages.css', ['public/companion-pages.css', 'text/css; charset=utf-8']],
  ['/dashboard-scene.mjs', ['public/dashboard-scene.mjs', 'text/javascript; charset=utf-8']],
  ...['ride-city', 'eats-table', 'courier-handoff', 'kitchen'].flatMap((name) =>
    ['', '-small'].map((size) => [`/assets/scenes/${name}${size}.webp`, [`public/assets/scenes/${name}${size}.webp`, 'image/webp']])),
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/fonts/manrope-latin-wght-normal.woff2', ['public/assets/fonts/manrope-latin-wght-normal.woff2', 'font/woff2']],
  ['/assets/fonts/manrope-latin-ext-wght-normal.woff2', ['public/assets/fonts/manrope-latin-ext-wght-normal.woff2', 'font/woff2']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/assets/taxi-ai-mark.svg', ['public/assets/taxi-ai-mark.svg', 'image/svg+xml']],
  ['/assets/google-sign-in.png', ['public/assets/google-sign-in.png', 'image/png']],
  ['/assets/kemmy-avatar.png', ['public/assets/kemmy-avatar.png', 'image/png']],
  ['/assets/eats-nigerian-table.jpg', ['public/assets/eats-nigerian-table.jpg', 'image/jpeg']],
  ['/assets/eats-jollof.jpg', ['public/assets/eats-jollof.jpg', 'image/jpeg']],
  ['/assets/eats-egusi.jpg', ['public/assets/eats-egusi.jpg', 'image/jpeg']],
  ['/assets/eats-suya.jpg', ['public/assets/eats-suya.jpg', 'image/jpeg']],
  ['/assets/ai-journey-features.webp', ['public/assets/ai-journey-features.webp', 'image/webp']],
  ['/assets/ai-journey-features-small.webp', ['public/assets/ai-journey-features-small.webp', 'image/webp']],
  ['/assets/taxi-ai-phone-preview.svg', ['public/assets/taxi-ai-phone-preview.svg', 'image/svg+xml']],
  ['/assets/city-route-hero.webp', ['public/assets/city-route-hero.webp', 'image/webp']],
  ['/assets/city-route-hero-small.webp', ['public/assets/city-route-hero-small.webp', 'image/webp']],
  ...['airport-dropoff', 'food-delivery', 'courier-delivery'].flatMap((name) =>
    ['', '-small'].map((size) => [`/assets/${name}-hero${size}.webp`, [`public/assets/${name}-hero${size}.webp`, 'image/webp']])),
  ['/assets/autonomous-concept.webp', ['public/assets/autonomous-concept.webp', 'image/webp']],
  ['/assets/autonomous-concept-small.webp', ['public/assets/autonomous-concept-small.webp', 'image/webp']],
  ['/shared/driver-onboarding.mjs', ['../../packages/shared/src/driver-onboarding.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/driver-face-check.mjs', ['../../packages/shared/src/driver-face-check.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/fare-negotiation.mjs', ['../../packages/shared/src/fare-negotiation.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/demo-booking.mjs', ['../../packages/shared/src/demo-booking.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/trip-lifecycle.mjs', ['../../packages/shared/src/trip-lifecycle.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/chat-safety.mjs', ['../../packages/shared/src/chat-safety.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/call-lifecycle.mjs', ['../../packages/shared/src/call-lifecycle.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/matching.mjs', ['../../packages/shared/src/matching.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/smart-matching.mjs', ['../../packages/shared/src/smart-matching.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/payments.mjs', ['../../packages/shared/src/payments.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/locations.mjs', ['../../packages/shared/src/locations.mjs', 'text/javascript; charset=utf-8']],
]);

export function createAppServer({ runtime = createRuntimeConfig({}), db = openDatabase(runtime.mode === 'staging' ? runtime.database : ':memory:'),
  clock = Date.now, callConfig = createCallConfig({ ...process.env, TAXI_AI_CALLS_MODE: process.env.TAXI_AI_CALLS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'local') }),
  matchingFast = readMatchingFastConfig(process.env),
  mapProvider = createMapProvider({ compactPickupTables: matchingFast.enabled,
    env: { ...process.env, TAXI_AI_MAPS_MODE: process.env.TAXI_AI_MAPS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'community') } }),
  resolveDeliveryLocation, deliveryMapSettings,
  dispatchConfig = createDispatchConfig(process.env), workerConfig = createWorkerConfig(process.env), staffMfa = createStaffMfaConfig(process.env),
  ridePilot = createRidePilotConfig(process.env, runtime.mode),
  telemetry = createTelemetry({ enabled: runtime.mode === 'staging' }),
  dispatchProfiler = createDispatchProfiler({ sampleEvery: Number(process.env.TAXI_AI_DISPATCH_PROFILE_SAMPLE_EVERY ?? 0),
    report: (value) => telemetry.dispatchProfile?.(value) }),
  accountMail = createAccountMail({ config: createEmailConfig(process.env,runtime) }),
  safetyAlertProvider = createSafetyAlertProvider({env:process.env}),
  pushProvider = createPushProvider({ env: process.env }),
  vehicleVisionProvider = createVehicleVisionProvider({ env:process.env }),
  driverFaceProvider = createDriverFaceProvider({ config: readDriverFaceConfig(process.env) }),
  paystackProvider = createPaystackProvider({ config: createPaystackConfig(process.env, runtime) }),
  googleProvider = createGoogleProvider({ config: createGoogleConfig(process.env, runtime), clock }) } = {}) {
  if (runtime.mode === 'staging' && callConfig.mode === 'local') throw new Error('Staging calls require off or a configured relay.');
  db = asAsyncDatabase(db);
  if (workerConfig.role !== 'all' && db.kind !== 'postgres') throw new Error('Split API/worker deployments require PostgreSQL.');
  const application = createApplication({ db, clock, callConfig, mapProvider, resolveDeliveryLocation, deliveryMapSettings, dispatchProfiler, matchingFast,
    dispatchConfig: { ...dispatchConfig, requestRefresh: workerConfig.role === 'all' }, workerConfig,
    paystackProvider, googleProvider, accountMail, pushProvider, vehicleVisionProvider, driverFaceProvider, safetyAlertProvider, staffMfa, ridePilot,
    allowSimulation: runtime.mode === 'local' });
  const httpApplication = workerConfig.role === 'api' ? { ...application, dispatch: { ...application.dispatch, refresh: async () => {} } } : application;
  const handleApi = createApiRouter(httpApplication, { secure: runtime.mode === 'staging' });
  const handleMobile = createMobileRouter(httpApplication);
  const handleGoogleCallback = createGoogleCallback(application, runtime.mode === 'staging');
  const handlePaystackWebhook = createPaystackWebhook({ provider: paystackProvider, checkoutPayments: application.checkoutPayments, rateLimiter: application.rateLimiter, clock });
  const health = createHealth(db);
  const workers = createWorkerRuntime({ coordinator: application.workerCoordinator, config: { ...workerConfig, matchingFast }, wakeups: db,
    regions: () => application.dispatch.regions(), dispatch: application.dispatch, onError: (name) => telemetry.event(name),
    maintenance: async ({ lease, active }) => {
      for (const service of [application.rides, application.availability, application.calls, application.locations, application.foodTracking, application.backgroundLocations,
        application.safety, application.guestRides, application.family, application.vehicleChecks, application.devices, application.googleAuth]) {
        if (!active()) return;
        const held = await db.transaction(async () => {
          if (!await application.workerCoordinator.guard(lease)) return false;
          await service.sweep();
          return true;
        });
        if (!held) return;
      }
      if (!active()) return;
      await db.transaction(async () => {
        if (await application.workerCoordinator.guard(lease)) await application.eats.expirePendingPayments();
      });
      if (!active() || !await application.workerCoordinator.guard(lease)) return;
      await application.checkoutPayments.reconcileDue({ limit: 5 });
      if (!active()) return;
      await db.transaction(async () => {
        if (await application.workerCoordinator.guard(lease)) await application.rateLimiter.sweep(clock());
      });
      // Provider I/O stays outside transactions. Each outbox separately claims
      // jobs; the coordinator only permits starting the next bounded drain.
      for (const service of [application.safetyMonitoring, application.accountEmail, application.notifications, application.announcements, application.familyDelivery]) {
        if (!active() || !await application.workerCoordinator.guard(lease)) return;
        await service.deliverPending();
      }
    } });
  workers.start();
  const server = createServer(async (request, response) => {
    let pathname = '';
    telemetry.observe(request, response, () => pathname);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (runtime.mode === 'staging') response.setHeader('Strict-Transport-Security', 'max-age=86400');
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
      response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'${['/eats', '/eats/sell'].includes(pathname) ? ' data:' : ''}${mapProvider.mode === 'off' ? '' : ` ${mapProvider.tileOrigin}`}; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      if (['/app', '/family', '/parcels', '/eats', '/eats/sell'].includes(pathname) && mapProvider.mode !== 'off') response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      response.setHeader('Permissions-Policy', `camera=${['/app', '/eats', '/eats/sell'].includes(pathname) ? '(self)' : '()'}, microphone=${pathname === '/app' ? '(self)' : '()'}, geolocation=${['/app', '/eats', '/eats/sell'].includes(pathname) ? '(self)' : '()'}, accelerometer=${pathname === '/app' ? '(self)' : '()'}, gyroscope=${pathname === '/app' ? '(self)' : '()'}`);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    try {
      let context;
      if (!isInternalHealth(request, pathname)) {
        context = requestContext(request, runtime);
        // Provider signatures protect this exact webhook; the HTTPS gateway remains mandatory.
        if (pathname !== PAYSTACK_WEBHOOK_PATH || request.method !== 'POST' || !(paystackProvider.configured ?? paystackProvider.enabled)) requireStagingAccess(request, response, runtime, pathname);
      }
      if (['/health/live', '/health/ready'].includes(pathname)) {
        check(['GET', 'HEAD'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or HEAD.');
        const ok = pathname === '/health/live' || await health.ready();
        if (request.method === 'HEAD') { response.writeHead(ok ? 200 : 503); response.end(); }
        else json(response, ok ? 200 : 503, { status: ok ? pathname === '/health/live' ? 'alive' : 'ready' : 'unavailable' });
        return;
      }
      check(workerConfig.role !== 'worker', 'SERVER_DRAINING', 'This process handles background work.');
      check(!health.draining(), 'SERVER_DRAINING', 'Taxi Ai is restarting. Please retry shortly.');
      if (pathname === PAYSTACK_WEBHOOK_PATH) {
        await handlePaystackWebhook({ request, response, ...context }); return;
      }
      if (pathname === '/auth/google/callback') {
        await handleGoogleCallback({ request, response, ...context }); return;
      }
      if (pathname.startsWith('/api/')) {
        await (pathname.startsWith('/api/mobile/v1/') ? handleMobile : handleApi)({ request, response, pathname, ...context });
        return;
      }
    } catch (error) {
      sendError(response, error);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    const route = routes.get(pathname) ?? (/^\/admin\/(accounts|trips|cases|finance|compliance)\/[a-f0-9-]{36}$/.test(pathname) ? routes.get('/admin') : null);
    if (!route) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    try {
      const body = await readFile(new URL(route[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': route[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Unable to load this page');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  let shutdown;
  function stopServices() {
    if (!shutdown) {
      // Signal every producer immediately before waiting, so an in-flight route
      // cannot publish another offer while the worker runtime is draining.
      const tasks = [workers.stop(), application.dispatch.stop(), application.safetyMonitoring.stop(),
        application.accountEmail.stop(), application.notifications.stop(), application.announcements.stop(), application.familyDelivery.stop(), application.realtime.close()];
      let deadline;
      const completed = Promise.allSettled(tasks).then((results) => {
        if (results.some((result) => result.status === 'rejected')) throw new Error('A background service could not finish shutting down.');
      });
      shutdown = Promise.race([completed, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Background shutdown deadline exceeded.')), workerConfig.shutdownMs);
      })]).finally(() => clearTimeout(deadline));
    }
    return shutdown;
  }
  server.beginShutdown = () => { health.beginShutdown(); void stopServices().catch(() => telemetry.event('worker_shutdown_failed')); };
  let closedResources;
  server.closeResources = () => {
    if (!closedResources) closedResources = stopServices().finally(() => db.close());
    return closedResources;
  };
  server.on('close', () => { void server.closeResources().catch(() => telemetry.event('worker_shutdown_failed')); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db;
  try {
    const runtime = createRuntimeConfig();
    const workerConfig = createWorkerConfig(process.env);
    const telemetry = createTelemetry();
    db = process.env.TAXI_AI_DATABASE_URL ? await openPostgresDatabase() : openDatabase(runtime.database);
    const server = createAppServer({ runtime, db, telemetry, workerConfig });
    server.on('error', (error) => {
      telemetry.event('server_failed');
      console.error(error.code === 'EADDRINUSE' ? 'Taxi Ai port is already in use.' : 'Unable to listen on the configured address.');
      server.beginShutdown();
      void server.closeResources().catch(() => telemetry.event('worker_shutdown_failed'));
      process.exitCode = 1;
    });
    server.listen(runtime.port, runtime.host, () => {
      telemetry.event('server_started');
      if (runtime.mode === 'local') console.log(`Taxi Ai: http://localhost:${runtime.port}/app — development preview. Press Ctrl+C to stop.`);
    });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      if (stopping) return; stopping = true;
      telemetry.event('server_stopping'); server.beginShutdown();
      const deadline = setTimeout(() => {
        telemetry.event('shutdown_timeout'); server.closeAllConnections(); process.exit(1);
      }, workerConfig.shutdownMs + 1000);
      server.close(async () => {
        try { await server.closeResources(); }
        catch { telemetry.event('worker_shutdown_failed'); process.exitCode = 1; }
        finally { clearTimeout(deadline); }
      });
    });
  } catch {
    await db?.close();
    console.error('Taxi Ai could not start. Check runtime configuration and storage permissions; run npm run config:check for configuration errors.');
    process.exitCode = 1;
  }
}
