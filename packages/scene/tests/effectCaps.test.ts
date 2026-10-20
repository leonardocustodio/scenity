// SPDX-License-Identifier: Apache-2.0
// The post-processing values of the `environment` component and their tier caps. The schema takes the effect fields,
// and each tier caps the effects. An anti-aliasing mode above the cap falls to the best mode of the tier. The effects
// sample of the showroom reads with each effect on.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../src/canonical";
import { builtinRegistry } from "../src/components/index";
import { activeEffects, EFFECT_CAPS, EFFECT_DEFAULTS, frameEffects, type EffectsValue } from "../src/effectCaps";
import { readDocument } from "../src/read";

const ALL: EffectsValue = {
  ao: { radius: 0.4, intensity: 0.8 },
  bloom: { threshold: 0.7, strength: 0.5, radius: 0.3 },
  antialias: "smaa",
  outline: { colour: "#00ff00", thickness: 2 },
};

describe("the effect fields of the environment component", () => {
  const registry = builtinRegistry();

  it("takes each effect value and refuses a bad one", () => {
    expect(registry.check("environment", ALL).ok).toBe(true);
    expect(registry.check("environment", { antialias: "taa" }).ok).toBe(false);
    expect(registry.check("environment", { ao: { radius: 0 } }).ok).toBe(false);
    expect(registry.check("environment", { bloom: { radius: 2 } }).ok).toBe(false);
    expect(registry.check("environment", { outline: { thickness: 20 } }).ok).toBe(false);
  });

  it("reads the effects sample of the showroom in the form of the canonical writer", () => {
    const path = new URL("../../../samples/showroom/scenes/effects.scene.json", import.meta.url);
    const text = readFileSync(path, "utf8");
    const result = readDocument(text, "scene");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(canonicalJson(result.doc)).toBe(text);
    const effects = frameEffects(result.doc.environment, "ultra");
    expect(activeEffects(effects, true)).toEqual(["ao", "bloom", "outline", "smaa"]);
  });
});

describe("the tier caps of the effects", () => {
  it("draws no effect for a scene with no effect value", () => {
    for (const tier of ["low", "medium", "high", "ultra"] as const) {
      expect(activeEffects(frameEffects(undefined, tier), false)).toEqual([]);
      expect(activeEffects(frameEffects({}, tier), false)).toEqual([]);
    }
  });

  it("caps the effects of each tier", () => {
    expect(activeEffects(frameEffects(ALL, "low"), true)).toEqual(["outline"]);
    expect(activeEffects(frameEffects(ALL, "medium"), true)).toEqual(["outline", "fxaa"]);
    expect(activeEffects(frameEffects(ALL, "high"), true)).toEqual(["bloom", "outline", "fxaa"]);
    expect(activeEffects(frameEffects(ALL, "ultra"), true)).toEqual(["ao", "bloom", "outline", "smaa"]);
    expect(activeEffects(frameEffects(ALL, "ultra"), false)).toEqual(["ao", "bloom", "smaa"]);
  });

  it("gives the best anti-aliasing mode of the tier for a mode above the cap", () => {
    expect(frameEffects({ antialias: "msaa" }, "high").antialias).toBe("fxaa");
    expect(frameEffects({ antialias: "msaa" }, "ultra").antialias).toBe("msaa");
    expect(frameEffects({ antialias: "fxaa" }, "low").antialias).toBe("none");
    for (const cap of Object.values(EFFECT_CAPS)) expect(cap.antialias[0]).toBe("none");
  });

  it("fills the defaults, and `on: false` turns an effect off", () => {
    const effects = frameEffects({ ao: {}, bloom: { on: false }, outline: { on: false } }, "ultra");
    expect(effects.ao).toEqual(EFFECT_DEFAULTS.ao);
    expect(effects.bloom).toBeNull();
    expect(effects.outline).toBeNull();
    expect(frameEffects(undefined, "low").outline).toEqual(EFFECT_DEFAULTS.outline);
  });
});
