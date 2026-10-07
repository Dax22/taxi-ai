import { readFileSync } from 'node:fs';

const BASE = new URL('../../../../packages/shared/models/', import.meta.url);
export function loadDispatchMlArtifact(config) {
  if (config.mode === 'off') return null;
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(config.model)) throw new Error('Invalid dispatch ML model name.');
  let artifact;
  try { artifact=JSON.parse(readFileSync(new URL(`${config.model}.json`,BASE),'utf8')); }
  catch { throw new Error('Configured dispatch ML model is not bundled in this reviewed release.'); }
  if (artifact?.version!==config.model) throw new Error('Dispatch ML artifact filename and version must match.');
  return Object.freeze(artifact);
}
