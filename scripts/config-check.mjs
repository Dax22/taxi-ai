import { createRuntimeConfig } from '../services/api/src/infrastructure/runtime-config.mjs';
import { createCallConfig } from '../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../services/api/src/infrastructure/map-provider.mjs';
import { createDispatchConfig } from '../services/api/src/infrastructure/dispatch-config.mjs';
import { createWorkerConfig } from '../services/api/src/infrastructure/worker-config.mjs';
import { createGoogleConfig } from '../services/api/src/infrastructure/google-config.mjs';
import { createEmailConfig } from '../services/api/src/infrastructure/email-config.mjs';
import { createPushProvider } from '../services/api/src/infrastructure/push-provider.mjs';
import { createVehicleVisionProvider } from '../services/api/src/infrastructure/vehicle-vision-provider.mjs';
import { createStaffMfaConfig } from '../services/api/src/infrastructure/staff-config.mjs';
import { readDriverFaceConfig } from '../services/api/src/infrastructure/driver-face-config.mjs';
import { createEatsConfig } from '../services/api/src/modules/eats/config.mjs';

try {
  const runtime = createRuntimeConfig();
  const workers = createWorkerConfig(process.env);
  if (workers.role !== 'all' && !process.env.TAXI_AI_DATABASE_URL) throw new Error('Split API/worker deployments require TAXI_AI_DATABASE_URL.');
  if (process.env.TAXI_AI_DATABASE_URL) {
    const url = new URL(process.env.TAXI_AI_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('Use a PostgreSQL URL with a database name.');
  }
  const google = createGoogleConfig(process.env, runtime);
  const email = createEmailConfig(process.env, runtime);
  const push = createPushProvider({ env: process.env });
  const vision = createVehicleVisionProvider({ env:process.env });
  const staffMfa = createStaffMfaConfig(process.env);
  const driverFace = readDriverFaceConfig(process.env);
  const eats = createEatsConfig(process.env);
  const calls = createCallConfig({ ...process.env, TAXI_AI_CALLS_MODE: process.env.TAXI_AI_CALLS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'local') });
  const maps = createMapProvider({ env: { ...process.env, TAXI_AI_MAPS_MODE: process.env.TAXI_AI_MAPS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'community') } });
  const dispatch = createDispatchConfig(process.env);
  if (runtime.mode === 'staging' && calls.mode === 'local') throw new Error('Staging calls require off or a configured relay.');
  console.log(`Configuration valid: ${runtime.mode}; calls=${calls.mode}; maps=${maps.mode}; google=${google.enabled ? 'on' : 'off'}; nativeGoogle=${google.nativeClientIds.length ? 'on' : 'off'}; email=${email.enabled ? 'smtp' : 'off'}; invited testers=${runtime.testers.size}.`);
  console.log(`Phone alerts: ${push.enabled ? 'configured' : 'off'}.`);
  console.log(`Staff authenticator: ${staffMfa.factor.available ? 'configured' : 'unavailable'}; required=${staffMfa.required}.`);
  console.log(`Storage: ${process.env.TAXI_AI_DATABASE_URL ? 'PostgreSQL (schema must already be migrated)' : 'SQLite (single instance)'}; process role=${workers.role}.`);
  console.log(`Vehicle photo checks: ${vision.enabled ? 'configured' : 'off'}.`);
  console.log(`Driver face comparison: ${driverFace.provider}; this does not validate credentials, licence records or liveness.`);
  console.log(`Ride matching: ${dispatch.mode}; pickup road estimates ${maps.mode === 'off' ? 'unavailable (distance fallback)' : 'use the configured router'}.`);
  console.log(`Eats new orders: ${eats.paused ? 'paused' : 'test-only preview'}.`);
  console.log('This checks configuration only, not TLS, network providers, disk persistence or a deployed server.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
