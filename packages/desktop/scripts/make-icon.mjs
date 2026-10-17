#!/usr/bin/env node
/**
 * scripts/make-icon.mjs (F375) — generate the FleetOS mark as PNGs,
 * deterministically, with zero dependencies (node:zlib + hand-packed PNG
 * chunks). The geometry mirrors branding/fleetos-mark.svg exactly: the
 * shell's own ◈ brand glyph — amber diamond with a navy inner diamond on
 * the console's deep navy, rounded corners — rendered with 4x
 * supersampling so the edges are clean.
 *
 * Output (all gitignored build outputs):
 *   branding/icon.png          512x512 (electron-builder's linux icon)
 *   branding/icons/<N>x<N>.png 16..512 (the hicolor set electron-builder
 *                                installs into the .deb)
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRANDING = path.resolve(HERE, "..", "branding");

// The mark's palette — the shell's own (styles.ts).
const NAVY = [0x0b, 0x0f, 0x14];
const AMBER = [0xe8, 0xa3, 0x3d];
const BORDER = [0x1d, 0x2a, 0x38];
const SIZE = 512;
const SS = 4; // supersampling factor
const BIG = SIZE * SS;

/** Is point (x, y) inside the diamond with vertices (cx±r, cy), (cx, cy±r)? */
function inDiamond(x, y, cx, cy, r) {
  return Math.abs(x - cx) + Math.abs(y - cy) <= r;
}

/** Is (x, y) inside a rounded rect [0,SIZE]² with corner radius rad? */
function inRoundedRect(x, y, rad) {
  if (x < 0 || y < 0 || x > SIZE || y > SIZE) return false;
  const cx = Math.min(Math.max(x, rad), SIZE - rad);
  const cy = Math.min(Math.max(y, rad), SIZE - rad);
  return (
    (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2 ||
    (x >= rad && x <= SIZE - rad) ||
    (y >= rad && y <= SIZE - rad)
  );
}

function render() {
  // The SVG geometry, scaled to the 512 grid (4px border stroke → the outer
  // ring is a band between radius 72 and 72-4).
  const big = Buffer.alloc(BIG * BIG * 3, 0);
  for (let y = 0; y < BIG; y += 1) {
    for (let x = 0; x < BIG; x += 1) {
      const sx = x / SS;
      const sy = y / SS;
      // Paint order = the SVG's: rounded-rect navy plate, 4px border ring,
      // then the ◈ mark (amber outer diamond, navy inner diamond).
      let color;
      if (!inRoundedRect(sx, sy, 72)) {
        color = NAVY; // corners outside the rounded rect stay navy too
      } else if (!inRoundedRect(sx - 6, sy - 6, 66)) {
        color = BORDER;
      } else if (inDiamond(sx, sy, 256, 256, 86)) {
        color = NAVY;
      } else if (inDiamond(sx, sy, 256, 256, 172)) {
        color = AMBER;
      } else {
        color = NAVY; // the console background
      }
      const i = (y * BIG + x) * 3;
      big[i] = color[0];
      big[i + 1] = color[1];
      big[i + 2] = color[2];
    }
  }
  // Downsample 4x4 → one pixel.
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy += 1) {
        for (let dx = 0; dx < SS; dx += 1) {
          const i = ((y * SS + dy) * BIG + (x * SS + dx)) * 3;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
        }
      }
      const n = SS * SS;
      const i = (y * SIZE + x) * 3;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
    }
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode an RGB8 buffer of size×size as a PNG (color type 2). */
function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const master = render();
mkdirSync(BRANDING, { recursive: true });
writeFileSync(path.join(BRANDING, "icon.png"), encodePng(master, SIZE));
mkdirSync(path.join(BRANDING, "icons"), { recursive: true });

/** Exact box-filter: target pixel (x, y) averages the source rectangle it
 *  covers (integer cells, fractional edge weights) — correct for every
 *  target size, not just divisors of the master size. */
function scale(masterRgb, from, to) {
  const scaled = Buffer.alloc(to * to * 3);
  const cell = from / to;
  for (let y = 0; y < to; y += 1) {
    const y0 = y * cell;
    const y1 = y0 + cell;
    for (let x = 0; x < to; x += 1) {
      const x0 = x * cell;
      const x1 = x0 + cell;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const i = (sy * from + sx) * 3;
          r += masterRgb[i] * weight;
          g += masterRgb[i + 1] * weight;
          b += masterRgb[i + 2] * weight;
          w += weight;
        }
      }
      const i = (y * to + x) * 3;
      scaled[i] = Math.round(r / w);
      scaled[i + 1] = Math.round(g / w);
      scaled[i + 2] = Math.round(b / w);
    }
  }
  return scaled;
}

for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(
    path.join(BRANDING, "icons", `${size}x${size}.png`),
    encodePng(size === SIZE ? master : scale(master, SIZE, size), size),
  );
}
console.log(
  "[f375:icon] wrote branding/icon.png (512) + branding/icons/{16..512} — the FleetOS mark",
);
