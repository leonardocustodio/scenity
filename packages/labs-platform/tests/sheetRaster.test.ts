// SPDX-License-Identifier: Apache-2.0
/**
 * A contact sheet without a browser: the PNG writer and reader, the grid and the labels, and a sheet of
 * WebP cells through `Bun.Image`.
 */
import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import { decodeCell, sheetPicture } from "../src/rasterBun";
import { composeSheet, crc32, decodePng, encodePng, LABEL_HEIGHT, SHEET_GAP, type Raster } from "../src/sheetRaster";

const inflate = (bytes: Uint8Array) => new Uint8Array(inflateSync(bytes));
const deflate = (bytes: Uint8Array) => new Uint8Array(deflateSync(bytes));

function solid(width: number, height: number, rgba: readonly number[]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4);
  return { width, height, data };
}

describe("the PNG of a sheet", () => {
  test("a raster comes back equal from its PNG", () => {
    const raster = solid(5, 3, [10, 20, 30, 255]);
    raster.data.set([200, 100, 50, 255], 4 * 7);
    const back = decodePng(encodePng(raster, deflate), inflate);
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect([...back.data]).toEqual([...raster.data]);
  });

  test("the CRC-32 is the one of zlib", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  test("a PNG of Bun.Image with filters reads the same pixels", async () => {
    const raster = solid(16, 10, [0, 0, 0, 255]);
    for (let x = 0; x < 16; x += 1) raster.data.set([x * 16, 255 - x * 16, 128, 255], (3 * 16 + x) * 4);
    const png = encodePng(raster, deflate);
    const again = await decodeCell(png, 16, 10);
    expect([...again.data]).toEqual([...raster.data]);
  });
});

describe("composeSheet", () => {
  test("puts the cells in a grid with a label row and draws the labels", () => {
    const cells = [0, 1, 2].map((index) => ({ raster: solid(8, 5, [255, index * 100, 0, 255]), label: "250 ms" }));
    const sheet = composeSheet(cells, 2);
    expect(sheet.width).toBe(2 * (8 + SHEET_GAP) + SHEET_GAP);
    expect(sheet.height).toBe(2 * (5 + LABEL_HEIGHT + SHEET_GAP) + SHEET_GAP);
    const at = (x: number, y: number) => [
      ...sheet.data.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4),
    ];
    expect(at(SHEET_GAP, SHEET_GAP)).toEqual([255, 0, 0, 255]);
    expect(at(SHEET_GAP * 2 + 8, SHEET_GAP)).toEqual([255, 100, 0, 255]);
    const label = sheet.data.subarray((SHEET_GAP + 5 + 4) * sheet.width * 4, (SHEET_GAP + 5 + 14) * sheet.width * 4);
    expect(label.some((value, index) => index % 4 === 0 && value > 200)).toBe(true);
  });
});

describe("sheetPicture", () => {
  test("a sheet of WebP cells as PNG and as JPEG", async () => {
    const cell = encodePng(solid(32, 20, [0, 128, 255, 255]), deflate);
    const webp = await new Bun.Image(cell).webp({ quality: 90 }).bytes();
    const cells = Array.from({ length: 6 }, (_, index) => ({
      bytes: webp,
      label: `${String(index * 100)} ms`,
      aspect: 1.6,
    }));
    const png = await sheetPicture(cells, 3, 64, "png");
    expect(png.mime).toBe("image/png");
    expect([png.width, png.height]).toEqual([3 * 68 + 4, 2 * (40 + LABEL_HEIGHT + 4) + 4]);
    const jpeg = await sheetPicture(cells, 3, 64, "jpeg");
    expect([...jpeg.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});
