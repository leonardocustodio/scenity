// SPDX-License-Identifier: Apache-2.0
/**
 * SHA-256 without `node:crypto` and without the async Web Crypto API. The lab page calculates a frame key in a
 * `computed` of Vue, so the hash must be synchronous. The host, the Vite plugin and the tools use the same function,
 * so each part calculates the same key. FIPS 180-4.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const encoder = new TextEncoder();

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Process one block of 64 bytes at `offset` of `view` into the state `h`. */
function block(h: Uint32Array, w: Uint32Array, view: DataView, offset: number): void {
  for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
  for (let i = 16; i < 64; i += 1) {
    const a = w[i - 15] ?? 0;
    const b = w[i - 2] ?? 0;
    const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
    const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
    w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, k] = [
    h[0] ?? 0,
    h[1] ?? 0,
    h[2] ?? 0,
    h[3] ?? 0,
    h[4] ?? 0,
    h[5] ?? 0,
    h[6] ?? 0,
    h[7] ?? 0,
  ];
  for (let i = 0; i < 64; i += 1) {
    const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    k = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  const add = [a, b, c, d, e, f, g, k];
  for (let i = 0; i < 8; i += 1) h[i] = ((h[i] ?? 0) + (add[i] ?? 0)) >>> 0;
}

/** The SHA-256 of bytes or of the UTF-8 bytes of a text, as 64 lowercase hex characters. */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const h = new Uint32Array(INITIAL);
  const w = new Uint32Array(64);
  const full = bytes.length - (bytes.length % 64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < full; offset += 64) block(h, w, view, offset);
  // The last blocks: the rest of the bytes, the bit 1, zeros and the length in bits (u64, big-endian).
  const tail = new Uint8Array(bytes.length - full < 56 ? 64 : 128);
  tail.set(bytes.subarray(full));
  tail[bytes.length - full] = 0x80;
  const tailView = new DataView(tail.buffer);
  const bits = bytes.length * 8;
  tailView.setUint32(tail.length - 8, Math.floor(bits / 0x1_0000_0000));
  tailView.setUint32(tail.length - 4, bits >>> 0);
  for (let offset = 0; offset < tail.length; offset += 64) block(h, w, tailView, offset);
  let hex = "";
  for (const word of h) hex += word.toString(16).padStart(8, "0");
  return hex;
}
