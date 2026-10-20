// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { absoluteAssets } from "../src/client";
import type { ManifestRef } from "../src/protocol";

const ORIGIN = "https://lab.example";
const saved = Object.getOwnPropertyDescriptor(globalThis, "location");

beforeAll(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL(`${ORIGIN}/`),
  });
});

afterAll(() => {
  if (saved === undefined) delete (globalThis as { location?: unknown }).location;
  else Object.defineProperty(globalThis, "location", saved);
});

const ref = (files: Record<string, string>): ManifestRef => ({
  manifest: "/assets/manifest-abc.json",
  tier: "high",
  files,
  decoders: { basisWasm: "/assets/basis.wasm" },
});

describe("absoluteAssets (render worker URLs)", () => {
  it("makes the manifest, every file and the transcoder absolute", () => {
    const result = absoluteAssets(
      ref({ "char_a.high.glb": "/assets/char_a.high-x.glb", "poster.webp": "poster.webp" }),
    );
    expect(result).toEqual({
      manifest: `${ORIGIN}/assets/manifest-abc.json`,
      tier: "high",
      files: {
        "char_a.high.glb": `${ORIGIN}/assets/char_a.high-x.glb`,
        "poster.webp": `${ORIGIN}/poster.webp`,
      },
      decoders: { basisWasm: `${ORIGIN}/assets/basis.wasm` },
    });
  });

  it("gives null without assets", () => {
    expect(absoluteAssets(null)).toBeNull();
    expect(absoluteAssets(undefined)).toBeNull();
  });

  it("refuses a file from another origin", () => {
    expect(() => absoluteAssets(ref({ "prop_table.high.glb": "https://other.example/x.glb" }))).toThrow();
    expect(() => absoluteAssets({ ...ref({}), manifest: "https://other.example/manifest.json" })).toThrow();
  });
});
