// SPDX-License-Identifier: Apache-2.0
/**
 * A contact sheet without a browser. The host (`lab_sheet` on an index hit) and `labs sheet --index` put the frames of
 * the index in a grid of RGBA pixels with a time label under each cell, and write it as a PNG. Thus a sheet from the
 * index needs no page, no seek and no render.
 *
 * The module is pure: the caller gives the zlib functions (`inflate`, `deflate`) and the decoder of a WebP or JPEG cell
 * (rasterBun.ts: `Bun.Image`). The PNG code reads only 8-bit RGB or RGBA without interlace (the PNG of `Bun.Image`).
 */

/** An image of 8-bit RGBA pixels, row after row. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A cell of a sheet: its picture and its label (digits, letters a to z, space, `·`, `.`, `-`, `:`). */
export interface SheetCell {
  readonly raster: Raster;
  readonly label: string;
}

export type Zlib = (bytes: Uint8Array) => Uint8Array;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The colours of a sheet: the background of `labs sheet` and the text. */
const BACKGROUND = [0x1b, 0x1f, 0x27, 0xff] as const;
const TEXT = [0xe6, 0xe8, 0xee, 0xff] as const;

// ---------------------------------------------------------------------------------------------
// PNG.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of the PNG chunks (the JavaScript fallback). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array, crc: (bytes: Uint8Array) => number): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

/**
 * Write an RGBA raster as a PNG (filter 0 on each row; `deflate` gives the zlib stream). A caller in Bun gives the
 * native CRC-32 (`Bun.hash.crc32`): the JavaScript CRC of a large sheet takes tens of ms.
 */
export function encodePng(raster: Raster, deflate: Zlib, crc: (bytes: Uint8Array) => number = crc32): Uint8Array {
  const { width, height, data } = raster;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1)
    rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk("IHDR", header, crc),
    chunk("IDAT", deflate(rows), crc),
    chunk("IEND", new Uint8Array(0), crc),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo the filter of one row in place (`prior` is the row above after its own unfilter). */
function unfilter(type: number, row: Uint8Array, prior: Uint8Array | null, bpp: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? (row[index - bpp] ?? 0) : 0;
    const up = prior?.[index] ?? 0;
    const corner = prior !== null && index >= bpp ? (prior[index - bpp] ?? 0) : 0;
    const value = row[index] ?? 0;
    if (type === 1) row[index] = (value + left) & 0xff;
    else if (type === 2) row[index] = (value + up) & 0xff;
    else if (type === 3) row[index] = (value + ((left + up) >> 1)) & 0xff;
    else if (type === 4) row[index] = (value + paeth(left, up, corner)) & 0xff;
  }
}

/** Read an 8-bit RGB or RGBA PNG without interlace into an RGBA raster. */
export function decodePng(bytes: Uint8Array, inflate: Zlib): Raster {
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error("Not a PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6))
        throw new Error("A PNG of this kind is not read.");
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of idat) {
    joined.set(part, offset);
    offset += part.length;
  }
  const raw = inflate(joined);
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prior: Uint8Array | null = null;
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const row = raw.slice(start + 1, start + 1 + stride);
    const filter = raw[start] ?? 0;
    if (filter !== 0) unfilter(filter, row, prior, channels);
    prior = row;
    if (channels === 4) {
      out.set(row, y * width * 4);
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      out[target] = row[x * channels] ?? 0;
      out[target + 1] = row[x * channels + 1] ?? 0;
      out[target + 2] = row[x * channels + 2] ?? 0;
      out[target + 3] = 255;
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------------------------
// The label font: 3 × 5 pixels per glyph, one row of three bits per digit of the number (top row first).

const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7],
  "7": [7, 1, 1, 2, 2],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7],
  a: [2, 5, 7, 5, 5],
  b: [6, 5, 6, 5, 6],
  c: [3, 4, 4, 4, 3],
  d: [6, 5, 5, 5, 6],
  e: [7, 4, 6, 4, 7],
  f: [7, 4, 6, 4, 4],
  g: [3, 4, 5, 5, 3],
  h: [5, 5, 7, 5, 5],
  i: [7, 2, 2, 2, 7],
  j: [1, 1, 1, 5, 2],
  k: [5, 5, 6, 5, 5],
  l: [4, 4, 4, 4, 7],
  m: [5, 7, 7, 5, 5],
  n: [6, 5, 5, 5, 5],
  o: [2, 5, 5, 5, 2],
  p: [6, 5, 6, 4, 4],
  q: [2, 5, 5, 6, 3],
  r: [6, 5, 6, 5, 5],
  s: [3, 4, 2, 1, 6],
  t: [7, 2, 2, 2, 2],
  u: [5, 5, 5, 5, 7],
  v: [5, 5, 5, 5, 2],
  w: [5, 5, 7, 7, 5],
  x: [5, 5, 2, 5, 5],
  y: [5, 5, 2, 2, 2],
  z: [7, 1, 2, 4, 7],
  "·": [0, 0, 2, 0, 0],
  ".": [0, 0, 0, 0, 2],
  "-": [0, 0, 7, 0, 0],
  ":": [0, 2, 0, 2, 0],
  " ": [0, 0, 0, 0, 0],
};

