import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';

export const RING_MS = 45_000, CONNECT_MS = 45_000, LEASE_MS = 30_000, MAX_MS = 30 * 60_000;
export function clientIdentity(value) {
  check(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'INVALID_CALL_CLIENT', 'Use the call controls in this browser window.');
  return value;
}
export function commandData(action, data) {
  const names = { create: [], accept: ['expectedVersion'], decline: ['expectedVersion'], end: ['reason'], signal: ['type', 'sdp'] }[action];
  check(names, 'NOT_FOUND', 'Call action not found.');
  fields(data, names);
  return Object.fromEntries(names.map((name) => [name, data[name]]));
}
export function version(call, expected) {
  check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'A call version is required.');
  check(call.version === expected, 'STALE_VERSION', 'The call changed. Review its current status.');
}
export function audioDescription(type, sdp, mode) {
  check(['offer', 'answer'].includes(type) && typeof sdp === 'string' && sdp.length <= 12_000
    && !/[^\x20-\x7e\r\n]/.test(sdp), 'INVALID_CALL_SIGNAL', 'Invalid audio connection details.');
  const lines = sdp.split(/\r?\n/);
  const media = lines.filter((line) => line.startsWith('m='));
  check(lines[0] === 'v=0' && media.length === 1 && /^m=audio \d+ UDP\/TLS\/RTP\/SAVPF /.test(media[0])
    && lines.some((line) => line.startsWith('a=ice-ufrag:')) && lines.some((line) => line.startsWith('a=ice-pwd:'))
    && lines.some((line) => /^a=fingerprint:sha-256 [0-9a-f:]+$/i.test(line)),
  'INVALID_CALL_SIGNAL', 'Only one encrypted audio stream is supported.');
  const candidates = lines.filter((line) => line.startsWith('a=candidate:'));
  check(candidates.length > 0 && candidates.length <= 64, 'INVALID_CALL_SIGNAL', 'No usable audio network route was found.');
  check(mode !== 'relay' || candidates.every((line) => / typ relay(?: |$)/.test(line)),
    'INVALID_CALL_SIGNAL', 'Relay mode requires relay candidates.');
  return sdp;
}
