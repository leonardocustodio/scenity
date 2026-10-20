// SPDX-License-Identifier: Apache-2.0
/**
 * An animated WebP file from still WebP frames, without an encoder program. The browser encodes each frame
 * (canvas.toBlob, "image/webp"), and this module puts the image data of each frame into one file (the RIFF container
 * of WebP: VP8X, ANIM and one ANMF chunk per frame). Chrome, Safari and the Quick Look of macOS
 * play the file.
 */

/** The image chunks of a still WebP file: ALPH (if any), then VP8 or VP8L. */
function imageChunks(webp: Uint8Array): { readonly bytes: Uint8Array; readonly alpha: boolean } {
  const text = (at: number) => String.fromCharCode(...webp.subarray(at, at + 4));
  if (text(0) !== "RIFF" || text(8) !== "WEBP") throw new Error("A frame is not a WebP file.");
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const parts: Uint8Array[] = [];
  let alpha = false;
  let at = 12;
  while (at + 8 <= webp.length) {
    const tag = text(at);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (tag === "ALPH" || tag === "VP8 " || tag === "VP8L") {
      parts.push(webp.subarray(at, Math.min(end, webp.length)));
      if (tag === "ALPH" || tag === "VP8L") alpha = true;
    }
    at = end;
  }
  if (parts.length === 0) throw new Error("A WebP frame has no image data.");
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, alpha };
}

function u24(target: Uint8Array, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >> 8) & 0xff;
  target[at + 2] = (value >> 16) & 0xff;
}

function chunk(tag: string, body: Uint8Array): Uint8Array {
  const pad = body.length % 2;
  const out = new Uint8Array(8 + body.length + pad);
  for (let i = 0; i < 4; i += 1) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/**
 * One animated WebP file: the frames (still WebP files of the same size), each shown `durationMs`, in a loop.
 */
export function animatedWebp(
  frames: readonly Uint8Array[],
  size: { readonly width: number; readonly height: number },
  durationMs: number,
): Uint8Array {
  if (frames.length === 0) throw new Error("An animation needs at least one frame.");
  const images = frames.map(imageChunks);
  const vp8x = new Uint8Array(10);
  // Flags: animation (bit 1), alpha (bit 4) when a frame has alpha.
  vp8x[0] = 0x02 | (images.some((image) => image.alpha) ? 0x10 : 0);
  u24(vp8x, 4, size.width - 1);
  u24(vp8x, 7, size.height - 1);
  // The background colour (white, BGRA) and the loop count (0: always).
  const anim = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0]);
  const anmf = images.map(({ bytes }) => {
    const head = new Uint8Array(16);
    u24(head, 6, size.width - 1);
    u24(head, 9, size.height - 1);
    u24(head, 12, Math.max(1, Math.round(durationMs)));
    // No blend with the frame before; no dispose.
    head[15] = 0x02;
    const body = new Uint8Array(head.length + bytes.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    return chunk("ANMF", body);
  });
  const parts = [chunk("VP8X", vp8x), chunk("ANIM", anim), ...anmf];
  const length = 4 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(8 + length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, length, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  let offset = 12;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
