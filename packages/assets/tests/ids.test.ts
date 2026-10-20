// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { decodeUlidTime, encodeUlid, newAssetId, type IdSource } from "../src/ids";
import { ASSET_ID_RE } from "../src/record";
import { systemIdSource } from "../src/system";

describe("new asset IDs", () => {
  test("the time part matches the ULID spec", () => {
    const id = encodeUlid(1469918176385, new Uint8Array(10));
    expect(id).toBe("01ARYZ6S410000000000000000");
    expect(decodeUlidTime(id)).toBe(1469918176385);
  });

  test("the random part encodes 80 bits", () => {
    expect(encodeUlid(0, new Uint8Array(10).fill(255))).toBe("0000000000ZZZZZZZZZZZZZZZZ");
    expect(encodeUlid(0, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]))).toBe("00000000000000000000000001");
  });

  test("the generator uses the injected clock and random source", () => {
    const source: IdSource = { now: () => 1_700_000_000_000, random: (length) => new Uint8Array(length).fill(7) };
    expect(newAssetId(source)).toBe(newAssetId(source));
    expect(decodeUlidTime(newAssetId(source))).toBe(1_700_000_000_000);
    expect(newAssetId(systemIdSource)).toMatch(ASSET_ID_RE);
  });

  test("a bad time or a bad random length is an error", () => {
    expect(() => encodeUlid(-1, new Uint8Array(10))).toThrow();
    expect(() => encodeUlid(2 ** 48, new Uint8Array(10))).toThrow();
    expect(() => encodeUlid(0, new Uint8Array(9))).toThrow();
  });
});
