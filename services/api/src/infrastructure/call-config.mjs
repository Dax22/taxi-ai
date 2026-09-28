import { createHmac } from 'node:crypto';

/** Loopback preview by default. Relay mode mints coturn REST credentials per call. */
export function createCallConfig(env = process.env) {
  const mode = env.TAXI_AI_CALLS_MODE ?? 'local';
  if (!['local', 'relay', 'off'].includes(mode)) throw new Error('TAXI_AI_CALLS_MODE must be local, relay or off.');
  const urls = (env.TAXI_AI_TURN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
  const secret = env.TAXI_AI_TURN_SECRET ?? '';
  function validUrl(url) {
    const match = url.match(/^turns?:[a-z0-9.-]+(?::(\d{1,5}))?(?:\?transport=(?:udp|tcp))?$/i);
    return Boolean(match && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535)));
  }
  if (mode === 'relay' && (!urls.length || urls.length > 4 || secret.length < 32
    || urls.some((url) => !validUrl(url)))) {
    throw new Error('Relay calls need valid TAXI_AI_TURN_URLS and a TAXI_AI_TURN_SECRET of at least 32 characters.');
  }
  return Object.freeze({ mode,
    describe: () => ({ mode, enabled: mode !== 'off', ringSeconds: 45, maximumMinutes: 30 }),
    rtc(callId, userId, now) {
      if (mode !== 'relay') return { iceServers: [], iceTransportPolicy: 'all' };
      const username = `${Math.floor(now / 1000) + 3600}:${callId}:${userId}`;
      return { iceTransportPolicy: 'relay', iceServers: [{ urls: [...urls], username,
        credential: createHmac('sha1', secret).update(username).digest('base64') }] };
    },
  });
}
