// Dev tool: generates the PWA icons (icon-192.png, icon-512.png, apple-touch-icon.png)
// as pure PNGs using only zlib — no image library needed.
// Motif: the app's ring — period ticks in rose, fertile hints in mint, ovulation
// in amber, rest muted — on --night, with a bright ink dot marking today.
const zlib = require('zlib');
const fs = require('fs');

// ---- CRC32 (needed for PNG chunk checksums) --------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(size, rgb) { // rgb: Buffer, size*size*3 bytes, row-major
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- the ring motif ---------------------------------------------------------
const night = [0x14, 0x10, 0x20];
const rose = [0xF0, 0x5C, 0x7C];
const mint = [0x68, 0xCE, 0xB6];
const amber = [0xF7, 0xB8, 0x58];
const muted = [0x9C, 0x90, 0xB8];
const ink = [0xEF, 0xE9, 0xF7];
const TAU = Math.PI * 2;
const TICKS = 28;
const TODAY_INDEX = 6; // cycle day 7, like the screenshots

function tickColor(i) {
  if (i <= 4) return rose;                              // period
  if (i === 13) return amber;                           // ovulation
  if (i === 11 || i === 12 || i === 14 || i === 15) return mint; // fertile hints
  return muted;
}

// hard-shaded at 2x, then box-downsampled for antialiasing
function render(size) {
  const S = size * 2;
  const px = Buffer.alloc(S * S * 3);
  const cx = S / 2, cy = S / 2;
  const R = S * 0.30;          // ring radius
  const W = S * 0.055;         // band width
  const span = 0.6 * (TAU / TICKS);
  const aT = TODAY_INDEX * TAU / TICKS;
  const dx = cx + R * Math.sin(aT), dy = cy - R * Math.cos(aT);
  const dotR = S * 0.075;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c = night;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - R) <= W / 2) {
        const a = Math.atan2(x - cx, cy - y); // 0 at top, clockwise
        const i = ((Math.round((a / TAU) * TICKS) % TICKS) + TICKS) % TICKS;
        const aC = i * TAU / TICKS;
        let da = Math.abs(((a - aC) % TAU + TAU) % TAU);
        if (da > Math.PI) da = TAU - da;
        if (da <= span / 2) c = tickColor(i);
      }
      if (Math.hypot(x - dx, y - dy) <= dotR) c = ink;
      const o = (y * S + x) * 3;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
    }
  }
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const o = ((y * 2 + sy) * S + (x * 2 + sx)) * 3;
          r += px[o]; g += px[o + 1]; b += px[o + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / 4);
      out[o + 1] = Math.round(g / 4);
      out[o + 2] = Math.round(b / 4);
    }
  }
  return out;
}

const here = __dirname + '/';
fs.writeFileSync(here + 'icon-192.png', encodePNG(192, render(192)));
fs.writeFileSync(here + 'icon-512.png', encodePNG(512, render(512)));
fs.writeFileSync(here + 'apple-touch-icon.png', encodePNG(180, render(180)));
console.log('wrote icon-192.png, icon-512.png, apple-touch-icon.png (180x180)');
