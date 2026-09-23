import { createGuestRideController } from '/shared/guest-rides-controller.mjs';
import { $ } from './dom.mjs';
import { safetyTime } from './safety-format.mjs';
import { createGuestRidesTransport } from './guest-rides-transport.mjs';

/** Browser adapter. The shared controller owns secrets, versions and exact command retries. */
export function createGuestRidesPanel({ client, origin, now = Date.now, onSessionChanged = () => {},
  copy = (text) => navigator.clipboard.writeText(text), share = typeof navigator !== 'undefined' && navigator.share
    ? (url) => navigator.share({ title: 'Your Taxi Ai ride', text: 'Your private trip and pickup PIN. Keep this link private.', url }) : null }) {
  let identity = null;
  const api = createGuestRidesTransport({ client, identity: () => identity,
    onChanged() { reset(); onSessionChanged(); } });
  const controller = createGuestRideController({ api, makeKey: () => crypto.randomUUID(), now });
  let context = null, paused = false, message = '', confirm = false, lastLoad = 0, epoch = 0;
  function render() {
    const state = controller.snapshot(), link = state.value?.link;
    const working = state.loading || Boolean(state.pending), locked = working || state.uncertain || paused;
    const secret = context && !paused && state.token && link?.active && link.expiresAt > now()
      ? `${origin}/guest-trip#${state.token}` : '';
    $('guest-link-panel').hidden = !context || paused;
    $('guest-link-panel').setAttribute('aria-busy', String(working));
    $('guest-link-error').textContent = state.error || '';
    $('guest-link-status').textContent = message || (state.uncertain
      ? 'The connection ended before confirmation. Retry the same action to learn its result. Do not create a different link yet.'
      : working ? 'Checking your private link…' : !state.value ? 'Link status is unavailable. Refresh to retry.'
        : link?.active && link.expiresAt > now() ? `Link active until ${safetyTime(link.expiresAt)} (Abuja).${secret ? ' Copy or share it privately with your friend.' : ' The link text is no longer available here. Replace it to get a new one.'}`
          : link ? 'The previous link has ended or was revoked. Replace it to create a new link.'
            : state.value.canCreate ? 'Your booking is confirmed. Create a private link for your friend.' : 'Confirm this guest booking before creating a link.');
    for (const id of ['create', 'replace', 'revoke', 'refresh', 'confirm-replace', 'keep', 'copy', 'share']) $('guest-link-' + id).disabled = locked;
    $('guest-link-create').hidden = !state.value?.canCreate || Boolean(link);
    $('guest-link-replace').hidden = !state.value?.canCreate || !link;
    $('guest-link-revoke').hidden = !link?.active || link.expiresAt <= now();
    $('guest-link-retry').hidden = !state.uncertain;
    $('guest-link-retry').disabled = working || paused;
    $('guest-link-confirm').hidden = !confirm || locked;
    $('guest-link-secret').hidden = !secret;
    $('guest-link-url').value = secret;
    $('guest-link-copy').disabled = locked || !secret;
    $('guest-link-share').hidden = !share;
    $('guest-link-share').disabled = locked || !secret;
  }
  controller.subscribe(render);
  const act = (fn) => async () => { if (!context || paused) return; message = ''; confirm = false; await fn(); render(); };
  $('guest-link-create').addEventListener('click', act(() => controller.create()));
  $('guest-link-replace').addEventListener('click', () => { if (context && !paused) { confirm = true; render(); } });
  $('guest-link-confirm-replace').addEventListener('click', act(() => controller.replace()));
  $('guest-link-keep').addEventListener('click', () => { confirm = false; render(); });
  $('guest-link-revoke').addEventListener('click', act(() => controller.revoke()));
  $('guest-link-retry').addEventListener('click', act(() => controller.retry()));
  $('guest-link-refresh').addEventListener('click', act(() => controller.load()));
  async function send(method) {
    controller.tick(); render();
    const secret = $('guest-link-url').value, start = epoch;
    if (!context || paused || !secret) return;
    try { await method(secret); if (start === epoch && !paused) { message = method === copy ? 'Private link copied. Send it only to your friend.' : 'Sharing completed. Keep the trip link private.'; render(); } }
    catch (error) { if (start === epoch && !paused) { message = error.name === 'AbortError' ? 'Sharing cancelled.' : 'Unable to share automatically. Select and copy the private link above.'; render(); } }
  }
  $('guest-link-copy').addEventListener('click', () => void send(copy));
  $('guest-link-share').addEventListener('click', () => { if (share) void send(share); });
  function reset() { epoch++; context = null; identity = null; message = ''; confirm = false; lastLoad = 0; void controller.context(null); render(); }
  return Object.freeze({ reset,
    session(value) { identity = value.user ? `${value.user.id}:${value.csrfToken}` : null; },
    context(user, ride) {
      const next = user?.role === 'customer' && ride?.customer.id === user.id && ride.passenger?.kind === 'guest'
        && ['booked', 'on_way', 'arrived', 'in_progress'].includes(ride.status) ? { userId: user.id, rideId: ride.id } : null;
      if (next?.userId === context?.userId && next?.rideId === context?.rideId) return;
      epoch++; context = next; message = ''; confirm = false; lastLoad = now();
      // Even while hidden, replace the context to discard secrets from another account/trip.
      if (paused) { void controller.context(null); render(); }
      else void controller.context(next);
    },
    poll() { if (!context || paused || now() - lastLoad < 10_000) return; lastLoad = now(); return controller.load(); },
    pause() { epoch++; paused = true; message = ''; confirm = false; controller.pause(); render(); },
    resume() { paused = false; if (context) { lastLoad = now(); void controller.context(context); } render(); },
    tick() { controller.tick(); render(); },
  });
}
