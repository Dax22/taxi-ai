import { createRealtimeClient } from '/shared/realtime-client.mjs';
import { createSafetyMonitoring } from './dashboard/safety-monitoring.mjs';
import { createOnboardingController } from './dashboard/onboarding-controller.mjs';
import { createOnboardingView } from './dashboard/onboarding-view.mjs';
import { driverFiles } from './dashboard/driver-files.mjs';
import { $ } from './dashboard/dom.mjs';
import { createApiClient } from './dashboard/api-client.mjs';
import { bindAuthForm } from './dashboard/auth-form.mjs';
import { createDashboardView } from './dashboard/views.mjs';
import { createConversationView } from './dashboard/conversation-view.mjs';
import { createConversationController } from './dashboard/conversation-controller.mjs';
import { createCallMedia } from './dashboard/call-media.mjs';
import { createCallController } from './dashboard/call-controller.mjs';
import { createCallView } from './dashboard/call-view.mjs';
import { createLocationView } from './dashboard/location-view.mjs';
import { createLocationPlanner } from './dashboard/location-planner.mjs';
import { createLocationSharing } from './dashboard/location-sharing.mjs';
import { createAvailabilityController } from './dashboard/availability-controller.mjs';
import { createAvailabilityView } from './dashboard/availability-view.mjs';
import { createPaymentsController } from './dashboard/payments-controller.mjs';
import { createPaymentsView } from './dashboard/payments-view.mjs';
import { createGeolocation } from './dashboard/geolocation.mjs';
import { createPageController } from './dashboard/page-controller.mjs';
import { createSafetyController } from './dashboard/safety-controller.mjs';
import { createSafetyView } from './dashboard/safety-view.mjs';
import { createVehiclePhotoCheck } from './dashboard/vehicle-checks.mjs';
import { createAccountModeView, modePreferences } from './dashboard/account-mode-view.mjs';
import { createGoogleSignIn, consumeGoogleOutcome } from './dashboard/google-auth.mjs';
import { createParcelLinksPanel } from './dashboard/parcel-links-panel.mjs';
import { createGuestRidesPanel } from './dashboard/guest-rides-panel.mjs';
import { createAnnouncementsPanel } from './dashboard/announcements.mjs';
import { createKemmySetup } from './dashboard/kemmy-setup.mjs';

let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
// Calls, trip GPS and availability belong to the account/session, not its workspace mode.
const activityClient = createApiClient();
const callView = createCallView({ onStart: () => calls.start(), onAnswer: () => calls.answer(),
  onDecline: () => calls.decline(), onEnd: () => calls.end(), onMute: () => calls.mute(),
  onOpenRide: (id) => page.openRide(id),
});
const calls = createCallController({ client: activityClient, media: createCallMedia(), view: callView });
const routeDevice = createGeolocation();
const locationView = createLocationView({ onEnable: () => planner.enable(), onUsePickup: () => planner.useCurrentPickup(), onSearch: (side, query) => planner.search(side, query),
  onClear: (side) => planner.clear(side), onSelect: (side, value) => planner.select(side, value), onPick: (value) => planner.pick(value),
  onTarget: (value) => planner.setTarget(value), onPreview: () => planner.preview(), onBook: () => planner.book(),
  onStart: () => sharing.start(), onStop: () => sharing.stop(),
  onRate: (id, stars) => page.rideCommand(`/api/rides/${id}/rating`, { stars }, 'Your driver rating was saved.') });
const planner = createLocationPlanner({ client, view: locationView,
  device: routeDevice,
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onOnline: (enabled, settings) => locationView.setOnline(enabled, settings),
  onBook: (quoteId) => page.rideCommand('/api/rides', { quoteId, ...view.requestOptions() },
    'Your route and suggested fare are saved. An approved driver can start negotiation.'),
});
const sharing = createLocationSharing({ client: activityClient, device: createGeolocation(), view: locationView,
  serverNow: () => serverTime.now + performance.now() - serverTime.received });
