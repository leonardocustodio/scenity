// SPDX-License-Identifier: Apache-2.0
// The lighting presets of the Lighting window. A preset replaces the look of the scene and keeps its environment map,
// its anti-aliasing and its outline. The active preset is the preset that the values of the scene match.
import { describe, expect, it } from "vitest";
import { activePreset, LIGHTING_PRESETS, withPreset } from "../../src/scene/lighting/lightingPresets";

describe("the lighting presets", () => {
  it("keep the map, the anti-aliasing and the outline, and take the other values away", () => {
    const evening = LIGHTING_PRESETS.find((preset) => preset.id === "evening");
    const studio = LIGHTING_PRESETS.find((preset) => preset.id === "studio");
    if (evening === undefined || studio === undefined) throw new Error("no preset");
    const scene = {
      map: "asset:sky",
      antialias: "fxaa",
      fog: { type: "exp2", colour: "#ffffff", density: 1 },
      exposure: 2,
    } as const;
    const next = withPreset(scene, studio);
    expect(next).toEqual({ map: "asset:sky", antialias: "fxaa", ...studio.values });
    expect(next.fog).toBeUndefined();
    expect(activePreset(next)).toBe("studio");
    expect(activePreset(withPreset(next, evening))).toBe("evening");
    expect(activePreset({ ...next, fog: { type: "exp2", colour: "#000000", density: 0.1 } })).toBeNull();
    expect(activePreset(undefined)).toBeNull();
    expect(new Set(LIGHTING_PRESETS.map((preset) => preset.id)).size).toBe(LIGHTING_PRESETS.length);
  });
});
