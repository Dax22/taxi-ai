import { isActiveCall } from '/shared/call-lifecycle.mjs';
import { canChatDuringRide } from '/shared/trip-lifecycle.mjs';

/** Account/tab-scoped call orchestration. Acquiring a microphone always follows a click. */
export function createCallController({ client, media, view, makeId = () => crypto.randomUUID(), now = () => performance.now() }) {
  const clientId = makeId();
  const headers = { callClient: clientId };
  let user = null, selected = null, active = null, recent = [], settings = null;
  let generation = 0, polling = null, signaling = null, ending = null;
  let pending = null, pendingAt = 0, stream = null, transport = null, localCallId = null;
  let outgoing = null, sent = false, received = false, muted = false, connection = 'idle', error = '';
  let lastContact = 0, lastPulse = -Infinity, disconnectedAt = null;
  const allowed = (account) => account && (account.capabilities?.includes('customer')
    || account.role === 'customer' || (account.role === 'driver' && account.driver?.status === 'approved'));
  const current = (epoch) => epoch === generation && Boolean(user);
  const command = (path, data) => client.command(path, data, headers);
  function render() {
    view.render({ user, selected, active, recent, settings, pending, ending: Boolean(ending), muted, connection, error,
      supported: media.supported(), local: Boolean(stream && localCallId),
      canStart: Boolean(allowed(user) && (selected?.driver?.id !== user.id || user.driver?.status === 'approved')
        && settings?.enabled && selected?.driver && canChatDuringRide(selected.status)
        && !isActiveCall(active) && !pending && !ending && media.supported()) });
  }
  function release() {
    transport?.close(); transport = null;
    media.stop(stream); stream = null; localCallId = null; outgoing = null; sent = false; received = false;
    muted = false; connection = 'idle'; disconnectedAt = null; signaling = null;
    view.clearAudio();
  }
  function reset() {
    generation++; release(); user = null; selected = null; active = null; recent = []; settings = null;
    pending = null; polling = null; ending = null; error = ''; lastPulse = -Infinity; view.reset();
  }
  function setContext(account, ride) {
    if (user?.id !== account?.id || !allowed(account)) reset();
    if (pending && !localCallId && selected?.id !== ride?.id) {
      generation++; release(); pending = null; error = 'Call setup cancelled because the selected journey changed.';
    }
    user = allowed(account) ? account : null; selected = ride ?? null;
    if (active?.rideId === selected?.id && !canChatDuringRide(selected.status)) void end('hangup');
    render();
  }
  function friendly(cause) {
    if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError') return 'Microphone access was not granted. Allow it in your browser, then try again. Chat is still available.';
    if (cause.name === 'NotFoundError' || cause.name === 'NotReadableError') return 'Your microphone is unavailable. Check the device and other apps, or use chat.';
    return cause.message || 'Audio could not connect. Try another call or use chat.';
  }
  async function begin(answer = false) {
    if (!allowed(user) || pending || ending || !media.supported()) return;
    const call = active, ride = selected;
    if (!answer && ride?.driver?.id === user.id && user.driver?.status !== 'approved') return;
    if (answer ? !call || call.status !== 'ringing' || call.callee.id !== user.id
      : isActiveCall(call) || !settings?.enabled || !ride?.driver || !canChatDuringRide(ride.status)) return;
    const epoch = ++generation;
    pending = answer ? 'answering' : 'starting'; pendingAt = now(); error = ''; render();
    let acquired;
    try {
      acquired = await media.acquire();
      if (!current(epoch)) { media.stop(acquired); return; }
      stream = acquired;
      const result = await command(answer ? `/api/calls/${call.id}/accept` : `/api/rides/${ride.id}/calls`,
        answer ? { expectedVersion: call.version } : {});
      if (!current(epoch)) {
        media.stop(acquired);
        void command(`/api/calls/${result.call.id}/end`, { reason: 'client_closed' }).catch(() => {});
        return;
      }
      active = result.call;
      if (!isActiveCall(active) || !active.owned) { release(); return; }
      localCallId = active.id; lastContact = now(); lastPulse = -Infinity;
      connection = active.status === 'ringing' ? 'ringing' : 'connecting';
    } catch (cause) {
      media.stop(acquired);
      if (current(epoch)) { release(); error = friendly(cause); }
    } finally {
      if (current(epoch)) { pending = null; render(); void poll(); }
    }
  }
  async function end(reason = 'hangup') {
    if (ending) return ending;
    const call = active;
    const epoch = ++generation;
    release(); pending = null; render();
    if (!user || !isActiveCall(call)) return;
    const task = (async () => {
      try {
        const result = await command(`/api/calls/${call.id}/end`, { reason });
        if (current(epoch)) { active = result.call; connection = 'idle'; }
      } catch (cause) { if (current(epoch)) error = 'Your microphone is off. Ending the saved call could not be confirmed; retry End call or wait for it to expire.'; }
      finally { if (ending === task) ending = null; if (current(epoch)) render(); }
    })();
    ending = task; render(); return task;
  }
  async function decline() {
    if (pending || !user || active?.status !== 'ringing' || active.callee.id !== user.id) return;
    const call = active, epoch = generation;
    pending = 'declining'; pendingAt = now(); render();
    try {
      const result = await command(`/api/calls/${call.id}/decline`, { expectedVersion: call.version });
      if (current(epoch)) active = result.call;
    } catch (cause) { if (current(epoch)) error = friendly(cause); }
    finally { if (current(epoch)) { pending = null; render(); } }
  }
  async function reconcile(epoch) {
    if (signaling || !stream || !isActiveCall(active) || active.id !== localCallId || !active.owned || active.status === 'ringing') return;
    const call = active;
    const task = (async () => {
      try {
        const data = await client.request(`/api/calls/${call.id}/media`, headers);
        if (!current(epoch) || localCallId !== call.id) return;
        lastContact = now();
        if (!transport) {
          transport = media.connect(data.configuration, stream, {
            onState(value) {
              if (!current(epoch) || localCallId !== call.id) return;
              connection = value;
              if (value === 'disconnected') disconnectedAt ??= now(); else disconnectedAt = null;
              if (value === 'failed' || value === 'closed') { error = 'Audio connection failed. You can try again or use chat.'; void end('media_failed'); }
              else { lastPulse = -Infinity; render(); }
            },
            onRemote(remote) { if (current(epoch) && localCallId === call.id) view.remote(remote); },
          });
        }
        const caller = call.caller.id === user.id;
        if (!outgoing && (caller || data.remoteDescription)) {
          const description = await transport.describe(caller ? 'offer' : 'answer', caller ? null : data.remoteDescription);
          if (!current(epoch) || localCallId !== call.id) return;
          outgoing = description;
          if (!caller) received = true;
        }
        if (outgoing && !sent) {
          await command(`/api/calls/${call.id}/signal`, outgoing);
          if (!current(epoch) || localCallId !== call.id) return;
          sent = true;
        }
        if (caller && data.remoteDescription && !received) {
          await transport.accept(data.remoteDescription);
          if (!current(epoch) || localCallId !== call.id) return;
          received = true;
        }
        error = ''; render();
      } catch (cause) {
        if (!current(epoch)) return;
        error = friendly(cause);
        // A dropped transport response can retry the identical stored SDP/key.
        if (cause.status || !outgoing) void end('media_failed');
        render();
      } finally { if (signaling === task) signaling = null; }
    })();
    signaling = task;
    return task;
  }
  function poll() {
    if (!user || polling || ending) return polling ?? Promise.resolve();
    const epoch = generation;
    const task = (async () => {
      try {
        const result = await client.request('/api/calls', headers);
        if (!current(epoch)) return;
        lastContact = now(); settings = result.settings; recent = result.recent;
        const next = result.active;
        if (localCallId && (!next || next.id !== localCallId || !next.owned)) {
          generation++; release(); pending = null;
          active = next; render(); return;
        }
        if (pending === 'answering' && active && (!next || next.id !== active.id)) {
          generation++; release(); pending = null;
        }
        active = next;
        if (active?.owned && !stream && !pending) {
          error = 'This call has no audio in this window. Start a new call after it ends.';
          void end('client_closed'); render(); return;
        }
        render();
        if (stream && localCallId === active?.id && now() - lastPulse >= 8000) {
          lastPulse = now();
          await client.request(`/api/calls/${active.id}/pulse`, { ...headers, method: 'POST', data: { connected: transport?.connected() ?? false } });
          if (!current(epoch)) return;
          lastContact = now();
        }
        void reconcile(epoch);
      } catch (cause) {
        if (!current(epoch)) return;
        error = [401, 403].includes(cause.status) ? 'Your call session ended. Sign in again to call.' : 'Call connection unavailable. Chat remains available when connected.';
        if ([401, 403, 409].includes(cause.status)) { generation++; release(); pending = null; active = null; }
        render();
      } finally { if (polling === task) polling = null; }
    })();
    polling = task;
    return task;
  }
  function tick() {
    if ((pending && now() - pendingAt >= 30_000) || (stream && localCallId && now() - lastContact >= 15_000)
      || (disconnectedAt !== null && now() - disconnectedAt >= 8000)) {
      error = 'The call stopped because audio or signaling was unavailable. Try again or use chat.';
      void end('media_failed');
    }
  }
  function mute() {
    if (!stream) return;
    muted = !muted; for (const track of stream.getAudioTracks()) track.enabled = !muted; render();
  }
  return Object.freeze({ setContext, reset, poll, tick, start: () => begin(false), answer: () => begin(true), decline,
    end, mute, hasMedia: () => Boolean(stream || pending), snapshot: () => ({ selected, active, pending, connection, muted, error }),
    shutdown() { void end('client_closed'); },
  });
}
