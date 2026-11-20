// Generates assets/icon.png (256x256) — a gradient orb with waveform bars.
// Pure Node (zlib), no image deps. Runs automatically on npm install.
// 256px is required by electron-builder for the Windows app icon.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const S = SIZE / 128; // design-space scale (geometry was laid out at 128)

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// distance from point to a capsule (rounded bar), for the waveform bars
function capsuleDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const cx = ax + dx * t, cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

function main() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const bars = [22, 42, 58, 42, 22];
  const barR = 4.5 * S;
  const radius = 57.5 * S;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = x - SIZE / 2 + 0.5, cy = y - SIZE / 2 + 0.5;
      const r = Math.hypot(cx, cy);
      // circular mask with 1px anti-aliasing
      let a = Math.max(0, Math.min(1, radius - r + 0.5));
      // diagonal gradient
      const t = Math.max(0, Math.min(1, (x + y) / (SIZE * 2)));
      let R = Math.round(139 + (56 - 139) * t);
      let G = Math.round(92 + (189 - 92) * t);
      let B = Math.round(246 + (248 - 246) * t);
      // waveform bars blended on top (white)
      for (let i = 0; i < bars.length; i++) {
        const bx = (34 + i * 15) * S;
        const h = (bars[i] / 2) * S - barR;
        const d = capsuleDist(x + 0.5, y + 0.5, bx, SIZE / 2 - h, bx, SIZE / 2 + h);
        const ba = Math.max(0, Math.min(1, barR - d + 0.5));
        if (ba > 0) {
          R = Math.round(R * (1 - ba) + 255 * ba);
          G = Math.round(G * (1 - ba) + 255 * ba);
          B = Math.round(B * (1 - ba) + 255 * ba);
        }
      }
      const o = (y * SIZE + x) * 4;
      rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = Math.round(a * 255);
    }
  }

  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);

  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('icon written:', out, '(' + SIZE + 'x' + SIZE + ')');
}

main();
