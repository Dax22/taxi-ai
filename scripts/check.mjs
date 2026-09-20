import { readdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundaryError, sourceErrors, findCycle, importSpecifiers } from './architecture-rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const portable = (path) => path.split(sep).join('/');
async function collect(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    if (['node_modules', 'dist', 'build', '.expo', '.git'].includes(entry.name)) return [];
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? collect(path) : entry.name.endsWith('.mjs') ? [path] : [];
  }));
  return files.flat();
}
const files = (await Promise.all(['apps', 'services', 'packages', 'scripts'].map((path) => collect(resolve(root, path))))).flat();
const graph = new Map();
const failures = [];
for (const path of files) {
  const name = portable(relative(root, path));
  try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); }
  catch (error) { failures.push(`${name}: ${error.stderr?.toString().trim() ?? 'JavaScript syntax error'}`); }
  const source = await readFile(path, 'utf8');
  failures.push(...sourceErrors(name, source).map((message) => `${name}: ${message}`));
  const dependencies = [];
  // Static imports/re-exports under the enforced conventions above.
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith('node:')) {
      if (/^services\/api\/src\/(modules|shared)\//.test(name) || name.startsWith('packages/shared/src/') || /^apps\/(web|admin)\/public\//.test(name)) {
        failures.push(`${name}: Node adapters must be injected, not imported (${specifier}).`);
      }
      continue;
    }
    const target = specifier.startsWith('/shared/') ? resolve(root, 'packages/shared/src', specifier.slice(8))
      : specifier.startsWith('.') ? resolve(dirname(path), specifier) : null;
    if (!target) { failures.push(`${name}: unsupported or undeclared import ${specifier}`); continue; }
    const targetName = portable(relative(root, target));
    if (targetName.startsWith('../')) { failures.push(`${name}: import leaves the repository`); continue; }
    try { if (!(await stat(target)).isFile()) throw new Error(); }
    catch { failures.push(`${name}: missing import ${specifier}`); continue; }
    const error = boundaryError(name, targetName);
    if (error) failures.push(`${name} → ${targetName}: ${error}`);
    dependencies.push(targetName);
  }
  graph.set(name, dependencies);
}
const cycle = findCycle(graph);
if (cycle) failures.push(`Circular dependency: ${cycle.join(' → ')}`);
if (failures.length) {
  console.error(failures.join('\n')); process.exitCode = 1;
} else console.log(`Checked ${files.length} JavaScript modules: syntax, imports, dependency boundaries and cycles passed.`);