const availabilityView = createAvailabilityView({ onOnline: (mode, areaId) => availability.start(mode, areaId), onOffline: () => availability.stop() });
const availability = createAvailabilityController({ client: activityClient, device: createGeolocation(), view: availabilityView,
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onStatus: (online) => page.availabilityChanged(online),
});
const paymentsView = createPaymentsView({ onStart: (payment) => payments.start(payment),
  onSimulate: (payment, outcome) => payments.simulate(payment, outcome), onPage: (before) => payments.page(before),
  onOpenRide: async (id) => {
    if (await page.openRide(id)) $('payment-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, onPrint: () => { document.body.classList.add('print-receipt'); window.print(); },
});
const payments = createPaymentsController({ client, view: paymentsView });
const conversationView = createConversationView({
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onAccept: (...args) => page.rideCommand(...args),
  onSend: (data) => page.runAction(() => conversation.send(data)),
  onReport: (data) => page.runAction(() => conversation.report(data), 'Report saved for test administrator review.'),
  onRead: () => conversation.markRead(),
});
const conversation = createConversationController({ client, view: conversationView,
  onRead: (rideId, unread) => page.read(rideId, unread),
});
const onboardingView = createOnboardingView({ onAction: (...args) => onboarding.run(...args),
  onDownload: (id) => onboarding.download(id), onClose: () => onboarding.close() });
const onboarding = createOnboardingController({ client, view: onboardingView, files: driverFiles,
  onDeleted: (user) => page.driverDeleted(user) });
const safetyView = createSafetyView({ onAdd: (data) => safety.add(data), onRemove: (contact) => safety.remove(contact),
  onRaise: (data) => safety.raise(data), onShare: (minutes) => safety.share(minutes), onRevoke: (link) => safety.revoke(link),
  onCopy: () => safety.copy(), onOpen: (id) => safety.open(id), onPage: (...args) => safety.page(...args),
  onReview: (...args) => safety.review(...args), onSimulate: (...args) => safety.simulate(...args) });
const safety = createSafetyController({ client, monitor: createSafetyMonitoring({client}), view: safetyView, origin: location.origin,
  copy: (value) => navigator.clipboard.writeText(value) });
const guests = createGuestRidesPanel({ client, origin: location.origin,
  now: () => serverTime.now + performance.now() - serverTime.received,
  onSessionChanged: () => void page.poll() });
const parcels = createParcelLinksPanel({ client, origin: location.origin, now: () => serverTime.now + performance.now() - serverTime.received });
const announcements = createAnnouncementsPanel({ client, root: $('announcement-banner'), title: $('announcement-title'),
  body: $('announcement-body'), meta: $('announcement-meta'), dismiss: $('announcement-dismiss') });
if (document.hidden) { guests.pause(); parcels.pause(); }
const vehicleCheck = createVehiclePhotoCheck({client,onReport:(id,checkId)=>safetyView.vehicleMismatch(id,checkId)});
const view = createDashboardView({
  onEditVehicle: () => page.editVehicle(),
  onVehicleMismatch: (id) => safetyView.vehicleMismatch(id),
  onCategoryChange: (id) => planner.setCategory(id),
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onCommand: (...args) => page.rideCommand(...args),
  onSelectionChange: (ride) => page.selection(ride),
  onHistory: (before) => page.history(before),
  onReview: (id) => onboarding.open(id),
  onReportReview: (id) => page.runAction(() => client.request(`/api/admin/chat-reports/${id}/review`, {
    method: 'POST', data: {},
  }), 'Report marked reviewed.'),
});
const authForm = bindAuthForm({ onSubmit: (path, data) => page.authenticate(path, data) });
const google = createGoogleSignIn({ client, navigate: (url) => location.assign(url), view: {
  available(value) { $('google-auth').hidden = !value; },
  busy(value) { $('google-sign-in').disabled = value; $('google-sign-in').setAttribute('aria-busy', String(value)); $('google-progress').hidden = !value; },
  error(value) { $('page-error').textContent = value; },
} });
$('google-sign-in').addEventListener('click', () => void google.start());
$('page-notice').textContent = consumeGoogleOutcome(location, history);
void google.load();
const modeView = createAccountModeView({ onSwitch: (...args) => page.switchMode(...args), onCancel: () => page.cancelSwitch(),
  onEditVehicle: () => page.editVehicle(),
  onAddDriver: (vehicle) => page.addDriver(vehicle), onOpenRide: (id) => page.openRide(id) });
let storage;
try { storage = window.sessionStorage; } catch { /* Mode selection remains usable without storage. */ }
let liveIdentity = null;
let kemmySetup = { context() {}, reset() {}, refresh: async () => {} };
const liveUpdates = createRealtimeClient({
  read: (cursor, signal) => activityClient.request(`/api/events?cursor=${cursor}&wait=25000`, { signal }),
  refresh: async () => { await page.poll(); await Promise.all([calls.poll(), sharing.poll(), announcements.poll()]); },
});
const page = createPageController({ client, activityClient, view, modeView, preferences: modePreferences(storage),
  initialMode: new URLSearchParams(location.search).get('service') === 'courier' ? 'customer' : null,
  conversation, conversationView, calls, sharing, availability,
  planner, payments, onboarding, safety, vehicleCheck, guests, parcels, authForm,
  onAccount(identity) {
    if (identity !== liveIdentity) { liveIdentity = identity; liveUpdates.reset(); announcements.context(identity); kemmySetup.context(identity); }
    if (identity && !document.hidden) liveUpdates.resume(); else liveUpdates.pause();
  }, feedback: {
    clear() { $('page-error').textContent = ''; $('page-notice').textContent = ''; },
    error(message) { $('page-error').textContent = message; },
    notice(message) { $('page-notice').textContent = message; },
    synced() { $('sync-status').textContent = 'Dashboard updated · live updates active'; },
    offline() {
      $('sync-status').textContent = 'Connection lost · use Refresh to retry';
      if (!$('loading').hidden) {
        $('loading').hidden = true; $('auth-panel').hidden = false;
        $('page-error').textContent = 'Unable to connect. Check that Taxi Ai is running, then refresh this page.';
      }
    },
  } })
kemmySetup = createKemmySetup({ client,
  onCustomer: () => $('vehicle-categories-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }),
  onDriver: () => void page.switchMode('work'),
  onSeller: () => location.assign('/eats/sell'),
});
;
const poll = () => { if (!document.hidden) void page.poll(); };
$('logout').addEventListener('click', () => page.logout());
$('refresh').addEventListener('click', () => page.poll());
document.addEventListener('visibilitychange', () => { if (document.hidden) { liveUpdates.pause(); availability.shutdown(); guests.pause(); parcels.pause(); } else { if (liveIdentity) liveUpdates.resume(); guests.resume(); parcels.resume(); poll(); void announcements.poll(); } });
window.addEventListener('pagehide', () => { liveUpdates.reset(); calls.shutdown(); sharing.shutdown(); availability.shutdown(); safety.reset(); vehicleCheck.reset(); guests.reset(); parcels.reset(); announcements.reset(); kemmySetup.reset(); });
window.addEventListener('afterprint', () => document.body.classList.remove('print-receipt'));
setInterval(() => { view.tick(); conversationView.tick(); calls.tick(); planner.tick(); sharing.tick(); availability.tick(); guests.tick(); parcels.tick(); }, 1000);
setInterval(() => { if (calls.hasMedia()) void calls.poll(); }, 2000);
// Location publication remains on sharing.tick(); reception uses account invalidations.
// Anonymous sessions use a slow check; authenticated sessions refresh on invalidation.
setInterval(() => { if (!liveIdentity) poll(); else if (!document.hidden) void announcements.poll(); }, 30_000);
poll();
