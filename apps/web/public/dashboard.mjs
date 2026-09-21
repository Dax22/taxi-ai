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

let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
// Calls, trip GPS and availability belong to the account/session, not its workspace mode.
const activityClient = createApiClient();
const callView = createCallView({ onStart: () => calls.start(), onAnswer: () => calls.answer(),
  onDecline: () => calls.decline(), onEnd: () => calls.end(), onMute: () => calls.mute(),
  onOpenRide: (id) => page.openRide(id),
});
const calls = createCallController({ client: activityClient, media: createCallMedia(), view: callView });
const locationView = createLocationView({ onEnable: () => planner.enable(), onSearch: (side, query) => planner.search(side, query),
  onClear: (side) => planner.clear(side), onSelect: (side, value) => planner.select(side, value), onPick: (value) => planner.pick(value),
  onTarget: (value) => planner.setTarget(value), onPreview: () => planner.preview(), onBook: () => planner.book(),
  onStart: () => sharing.start(), onStop: () => sharing.stop() });
const planner = createLocationPlanner({ client, view: locationView,
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
const onboarding = createOnboardingController({ client, view: onboardingView, files: driverFiles });
const safetyView = createSafetyView({ onAdd: (data) => safety.add(data), onRemove: (contact) => safety.remove(contact),
  onRaise: (data) => safety.raise(data), onShare: (minutes) => safety.share(minutes), onRevoke: (link) => safety.revoke(link),
  onCopy: () => safety.copy(), onOpen: (id) => safety.open(id), onPage: (...args) => safety.page(...args),
  onReview: (...args) => safety.review(...args), onSimulate: (...args) => safety.simulate(...args) });
const safety = createSafetyController({ client, view: safetyView, origin: location.origin,
  copy: (value) => navigator.clipboard.writeText(value) });
const vehicleCheck = createVehiclePhotoCheck({client,onReport:(id,checkId)=>safetyView.vehicleMismatch(id,checkId)});
const view = createDashboardView({
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
  onEditVehicle: async () => { if (page.snapshot().mode === 'work' || await page.switchMode('work')) onboarding.focus(); },
  onAddDriver: (vehicle) => page.addDriver(vehicle), onOpenRide: (id) => page.openRide(id) });
let storage;
try { storage = window.sessionStorage; } catch { /* Mode selection remains usable without storage. */ }
const page = createPageController({ client, activityClient, view, modeView, preferences: modePreferences(storage),
  conversation, conversationView, calls, sharing, availability,
  planner, payments, onboarding, safety, vehicleCheck, authForm, feedback: {
    clear() { $('page-error').textContent = ''; $('page-notice').textContent = ''; },
    error(message) { $('page-error').textContent = message; },
    notice(message) { $('page-notice').textContent = message; },
    synced() { $('sync-status').textContent = 'Dashboard updated · refreshes every 3s'; },
    offline() {
      $('sync-status').textContent = 'Connection lost · use Refresh to retry';
      if (!$('loading').hidden) {
        $('loading').hidden = true; $('auth-panel').hidden = false;
        $('page-error').textContent = 'Unable to connect. Check that Taxi Ai is running, then refresh this page.';
      }
    },
  } });
const poll = () => { if (!document.hidden) void page.poll(); };
$('logout').addEventListener('click', () => page.logout());
$('refresh').addEventListener('click', () => page.poll());
document.addEventListener('visibilitychange', () => { if (document.hidden) availability.shutdown(); else poll(); });
window.addEventListener('pagehide', () => { calls.shutdown(); sharing.shutdown(); availability.shutdown(); safety.reset(); vehicleCheck.reset(); });
window.addEventListener('afterprint', () => document.body.classList.remove('print-receipt'));
setInterval(() => { view.tick(); conversationView.tick(); calls.tick(); planner.tick(); sharing.tick(); availability.tick(); }, 1000);
setInterval(() => { if (!document.hidden || calls.hasMedia()) void calls.poll(); }, 2000);
setInterval(() => { if (!document.hidden || sharing.sharing()) void sharing.poll(); }, 3000);
setInterval(poll, 3000);
poll();
