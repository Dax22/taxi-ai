import { createRuntimeConfig } from '../services/api/src/infrastructure/runtime-config.mjs';
import { createCallConfig } from '../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../services/api/src/infrastructure/map-provider.mjs';
import { createGoogleConfig } from '../services/api/src/infrastructure/google-config.mjs';
import { createEmailConfig } from '../services/api/src/infrastructure/email-config.mjs';

try {
  const runtime = createRuntimeConfig();
  const google = createGoogleConfig(process.env, runtime);
  const email = createEmailConfig(process.env, runtime);
  const calls = createCallConfig({ ...process.env, TAXI_AI_CALLS_MODE: process.env.TAXI_AI_CALLS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'local') });
  const maps = createMapProvider({ env: { ...process.env, TAXI_AI_MAPS_MODE: process.env.TAXI_AI_MAPS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'community') } });
  if (runtime.mode === 'staging' && calls.mode === 'local') throw new Error('Staging calls require off or a configured relay.');
  console.log(`Configuration valid: ${runtime.mode}; calls=${calls.mode}; maps=${maps.mode}; google=${google.enabled ? 'on' : 'off'}; nativeGoogle=${google.nativeClientIds.length ? 'on' : 'off'}; email=${email.enabled ? 'smtp' : 'off'}; invited testers=${runtime.testers.size}.`);
  console.log('This checks configuration only, not TLS, network providers, disk persistence or a deployed server.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
