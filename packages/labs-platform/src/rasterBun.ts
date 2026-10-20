// SPDX-License-Identifier: Apache-2.0
/**
 * The cells of a sheet from the index in Bun. `Bun.Image` decodes a WebP or JPEG frame of the index outside the
 * JavaScript thread. It scales the frame to the cell width and gives a PNG with no compression. sheetRaster.ts reads
 * that PNG into RGBA pixels. The host, the `labs` tools and the CLI use this module. A browser page never imports it.
 * The zlib streams of the PNG come from the raw DEFLATE of Bun (`Bun.deflateSync`, `Bun.inflateSync`) with the zlib
 * header and the Adler-32 sum made here, so the module needs no `node:` import.
 */
import { composeSheet, crc32, decodePng, encodePng, type Raster } from "./sheetRaster";

/** The part of `Bun.Image` that this module uses (Bun 1.4). */
interface BunImage {
  resize(width: number, height?: number, options?: { fit?: "fill" | "inside" }): BunImage;
  png(options?: { compressionLevel?: number }): BunImage;
  jpeg(options?: { quality?: number }): BunImage;
  bytes(): Promise<Uint8Array>;
}

/** The picture types of a sheet: PNG (as `labs sheet`) or JPEG (small and fast, for a tool answer). */
export type SheetFormat = "png" | "jpeg";

function bunCrc(bytes: Uint8Array): number {
  const hash = (globalThis as { Bun?: { hash?: { crc32?: (data: Uint8Array) => number } } }).Bun?.hash?.crc32;
  return hash === undefined ? crc32(bytes) : hash(bytes);
}

/** A BMP of 32-bit pixels (top row first): the input of the JPEG encoder of `Bun.Image`. */
function bmpOf(raster: Raster): Uint8Array {
  const { width, height, data } = raster;
  const header = 54;
  const out = new Uint8Array(header + width * height * 4);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, out.length, true);
  view.setUint32(10, header, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  for (let index = 0; index < width * height; index += 1) {
    const from = index * 4;
    const to = header + from;
    out[to] = data[from + 2] ?? 0;
    out[to + 1] = data[from + 1] ?? 0;
    out[to + 2] = data[from] ?? 0;
    out[to + 3] = 255;
  }
  return out;
}

/** Encode a raster as PNG or JPEG. */
export async function encodeRaster(raster: Raster, format: SheetFormat): Promise<Uint8Array> {
  if (format === "png") return encodePng(raster, deflate, bunCrc);
  const Image = imageClass();
  return new Image(bmpOf(raster)).jpeg({ quality: 85 }).bytes();
}

type BunImageClass = new (input: Uint8Array) => BunImage;

function imageClass(): BunImageClass {
  const image = (globalThis as { Bun?: { Image?: unknown } }).Bun?.Image;
  if (typeof image !== "function") throw new Error("A sheet from the index needs Bun 1.4 (Bun.Image).");
  return image as BunImageClass;
}

/** The raw DEFLATE functions of Bun. */
interface BunDeflate {
  deflateSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
  inflateSync(data: Uint8Array): Uint8Array;
}

function bunDeflate(): BunDeflate {
  const bun = (globalThis as { Bun?: Partial<BunDeflate> }).Bun;
  if (typeof bun?.deflateSync !== "function" || typeof bun.inflateSync !== "function") {
    throw new Error("A sheet from the index needs Bun (Bun.deflateSync).");
  }
  return bun as BunDeflate;
}

/** The Adler-32 sum of a zlib stream. */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length;) {
    const end = Math.min(index + 5552, bytes.length);
    for (; index < end; index += 1) {
      a += bytes[index] ?? 0;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Inflate a zlib stream (its two header bytes and its four sum bytes stay out). */
export const inflate = (bytes: Uint8Array): Uint8Array => bunDeflate().inflateSync(bytes.subarray(2, bytes.length - 4));

/** A zlib stream of the fastest level: the header 0x78 0x01, the raw DEFLATE of Bun and the Adler-32 sum. */
export function deflate(bytes: Uint8Array): Uint8Array {
  const raw = bunDeflate().deflateSync(bytes, { level: 1 });
  const out = new Uint8Array(raw.length + 6);
  out.set([0x78, 0x01]);
  out.set(raw, 2);
  new DataView(out.buffer).setUint32(raw.length + 2, adler32(bytes));
  return out;
}

/** Decode a picture (WebP, JPEG or PNG) at `width` × `height` px into RGBA pixels. */
export async function decodeCell(bytes: Uint8Array, width: number, height: number): Promise<Raster> {
  const Image = imageClass();
  const png = await new Image(bytes.slice()).resize(width, height).png({ compressionLevel: 0 }).bytes();
  return decodePng(png, inflate);
}

/** A sheet of pictures: each picture at `cellWidth` (its height from its aspect), with its label. */
export async function sheetPicture(
  cells: readonly { readonly bytes: Uint8Array; readonly label: string; readonly aspect: number }[],
  columns: number,
  cellWidth: number,
  format: SheetFormat = "png",
): Promise<{ readonly bytes: Uint8Array; readonly mime: string; readonly width: number; readonly height: number }> {
  const first = cells[0];
  if (first === undefined) throw new Error("A sheet needs a cell.");
  const cellHeight = Math.max(1, Math.round(cellWidth / first.aspect));
  const rasters = await Promise.all(cells.map((cell) => decodeCell(cell.bytes, cellWidth, cellHeight)));
  const sheet = composeSheet(
    rasters.map((raster, index) => ({ raster, label: cells[index]?.label ?? "" })),
    columns,
  );
  const bytes = await encodeRaster(sheet, format);
  return { bytes, mime: format === "png" ? "image/png" : "image/jpeg", width: sheet.width, height: sheet.height };
}
