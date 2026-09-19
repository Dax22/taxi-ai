import { CALL_LABELS, CALL_REASONS, isActiveCall } from '/shared/call-lifecycle.mjs';
import { $, element } from './dom.mjs';

export function createCallView({ onStart, onAnswer, onDecline, onEnd, onMute, onOpenRide }) {
  const audio = $('call-audio');
  let state = null, recentKey = '', audioGeneration = 0;
  function render(next) {
    state = next;
    const { user, selected, active, settings, pending, connection, error, supported, local, muted } = next;
    $('calls-panel').hidden = !user;
    const ongoing = isActiveCall(active);
    const incoming = ongoing && active.status === 'ringing' && active.callee.id === user?.id;
    const peer = active ? active.caller.id === user?.id ? active.callee : active.caller
      : selected?.driver ? selected.customer.id === user?.id ? selected.driver : selected.customer : null;
    $('call-title').textContent = ongoing ? `${incoming ? 'Incoming call ·' : 'Call with'} ${peer.name}` : 'Talk in Taxi Ai';
    $('call-status').textContent = next.ending ? 'Ending call…' : pending === 'declining' ? 'Declining call…' : pending ? 'Waiting for microphone / call setup…'
      : ongoing ? active.status === 'ringing' ? incoming ? 'Incoming audio call' : 'Ringing…'
        : !local ? 'Active in another window' : connection === 'connected' ? 'Audio connected'
          : connection === 'disconnected' ? 'Reconnecting audio…' : 'Connecting audio…' : 'Ready when you are';
    $('call-error').textContent = error;
    $('call-mode').textContent = settings?.mode === 'local' ? 'Local audio preview · keep both account windows open on this computer.'
      : settings?.mode === 'relay' ? 'Audio relay configured · keep both account windows open.'
        : settings?.mode === 'off' ? 'Calling is disabled. You can still use chat.' : 'Checking calling availability…';
    $('call-guidance').textContent = !supported ? 'This browser needs microphone support and a secure connection. Chat is still available.'
      : ongoing ? 'Your phone number is not used. Any fare discussed still needs an accepted offer in the app.'
        : peer ? `Call ${peer.name} about the selected journey, or continue in chat.` : 'Select a journey with an assigned driver to call.';
    $('call-start').hidden = ongoing || Boolean(pending);
    $('call-start').dataset.locked = String(!next.canStart);
    $('call-answer').hidden = !incoming;
    $('call-answer').dataset.locked = String(!supported || Boolean(pending));
    $('call-decline').hidden = !incoming;
    $('call-decline').dataset.locked = String(Boolean(pending));
    $('call-end').hidden = !ongoing && !pending;
    $('call-end').dataset.locked = 'false';
    $('call-mute').hidden = !local;
    $('call-mute').dataset.locked = String(!local);
    $('call-mute').textContent = muted ? 'Unmute' : 'Mute';
    $('call-mute').setAttribute('aria-pressed', String(muted));
    $('call-open-ride').hidden = !ongoing || active.rideId === selected?.id;
    for (const id of ['call-start', 'call-answer', 'call-decline', 'call-end', 'call-mute']) $(id).disabled = $(id).dataset.locked === 'true';
    const key = JSON.stringify([user?.id, next.recent]);
    if (key !== recentKey) {
      recentKey = key; $('call-history').replaceChildren();
      for (const call of next.recent) {
        const other = call.caller.id === user.id ? call.callee : call.caller;
        const row = element('li');
        const label = call.status === 'missed' && call.caller.id === user.id ? 'No answer' : CALL_LABELS[call.status];
        row.append(element('strong', `${label} · ${other.name}`), element('span', `${new Date(call.createdAt).toLocaleString()} · ${CALL_REASONS[call.reason] ?? ''}`));
        $('call-history').append(row);
      }
      $('call-history-section').hidden = !next.recent.length;
    }
  }
  async function play() {
    const generation = audioGeneration;
    try { await audio.play(); if (generation === audioGeneration) $('call-play-audio').hidden = true; }
    catch { if (generation === audioGeneration && audio.srcObject) $('call-play-audio').hidden = false; }
  }
  function clearAudio() { audioGeneration++; audio.pause(); audio.srcObject = null; $('call-play-audio').hidden = true; }
  $('call-start').addEventListener('click', onStart);
  $('call-answer').addEventListener('click', onAnswer);
  $('call-decline').addEventListener('click', onDecline);
  $('call-end').addEventListener('click', onEnd);
  $('call-mute').addEventListener('click', onMute);
  $('call-play-audio').addEventListener('click', play);
  $('call-open-ride').addEventListener('click', () => { if (state?.active) onOpenRide(state.active.rideId); });
  return Object.freeze({ render, clearAudio,
    remote(stream) { audio.srcObject = stream; void play(); },
    reset() { state = null; recentKey = ''; clearAudio(); $('call-history').replaceChildren(); $('calls-panel').hidden = true; $('call-error').textContent = ''; },
  });
}
