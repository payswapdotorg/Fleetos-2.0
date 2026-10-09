/**
 * Browser shim for the domain packages' `node:crypto` usage (F301).
 *
 * The FleetOS domain packages hash with `createHash("sha256")` (digest
 * "hex"). Browsers have no synchronous crypto hash API, so this shim
 * implements SHA-256 in pure TypeScript — byte-identical to Node's output
 * (verified against node:crypto test vectors; SHA-256 is standardized).
 *
 * Scope: only what the packages' public paths use — createHash("sha256")
 * with .update(string | Uint8Array) and .digest("hex" | "uint8array").
 */

type UpdateInput = string | Uint8Array | ArrayBuffer;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export interface Hash {
  update(data: UpdateInput): Hash;
  digest(encoding: "hex"): string;
  digest(encoding: "uint8array"): Uint8Array;
}

class Sha256 implements Hash {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLen = 0;
  private totalLen = 0;

  update(data: UpdateInput): Hash {
    let bytes: Uint8Array;
    if (typeof data === "string") bytes = new TextEncoder().encode(data);
    else if (data instanceof Uint8Array) bytes = data;
    else bytes = new Uint8Array(data);
    let i = 0;
    if (this.bufferLen > 0) {
      const need = 64 - this.bufferLen;
      const take = Math.min(need, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.bufferLen);
      this.bufferLen += take;
      i = take;
      if (this.bufferLen === 64) {
        this.compress(this.buffer);
        this.bufferLen = 0;
      }
    }
    while (i + 64 <= bytes.length) {
      this.compress(bytes.subarray(i, i + 64));
      i += 64;
    }
    if (i < bytes.length) {
      this.buffer.set(bytes.subarray(i), 0);
      this.bufferLen = bytes.length - i;
    }
    this.totalLen += bytes.length;
    return this;
  }

  private compress(block: Uint8Array): void {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) this.h[i] = (this.h[i] + add[i]) >>> 0;
  }

  private finalize(): Uint8Array {
    const bitLen = this.totalLen * 8;
    const padLen = this.bufferLen < 56 ? 56 - this.bufferLen : 120 - this.bufferLen;
    const pad = new Uint8Array(padLen);
    pad[0] = 0x80;
    const lenBytes = new Uint8Array(8);
    let v = bitLen;
    for (let i = 7; i >= 0; i--) {
      lenBytes[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    this.update(pad);
    this.update(lenBytes);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (this.h[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }

  digest(encoding: "hex" | "uint8array"): string | Uint8Array {
    const out = this.finalize();
    if (encoding === "uint8array") return out;
    let hex = "";
    for (const b of out) hex += b.toString(16).padStart(2, "0");
    return hex;
  }
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== "sha256") {
    throw new Error(`fleetos browser crypto shim: unsupported algorithm ${algorithm} (sha256 only)`);
  }
  return new Sha256();
}

export default { createHash };
