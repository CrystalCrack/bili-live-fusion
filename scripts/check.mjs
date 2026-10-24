import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'extension');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : path.join(dir, entry.name));
const files = walk(extension); const errors = [];
for (const file of files.filter(file => file.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (error) { errors.push(`${file}: ${error.stderr}`); }
  const source = fs.readFileSync(file, 'utf8');
  if (/兜底|不保证|不代表|未验证/.test(source)) errors.push(`Disallowed product copy in ${file}`);
  if (!file.includes(`${path.sep}vendor${path.sep}`)) {
    for (const match of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) if (!fs.existsSync(path.resolve(path.dirname(file), match[1]))) errors.push(`Missing module: ${match[1]}`);
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) errors.push('Manifest must use version 3');
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js)]) if (!fs.existsSync(path.join(extension, file))) errors.push(`Missing manifest asset: ${file}`);
for (const file of files.filter(file => file.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (ids.length !== new Set(ids).size) errors.push(`Duplicate HTML IDs in ${file}`);
  if (/\bon(?:click|load|change|input|submit)=/i.test(html)) errors.push(`Inline event handler in ${file}`);
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html)) errors.push(`Inline script in ${file}`);
  if (/兜底|不保证|不代表|未验证/.test(html)) errors.push(`Disallowed product copy in ${file}`);
  for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), match[1].split('#')[0]))) errors.push(`Missing HTML asset: ${match[1]}`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Checked ${files.filter(file => file.endsWith('.js')).length} scripts, manifest, icons, HTML assets, CSP and product copy.`);
