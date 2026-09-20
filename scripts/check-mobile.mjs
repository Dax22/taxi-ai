import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCycle } from './architecture-rules.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), app = resolve(root, 'apps/mobile');
const dependencies = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')).dependencies;
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(resolve(dir,e.name)) : /\.tsx?$/.test(e.name) ? [resolve(dir,e.name)] : []);
const failures = [], graph = new Map();
for (const path of [...files(resolve(app,'app')), ...files(resolve(app,'src'))]) {
  const source = readFileSync(path,'utf8'), name = relative(root,path), imports = [];
  if (/\bfetch\s*\(/.test(source) && !path.endsWith('/src/api/client.ts')) failures.push(`${name}: network access belongs to the mobile API client.`);
  if (/\b(?:localStorage|AsyncStorage)\b/.test(source)) failures.push(`${name}: private credentials must use the secure vault.`);
  if (/\bimport\s*\(/.test(source) || /\brequire\s*\(/.test(source)) failures.push(`${name}: use static imports.`);
  for (const match of source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    const value = match[1];
    if (!value.startsWith('.')) {
      const pkg = value.startsWith('@') ? value.split('/').slice(0,2).join('/') : value.split('/')[0];
      if (!Object.hasOwn(dependencies,pkg)) failures.push(`${name}: undeclared native dependency ${value}`);
      if (pkg === 'expo-secure-store' && !path.endsWith('/src/session/secure-vault.ts')) failures.push(`${name}: secure storage belongs to the vault adapter.`);
      continue;
    }
    const base = resolve(dirname(path),value), target = [base,base+'.ts',base+'.tsx'].find(existsSync);
    if (!target) { failures.push(`${name}: missing import ${value}`); continue; }
    const allowed = target.startsWith(resolve(app,'src')+'/') || target.startsWith(resolve(app,'app')+'/') || target.startsWith(resolve(root,'packages/shared/src')+'/');
    if (!allowed) failures.push(`${name}: native clients cannot import server or website internals.`);
    imports.push(relative(root,target));
  }
  graph.set(name,imports);
}
const cycle = findCycle(graph); if (cycle) failures.push(`Mobile import cycle: ${cycle.join(' → ')}`);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${graph.size} native modules: imports, network/storage ownership and cycles passed.`);
