const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "icons");

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  function blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const na = a + (buf[i + 3] / 255) * (1 - a);
    if (na <= 0) return;
    buf[i] = Math.round((r * a + buf[i] * (buf[i + 3] / 255) * (1 - a)) / na);
    buf[i + 1] = Math.round((g * a + buf[i + 1] * (buf[i + 3] / 255) * (1 - a)) / na);
    buf[i + 2] = Math.round((b * a + buf[i + 2] * (buf[i + 3] / 255) * (1 - a)) / na);
    buf[i + 3] = Math.round(na * 255);
  }
  function sdRoundRect(px, py, x, y, w, h, r) {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
    const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  }
  function drawShape(test, color) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = test(x + 0.5, y + 0.5);
        const alpha = Math.min(1, Math.max(0, 0.5 - d));
        if (alpha > 0) blend(x, y, color[0], color[1], color[2], alpha);
      }
    }
  }
  function fillRoundedRect(x, y, w, h, r, color) {
    drawShape((px, py) => sdRoundRect(px, py, x, y, w, h, r), color);
  }
  function fillCircle(cx, cy, r, color) {
    drawShape((px, py) => Math.hypot(px - cx, py - cy) - r, color);
  }
  return { buf, fillRoundedRect, fillCircle, size };
}

function paintBackdrop(c, radius) {
  const S = c.size;
  for (let y = 0; y < S; y++) {
    const t = y / (S - 1);
    const r = Math.round(0x81 + (0x4f - 0x81) * t);
    const g = Math.round(0x8c + (0x46 - 0x8c) * t);
    const b = Math.round(0xf8 + (0xe5 - 0xf8) * t);
    for (let x = 0; x < S; x++) {
      if (radius > 0) {
        const qx = Math.abs(x + 0.5 - S / 2) - (S / 2 - radius);
        const qy = Math.abs(y + 0.5 - S / 2) - (S / 2 - radius);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
        const alpha = Math.min(1, Math.max(0, 0.5 - d));
        const i = (y * S + x) * 4;
        c.buf[i] = r;
        c.buf[i + 1] = g;
        c.buf[i + 2] = b;
        c.buf[i + 3] = Math.round(alpha * 255);
      } else {
        const i = (y * S + x) * 4;
        c.buf[i] = r;
        c.buf[i + 1] = g;
        c.buf[i + 2] = b;
        c.buf[i + 3] = 255;
      }
    }
  }
}

function drawRobot(c, scale, centerY) {
  const S = c.size;
  const cx = S / 2;
  const u = (S / 512) * scale;
  const headW = 212 * u;
  const headH = 168 * u;
  const headX = cx - headW / 2;
  const headY = centerY - headH / 2;

  c.fillRoundedRect(headX, headY, headW, headH, 44 * u, [255, 255, 255]);

  const eyeY = headY + 76 * u;
  c.fillCircle(cx - 46 * u, eyeY, 20 * u, [0x31, 0x2e, 0x81]);
  c.fillCircle(cx + 46 * u, eyeY, 20 * u, [0x31, 0x2e, 0x81]);

  c.fillRoundedRect(cx - 34 * u, headY + 116 * u, 68 * u, 16 * u, 8 * u, [0xc7, 0xd2, 0xfe]);

  const antTop = headY - 42 * u;
  c.fillRoundedRect(cx - 9 * u, antTop, 18 * u, 42 * u, 9 * u, [255, 255, 255]);
  c.fillCircle(cx, antTop - 12 * u, 22 * u, [255, 255, 255]);

  c.fillRoundedRect(headX - 32 * u, headY + 44 * u, 26 * u, 64 * u, 13 * u, [255, 255, 255]);
  c.fillRoundedRect(headX + headW + 6 * u, headY + 44 * u, 26 * u, 64 * u, 13 * u, [255, 255, 255]);
}

function drawIcon(size, { maskable }) {
  const c = makeCanvas(size);
  paintBackdrop(c, maskable ? 0 : size * 0.23);
  drawRobot(c, maskable ? 0.72 : 1, maskable ? size * 0.55 : size * 0.53);
  return encodePng(size, size, c.buf);
}

function drawAppleTouch(size) {
  const c = makeCanvas(size);
  const S = size;
  for (let y = 0; y < S; y++) {
    const t = y / (S - 1);
    const r = Math.round(0x81 + (0x4f - 0x81) * t);
    const g = Math.round(0x8c + (0x46 - 0x8c) * t);
    const b = Math.round(0xf8 + (0xe5 - 0xf8) * t);
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      c.buf[i] = r;
      c.buf[i + 1] = g;
      c.buf[i + 2] = b;
      c.buf[i + 3] = 255;
    }
  }
  const u = S / 512 * 0.78;
  const cx = S / 2;
  const headW = 212 * u;
  const headH = 168 * u;
  const headX = cx - headW / 2;
  const headY = S * 0.55 - headH / 2;

  c.fillRoundedRect(headX, headY, headW, headH, 44 * u, [255, 255, 255]);
  const eyeY = headY + 76 * u;
  c.fillCircle(cx - 46 * u, eyeY, 20 * u, [0x31, 0x2e, 0x81]);
  c.fillCircle(cx + 46 * u, eyeY, 20 * u, [0x31, 0x2e, 0x81]);
  c.fillRoundedRect(cx - 34 * u, headY + 116 * u, 68 * u, 16 * u, 8 * u, [0xc7, 0xd2, 0xfe]);
  const antTop = headY - 42 * u;
  c.fillRoundedRect(cx - 9 * u, antTop, 18 * u, 42 * u, 9 * u, [255, 255, 255]);
  c.fillCircle(cx, antTop - 12 * u, 22 * u, [255, 255, 255]);
  c.fillRoundedRect(headX - 32 * u, headY + 44 * u, 26 * u, 64 * u, 13 * u, [255, 255, 255]);
  c.fillRoundedRect(headX + headW + 6 * u, headY + 44 * u, 26 * u, 64 * u, 13 * u, [255, 255, 255]);

  return encodePng(S, S, c.buf);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "icon-192.png"), drawIcon(192, { maskable: false }));
fs.writeFileSync(path.join(OUT, "icon-512.png"), drawIcon(512, { maskable: false }));
fs.writeFileSync(path.join(OUT, "icon-512-maskable.png"), drawIcon(512, { maskable: true }));
fs.writeFileSync(path.join(OUT, "apple-touch-icon.png"), drawAppleTouch(180));
console.log("Icons written to", OUT);