/** The scale of the label font (pixels per font pixel). */
const FONT_SCALE = 2;
/** The height of the label row under a cell. */
export const LABEL_HEIGHT = 5 * FONT_SCALE + 8;

function fillRect(target: Raster, x0: number, y0: number, w: number, h: number, colour: readonly number[]): void {
  for (let y = Math.max(0, y0); y < Math.min(target.height, y0 + h); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(target.width, x0 + w); x += 1)
      target.data.set(colour, (y * target.width + x) * 4);
  }
}

/** Draw a label with the 3 × 5 font. Unknown characters draw as a space. */
export function drawText(target: Raster, text: string, x: number, y: number): void {
  let cursor = x;
  for (const char of text.toLowerCase()) {
    const rows = GLYPHS[char] ?? GLYPHS[" "] ?? [];
    rows.forEach((bits, row) => {
      for (let column = 0; column < 3; column += 1) {
        if ((bits >> (2 - column)) & 1) {
          fillRect(target, cursor + column * FONT_SCALE, y + row * FONT_SCALE, FONT_SCALE, FONT_SCALE, TEXT);
        }
      }
    });
    cursor += 4 * FONT_SCALE;
  }
}

/** Copy a raster into another at a place (no scale; the cells come at their size). */
function blit(target: Raster, source: Raster, x: number, y: number): void {
  for (let row = 0; row < source.height; row += 1) {
    const ty = y + row;
    if (ty < 0 || ty >= target.height) continue;
    const width = Math.min(source.width, target.width - x);
    if (width <= 0) continue;
    target.data.set(
      source.data.subarray(row * source.width * 4, (row * source.width + width) * 4),
      (ty * target.width + x) * 4,
    );
  }
}

/** The gap between the cells (px), as `labs sheet`. */
export const SHEET_GAP = 4;

/** Put the cells (all of one size) in a grid of `columns` with a label under each cell. */
export function composeSheet(cells: readonly SheetCell[], columns: number): Raster {
  const first = cells[0];
  if (first === undefined) throw new Error("A sheet needs a cell.");
  const cols = Math.max(1, Math.min(columns, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const { width: cellWidth, height: cellHeight } = first.raster;
  const width = cols * (cellWidth + SHEET_GAP) + SHEET_GAP;
  const height = rows * (cellHeight + LABEL_HEIGHT + SHEET_GAP) + SHEET_GAP;
  const sheet: Raster = { width, height, data: new Uint8Array(width * height * 4) };
  // One 32-bit word per pixel: a fill of the whole sheet in one call.
  new Uint32Array(sheet.data.buffer).fill(new Uint32Array(new Uint8Array(BACKGROUND).buffer)[0] ?? 0);
  cells.forEach((cell, index) => {
    const x = SHEET_GAP + (index % cols) * (cellWidth + SHEET_GAP);
    const y = SHEET_GAP + Math.floor(index / cols) * (cellHeight + LABEL_HEIGHT + SHEET_GAP);
    blit(sheet, cell.raster, x, y);
    drawText(sheet, cell.label, x + 2, y + cellHeight + 4);
  });
  return sheet;
}
