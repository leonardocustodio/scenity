// SPDX-License-Identifier: Apache-2.0
/**
 * The body of an answer of the render pool with a picture: a JSON head and the bytes of the picture in one binary
 * body, so a picture never goes through base64. The form: `CBP1`, the length of the JSON head as a u32 (big endian),
 * the JSON head as UTF-8, the bytes. The lab pool and the scene pool of `scenity pool` send their pictures in this
 * form.
 */
const MAGIC = "CBP1";

/** Join a JSON head and bytes into one body. */
export function packPicture(head: unknown, bytes: Uint8Array): Buffer {
  const json = Buffer.from(JSON.stringify(head), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(json.byteLength, 0);
  return Buffer.concat([Buffer.from(MAGIC, "ascii"), size, json, bytes]);
}

/** Split a body of `packPicture`. Throw on another form. The caller knows the form of the head. */
export function unpackPicture(body: Uint8Array): { readonly head: unknown; readonly bytes: Buffer } {
  const data = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (data.byteLength < 8 || data.toString("ascii", 0, 4) !== MAGIC) throw new Error("Not a picture of the pool.");
  const size = data.readUInt32BE(4);
  if (8 + size > data.byteLength) throw new Error("A picture of the pool is cut short.");
  const head: unknown = JSON.parse(data.toString("utf8", 8, 8 + size));
  return { head, bytes: data.subarray(8 + size) };
}
