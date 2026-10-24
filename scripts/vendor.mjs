import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), target = new URL('extension/vendor/', root);
fs.mkdirSync(target, { recursive: true });
for (const [pkg, file, dest] of [['hls.js', 'dist/hls.min.js', 'hls.min.js'], ['mpegts.js', 'dist/mpegts.js', 'mpegts.js']]) {
  fs.copyFileSync(new URL(`node_modules/${pkg}/${file}`, root), new URL(dest, target));
  const license = ['LICENSE', 'LICENSE.txt'].find(name => fs.existsSync(new URL(`node_modules/${pkg}/${name}`, root)));
  if (!license) throw new Error(`Missing license: ${pkg}`);
  fs.copyFileSync(new URL(`node_modules/${pkg}/${license}`, root), new URL(`${pkg}.LICENSE.txt`, target));
}
console.log(`Local playback libraries staged in ${fileURLToPath(target)}`);
