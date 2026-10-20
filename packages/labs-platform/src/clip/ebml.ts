// SPDX-License-Identifier: Apache-2.0
/**
 * EBML, the binary format of WebM: a writer for the muxer (webm.ts) and a reader for the tests and the checks of a
 * clip. No dependency. RFC 8794 defines the format: each element is an ID, a size as a variable-length integer and
 * the data.
 */

/** An element to write: an ID (with its length marker, as the specification writes it) and the data. */
export type EbmlValue = number | bigint | string | Uint8Array | readonly EbmlElement[] | { readonly float: number };

export interface EbmlElement {
  readonly id: number;
  readonly value: EbmlValue;
  /** The fixed width of an unsigned integer value in bytes (the SeekHead positions), or none: the shortest width. */
  readonly width?: number;
}

/** The bytes of an element ID: the ID already holds its length marker. */
export function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  let rest = id;
  while (rest > 0) {
    out.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.from(out);
}

/** A size as a variable-length integer of the shortest width (at most 8 bytes). */
export function sizeBytes(size: number): Uint8Array {
  for (let width = 1; width <= 8; width += 1) {
    // All bits one is the reserved "unknown size": the size must be under it.
    if (size < 2 ** (7 * width) - 1) {
      const out = new Uint8Array(width);
      let rest = size;
      for (let at = width - 1; at >= 0; at -= 1) {
        out[at] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] = (out[0] ?? 0) | (0x80 >> (width - 1));
      return out;
    }
  }
  throw new Error("An EBML element is too large.");
}

/** An unsigned integer, big-endian, in the shortest width or in `width` bytes. */
export function uintBytes(value: number | bigint, width?: number): Uint8Array {
  let rest = BigInt(value);
  if (rest < 0n) throw new Error("An EBML unsigned integer is below 0.");
  const out: number[] = [];
  while (rest > 0n || out.length === 0) {
    out.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  if (width !== undefined) {
    if (out.length > width) throw new Error("An EBML unsigned integer is too large for its width.");
    while (out.length < width) out.unshift(0);
  }
  return Uint8Array.from(out);
}

function floatBytes(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

/** Join byte arrays into one. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function dataOf(element: EbmlElement): Uint8Array {
  const { value } = element;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (typeof value === "number" || typeof value === "bigint") return uintBytes(value, element.width);
  if ("float" in value) return floatBytes(value.float);
  return concat(value.map(encodeElement));
}

/** The bytes of one element with its children. */
export function encodeElement(element: EbmlElement): Uint8Array {
  const data = dataOf(element);
  return concat([idBytes(element.id), sizeBytes(data.length), data]);
}

/** An element that the reader found: its ID, and where its data starts and ends in the bytes. */
export interface EbmlNode {
  readonly id: number;
  /** The offset of the first byte of the element (its ID). */
  readonly start: number;
  readonly dataStart: number;
  readonly dataEnd: number;
}

/** The length of a variable-length integer from its first byte, or 0 for a byte without a marker. */
function vintLength(first: number): number {
  for (let width = 1; width <= 8; width += 1) if ((first & (0x80 >> (width - 1))) !== 0) return width;
  return 0;
}

/** Read the elements of one level from `start` to `end`. */
export function readElements(bytes: Uint8Array, start = 0, end = bytes.length): EbmlNode[] {
  const nodes: EbmlNode[] = [];
  let at = start;
  while (at < end) {
    const first = bytes[at] ?? 0;
    const idLength = vintLength(first);
    if (idLength === 0 || idLength > 4) throw new Error(`EBML: a bad element ID at ${String(at)}.`);
    let id = 0;
    for (let i = 0; i < idLength; i += 1) id = id * 256 + (bytes[at + i] ?? 0);
    const sizeAt = at + idLength;
    const sizeLength = vintLength(bytes[sizeAt] ?? 0);
    if (sizeLength === 0) throw new Error(`EBML: a bad element size at ${String(sizeAt)}.`);
    let size = (bytes[sizeAt] ?? 0) & (0xff >> sizeLength);
    for (let i = 1; i < sizeLength; i += 1) size = size * 256 + (bytes[sizeAt + i] ?? 0);
    const dataStart = sizeAt + sizeLength;
    const dataEnd = dataStart + size;
    if (dataEnd > end) throw new Error(`EBML: the element ${id.toString(16)} goes past its parent.`);
    nodes.push({ id, start: at, dataStart, dataEnd });
    at = dataEnd;
  }
  return nodes;
}

/** The children of an element. */
export function childrenOf(bytes: Uint8Array, node: EbmlNode): EbmlNode[] {
  return readElements(bytes, node.dataStart, node.dataEnd);
}

/** The first child of an element with an ID, or undefined. */
export function childOf(bytes: Uint8Array, node: EbmlNode, id: number): EbmlNode | undefined {
  return childrenOf(bytes, node).find((child) => child.id === id);
}

/** The unsigned integer value of an element. */
export function readUint(bytes: Uint8Array, node: EbmlNode): number {
  let value = 0;
  for (let at = node.dataStart; at < node.dataEnd; at += 1) value = value * 256 + (bytes[at] ?? 0);
  return value;
}

/** The float value of an element (4 or 8 bytes). */
export function readFloat(bytes: Uint8Array, node: EbmlNode): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + node.dataStart, node.dataEnd - node.dataStart);
  return node.dataEnd - node.dataStart === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

/** The text value of an element. */
export function readString(bytes: Uint8Array, node: EbmlNode): string {
  return new TextDecoder().decode(bytes.subarray(node.dataStart, node.dataEnd));
}
