import { readParcelInvitationResponse } from '/shared/parcels.mjs';
import { $ } from './dom.mjs';

/** Sender-only invitation UI. Capabilities stay in memory and clear on session/trip changes. */
export function createParcelLinksPanel({ client, origin, now = Date.now,
  copy = (url) => navigator.clipboard.writeText(url), share = globalThis.navigator?.share
    ? (url) => navigator.share({ title: 'Your Taxi Ai parcel', url }) : null }) {
  let context = null, identity = null, epoch = 0, value = null, token = '', busy = false, error = '', message = '', confirmation = '', lastLoad = 0, pending = null, paused = false;
  const node = (id) => $('parcel-link-' + id);
  function render() {
    const link = value?.link, valid = link?.active && !link.claimed && link.expiresAt > now(), ended = ['completed', 'cancelled', 'expired'].includes(context?.status);
    const secret = valid && token ? `${origin}/parcels#token=${token}` : '';
    node('panel').hidden = !context || paused;
    node('error').textContent = error;
    node('message').textContent = message || (busy ? 'Updating recipient access…' : !value ? 'Checking invitation…'
      : ended ? 'Delivery ended. You can revoke any existing recipient access.'
      : link?.active && link.claimed ? 'Your recipient has accepted. Access continues until you revoke or replace this invitation.'
        : valid ? 'Invitation active. Send it privately to your recipient.'
          : value.canCreate ? 'Create an invitation after checking your recipient’s details.' : 'Recipient invitations are unavailable for this parcel.');
    node('create').hidden = !value?.canCreate || Boolean(link);
    node('replace').hidden = !value?.canCreate || !link;
    node('revoke').hidden = !link?.active;
    node('confirm').hidden = !confirmation;
    node('secret').hidden = !secret; node('url').value = secret;
    node('share').hidden = !share;
    node('retry').hidden = !pending; node('retry').disabled = busy;
    node('recipient-email').disabled = busy || Boolean(pending);
    for (const id of ['create', 'replace', 'revoke', 'refresh', 'confirm-action', 'keep', 'copy', 'share']) node(id).disabled = busy || Boolean(pending);
    node('copy').disabled = node('share').disabled = busy || Boolean(pending) || !secret;
  }
  function reset() { epoch++; node('recipient-email').value = ''; context = null; identity = null; value = null; token = ''; busy = false; error = message = confirmation = ''; lastLoad = 0; pending = null; render(); }
  async function verify(start, expected) {
    const session = await client.request('/api/session');
    if (start !== epoch || paused) return false;
    if (!expected || expected !== (session.user ? `${session.user.id}:${session.csrfToken}` : null)) { reset(); return false; }
    return true;
  }
  async function load() {
    if (!context || busy || paused || pending) return;
    const start = epoch, rideId = context.rideId, expected = identity; lastLoad = now();
    try {
      const response = await client.request(`/api/parcels/${rideId}/invitation`);
      if (!await verify(start, expected)) return;
      readParcelInvitationResponse(response, rideId);
      if (value?.link?.id !== response.invitation.link?.id || !response.invitation.link?.active || response.invitation.link?.claimed) token = '';
      value = response.invitation; error = message = ''; render();
    } catch (failure) { if (start === epoch) { if ([401, 403].includes(failure.status)) reset(); token = ''; error = failure.message; render(); } }
  }
  async function act(action, retry = false) {
    if (!context || busy || !value || paused || (pending && !retry)) return;
    const recipientEmail = node('recipient-email').value.trim().toLowerCase();
    if (!retry && action !== 'revoke' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      error = 'Enter your intended recipient’s Taxi Ai account email before creating the invitation.';
      render(); return;
    }
    const start = epoch, rideId = context.rideId, expected = identity;
    const data = retry ? pending.data : action === 'revoke' ? { linkId: value.link.id, expectedVersion: value.link.version }
      : { expectedLinkId: value.link?.id ?? null, recipientEmail };
    busy = true; error = message = confirmation = ''; render();
    try {
      // The API client retains an identical command's retry key after an interrupted response.
      if (!await verify(start, expected)) return;
      pending = { action, data };
      const response = await client.command(`/api/parcels/${rideId}/${action === 'revoke' ? 'revoke' : 'link'}`, data);
      if (!await verify(start, expected)) return;
      readParcelInvitationResponse(response, rideId); pending = null;
      value = response.invitation; token = response.token ?? ''; message = action === 'revoke' ? 'Recipient access revoked.' : 'Invitation created. Copy or share it privately.';
    } catch (failure) { if (start === epoch) { if (failure.status && failure.status < 500) pending = null; error = failure.message; } }
    finally { if (start === epoch) { busy = false; render(); } }
  }
  node('retry').addEventListener('click', () => { if (pending) void act(pending.action, true); });
  node('create').addEventListener('click', () => void act('create'));
  for (const action of ['replace', 'revoke']) node(action).addEventListener('click', () => { if (!busy) { confirmation = action; render(); } });
  node('confirm-action').addEventListener('click', () => { if (confirmation) void act(confirmation); });
  node('keep').addEventListener('click', () => { confirmation = ''; render(); });
  node('refresh').addEventListener('click', () => void load());
  async function send(method) {
    const start = epoch, url = node('url').value;
    if (!url || busy || paused || pending || !context) return;
    try { await method(url); if (start === epoch) { message = 'Invitation shared. Keep it private to your recipient.'; render(); } }
    catch { if (start === epoch) { message = 'Copy the invitation above to share it manually.'; render(); } }
  }
  node('copy').addEventListener('click', () => void send(copy));
  node('share').addEventListener('click', () => { if (share) void send(share); });
  return Object.freeze({ reset,
    session(session) { const next = session.user ? `${session.user.id}:${session.csrfToken}` : null; if (next !== identity) { reset(); identity = next; } },
    context(user, ride) {
      const next = user?.role === 'customer' && ride?.customer.id === user.id && ride.delivery ? { userId: user.id, rideId: ride.id, status: ride.status } : null;
      if (next?.userId === context?.userId && next?.rideId === context?.rideId) { if (context?.status !== next?.status) message = ''; context = next; render(); return; }
      epoch++; node('recipient-email').value = ''; pending = null; context = next; value = null; token = ''; busy = false; error = message = confirmation = ''; render(); void load();
    },
    poll() { if (now() - lastLoad >= 10_000) return load(); },
    pause() { epoch++; paused = true; token = ''; node('recipient-email').value = ''; busy = false; render(); },
    resume() { paused = false; void load(); render(); },
    tick: render,
  });
}
