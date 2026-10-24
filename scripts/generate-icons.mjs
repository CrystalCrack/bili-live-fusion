import fs from 'node:fs';
import zlib from 'node:zlib';
// Dependency-free PNG encoder; the extension can be loaded without a build.
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
for (const size of [16, 48, 128]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size * 64, py = (y + .5) / size * 64;
    const corner = Math.hypot(Math.max(19 - px, px - 45, 0), Math.max(19 - py, py - 45, 0));
    const ink = (px >= 16 && px < 29 && py >= 19 && py < 46) || (px >= 35 && px < 48 && py >= 19 && py < 46) || (px >= 19 && px < 26 && py >= 13 && py < 23) || (px >= 38 && px < 45 && py >= 41 && py < 51) || (px >= 26 && px < 38 && py >= 29 && py < 36);
    const color = ink ? [23, 43, 37] : [181, 244, 213]; const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = corner <= 19 ? 255 : 0;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(new URL(`../extension/assets/icon-${size}.png`, import.meta.url), png);
}
console.log('Extension icons generated.');
