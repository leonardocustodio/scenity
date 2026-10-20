// SPDX-License-Identifier: Apache-2.0
/**
 * The header read of a texture file: the format, the MIME type and the size in px of a PNG, JPEG, WebP, AVIF
 * or Radiance HDR file. The functions read only the header; they decode no pixels.
 */

export type TextureFormat = "png" | "jpeg" | "webp" | "avif" | "hdr";

export interface TextureInfo {
  readonly format: TextureFormat;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

const MIME: Readonly<Record<TextureFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  hdr: "image/vnd.radiance",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function info(format: TextureFormat, width: number, height: number): TextureInfo | null {
  return width > 0 && height > 0 ? { format, mimeType: MIME[format], width, height } : null;
}

function readPng(bytes: Uint8Array): TextureInfo | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return info("png", view(bytes).getUint32(16), view(bytes).getUint32(20));
}

/** The SOF markers of JPEG: C0 to CF, except C4 (DHT), C8 (JPG) and CC (DAC). */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(bytes: Uint8Array): TextureInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const data = view(bytes);
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (isFrameMarker(marker)) return info("jpeg", data.getUint16(at + 7), data.getUint16(at + 5));
    at += 2 + data.getUint16(at + 2);
  }
  return null;
}

function readWebp(bytes: Uint8Array): TextureInfo | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const data = view(bytes);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") return info("webp", data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
  if (chunk === "VP8L") {
    const bits = data.getUint32(21, true);
    return info("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    const u24 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
    return info("webp", u24(24) + 1, u24(27) + 1);
  }
  return null;
}

/** The boxes of an ISO BMFF range: [type, start of the content, end]. */
function boxes(bytes: Uint8Array, start: number, end: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  const data = view(bytes);
  let at = start;
  while (at + 8 <= end) {
    let size = data.getUint32(at);
    let header = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(data.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push([ascii(bytes, at + 4, 4), at + header, at + size]);
    at += size;
  }
  return out;
}

function child(bytes: Uint8Array, range: [number, number], type: string, skip = 0): [number, number] | null {
  const found = boxes(bytes, range[0] + skip, range[1]).find(([name]) => name === type);
  return found === undefined ? null : [found[1], found[2]];
}

function readAvif(bytes: Uint8Array): TextureInfo | null {
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = top[0];
  if (ftyp?.[0] !== "ftyp") return null;
  const brands = ascii(bytes, ftyp[1], ftyp[2] - ftyp[1]);
  if (!brands.includes("avif") && !brands.includes("avis")) return null;
  const meta = top.find(([name]) => name === "meta");
  if (meta === undefined) return null;
  // The meta box is a full box: 4 bytes of version and flags come before its children.
  const iprp = child(bytes, [meta[1], meta[2]], "iprp", 4);
  const ipco = iprp === null ? null : child(bytes, iprp, "ipco");
  const ispe = ipco === null ? null : child(bytes, ipco, "ispe");
  if (ispe === null || ispe[1] - ispe[0] < 12) return null;
  return info("avif", view(bytes).getUint32(ispe[0] + 4), view(bytes).getUint32(ispe[0] + 8));
}

function readHdr(bytes: Uint8Array): TextureInfo | null {
  const head = ascii(bytes, 0, Math.min(bytes.length, 4096));
  if (!head.startsWith("#?RADIANCE") && !head.startsWith("#?RGBE")) return null;
  const lines = head.split("\n");
  const blank = lines.indexOf("");
  const size = blank < 0 ? undefined : lines[blank + 1];
  const match = /^([-+])Y (\d+) ([-+])X (\d+)$/.exec(size?.trim() ?? "");
  return match === null ? null : info("hdr", Number(match[4]), Number(match[2]));
}

const READERS: Readonly<Record<TextureFormat, (bytes: Uint8Array) => TextureInfo | null>> = {
  png: readPng,
  jpeg: readJpeg,
  webp: readWebp,
  avif: readAvif,
  hdr: readHdr,
};

/** The header of a texture file of the given format, or null when the bytes are not a file of that format. */
export function readTextureInfo(bytes: Uint8Array, format: TextureFormat): TextureInfo | null {
  return READERS[format](bytes);
}

/** The header of a texture file of any of the formats, or null when no reader knows the bytes. */
export function sniffTextureInfo(bytes: Uint8Array): TextureInfo | null {
  for (const read of Object.values(READERS)) {
    const found = read(bytes);
    if (found !== null) return found;
  }
  return null;
}
