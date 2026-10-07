import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

/** Loopback preview by default. Relay mode mints coturn REST credentials per call. */
export function createCallConfig(env = process.env, { readSecret = (path) => readFileSync(path, 'utf8') } = {}) {
  const hosted = env.TAXI_AI_MODE === 'staging' || env.NODE_ENV === 'production';
  const mode = env.TAXI_AI_CALLS_MODE ?? (hosted ? 'off' : 'local');
  if (hosted && mode === 'local') throw new Error('Hosted calls require off or a configured relay.');
  if (!['local', 'relay', 'off'].includes(mode)) throw new Error('TAXI_AI_CALLS_MODE must be local, relay or off.');
  const urls = (env.TAXI_AI_TURN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
  const secretFile = env.TAXI_AI_TURN_SECRET_FILE ?? '';
  if (secretFile && secretFile !== '/run/secrets/turn_secret') throw new Error('TAXI_AI_TURN_SECRET_FILE must use /run/secrets/turn_secret.');
  if (secretFile && env.TAXI_AI_TURN_SECRET) throw new Error('Configure the TURN shared secret either inline or as a Docker secret, not both.');
  let secret = env.TAXI_AI_TURN_SECRET ?? '';
  if (secretFile) {
    try { secret = String(readSecret(secretFile)).replace(/\r?\n$/, ''); }
    catch { throw new Error('TURN relay secret file is unavailable.'); }
  }
  function validUrl(url) {
    const match = url.match(/^turns?:[a-z0-9.-]+(?::(\d{1,5}))?(?:\?transport=(?:udp|tcp))?$/i);
    return Boolean(match && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535)));
  }
  if (mode === 'relay' && (!urls.length || urls.length > 4 || secret.startsWith('DISABLED-') || secret.length < 32 || secret.length > 1024 || /[\u0000-\u0020\u007f]/u.test(secret)
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
