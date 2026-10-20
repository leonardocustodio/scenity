// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { canonicalJson, formatNumber, roundNumber, writeDocument } from "../src/index";

describe("canonical writer", () => {
  test("sorts the keys in code-unit order, also keys that look like integers", () => {
    expect(canonicalJson({ b: 1, a: 2, "10": 3, "2": 4, B: 5 })).toBe(
      '{\n  "10": 3,\n  "2": 4,\n  "B": 5,\n  "a": 2,\n  "b": 1\n}\n',
    );
  });

  test("uses two spaces, a final newline, and one line for an array of numbers", () => {
    const doc = { format: "scenity.scene/1", list: [{ x: [1, 2, 3] }, "s"], empty: [], none: {} };
    const text = writeDocument(doc);
    expect(text).toBe(
      '{\n  "empty": [],\n  "format": "scenity.scene/1",\n  "list": [\n    {\n      "x": [1, 2, 3]\n    },\n    "s"\n  ],\n  "none": {}\n}\n',
    );
  });

  test("rounds numbers to the 1e-6 grid and writes -0 as 0", () => {
    expect(roundNumber(0.1 + 0.2)).toBe(0.3);
    expect(roundNumber(1.0000004)).toBe(1);
    expect(roundNumber(-0.0000004)).toBe(0);
    expect(Object.is(roundNumber(-0), 0)).toBe(true);
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(0.1234567)).toBe("0.123457");
    expect(formatNumber(22000000)).toBe("22000000");
  });

  test("writes no exponent form in the normal range", () => {
    expect(formatNumber(0.000001)).toBe("0.000001");
    expect(formatNumber(0.0000004)).toBe("0");
    expect(formatNumber(123456789.5)).toBe("123456789.5");
    expect(formatNumber(1e20)).toBe("100000000000000000000");
  });

  test("keeps the array order and leaves out undefined keys", () => {
    expect(canonicalJson({ a: [3, 1, 2], b: undefined })).toBe('{\n  "a": [3, 1, 2]\n}\n');
  });

  test("refuses values that are not JSON", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow("finite");
    expect(() => canonicalJson({ a: () => 1 })).toThrow("/a");
  });

  test("a written value reads back to the same bytes", () => {
    const value = { z: [0.1 + 0.2, -0, 1e-7], s: 'é\n"' };
    const once = canonicalJson(value);
    expect(canonicalJson(JSON.parse(once))).toBe(once);
  });
});
