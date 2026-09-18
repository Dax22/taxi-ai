// Deliberately checks this repository's static ESM conventions, not arbitrary JS.
const api = 'services/api/src/';
const shared = 'packages/shared/src/';
const browser = 'apps/web/public/';

export function boundaryError(source, target) {
  if (source.startsWith(shared) && !target.startsWith(shared)) return 'Shared domain code must remain independent of apps and API adapters.';
  if (source.startsWith(browser) && !target.startsWith(browser) && !target.startsWith(shared)) return 'Browser code may import only public client modules and shared domain code.';
  if (!source.startsWith(api)) return null;
  const relative = source.slice(api.length);
  if (relative === 'application.mjs') return null;
  if (relative.startsWith('shared/') && !target.startsWith(`${api}shared/`)) return 'API shared rules must not depend on feature modules or adapters.';
  if (relative.startsWith('infrastructure/') && !target.startsWith(`${api}infrastructure/`) && !target.startsWith(`${api}shared/`)) return 'Infrastructure must not import feature services or HTTP routes.';
  if (relative.startsWith('http/') && !(target.startsWith(`${api}http/`) || target.startsWith(`${api}shared/`)
    || target.startsWith(shared) || /^services\/api\/src\/modules\/[^/]+\/routes\.mjs$/.test(target))) return 'HTTP can use route adapters and shared errors, not repositories or service constructors.';
  const feature = relative.match(/^modules\/([^/]+)\/([^/]+)$/);
  if (!feature) return null;
  const [, name, file] = feature;
  const sameModule = target.startsWith(`${api}modules/${name}/`);
  if (target.startsWith(`${api}modules/`) && !sameModule) return 'Feature modules communicate through injected ports, not imports into another feature.';
  if (file === 'routes.mjs') {
    return target.startsWith(`${api}http/`) || target.startsWith(`${api}shared/`) ? null : 'Route adapters receive services through injection.';
  }
  if (file === 'repository.mjs') return target.startsWith(`${api}shared/`) ? null : 'Repositories cannot import services, routes or other repositories.';
  if (target.startsWith(shared) || target.startsWith(`${api}shared/`)) return null;
  if (sameModule && target.endsWith('/domain.mjs') && file === 'service.mjs') return null;
  return 'Business services and domain rules must not import storage, HTTP or composition code.';
}

export function sourceErrors(path, source) {
  const errors = [];
  const isProduction = path.startsWith(api) || path.startsWith(shared) || path.startsWith(browser);
  if (!isProduction) return errors;
  if (/\bimport\s*\(/.test(source) || /\brequire\s*\(/.test(source)) errors.push('Use static ESM imports so module boundaries remain checkable.');
  if (path.startsWith(api) && /\.(?:prepare|exec)\s*\(/.test(source)
    && !path.includes('/infrastructure/') && !path.endsWith('/repository.mjs')) errors.push('SQL access belongs to a repository or infrastructure adapter.');
  if (path.startsWith(browser) && /\bfetch\s*\(/.test(source) && !path.endsWith('/dashboard/api-client.mjs')) errors.push('Dashboard network access belongs to its API client.');
  return errors;
}

export function findCycle(graph) {
  const visiting = new Set(), visited = new Set(), stack = [];
  function visit(node) {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node); stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop(); visiting.delete(node); visited.add(node);
    return null;
  }
  for (const node of graph.keys()) { const cycle = visit(node); if (cycle) return cycle; }
  return null;
}
