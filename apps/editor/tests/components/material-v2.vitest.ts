// SPDX-License-Identifier: Apache-2.0
// The material editor v2. A preset sets the values that the type of the material takes in one step. A type change keeps
// the values that the new type takes. A texture slot shows the picture of its texture and takes a texture asset that
// drops on it.
import { setMaterialType } from "@scenity/editor-core";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ASSET_DRAG_TYPE, ASSET_KIND_DRAG_TYPE } from "../../src/assetBrowser/assetTypes";
import { MATERIAL_PRESETS, withMaterialPreset } from "../../src/scene/material/materialPresets";
import TextureSlot from "../../src/scene/material/TextureSlot.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

const preset = (id: string) => {
  const found = MATERIAL_PRESETS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no preset ${id}`);
  return found;
};

describe("the material presets and the type change", () => {
  it("set the values that the type takes, and keep the name and the maps", () => {
    const standard = {
      format: "scenity.material/1",
      type: "standard",
      name: "Window",
      maps: { colour: { texture: "asset:chequer" } },
    } as MaterialDocument;
    const glass = withMaterialPreset(standard, preset("glass"));
    expect(glass).toMatchObject({ name: "Window", colour: "#e8f2f8", roughness: 0.05, metalness: 0 });
    // A standard material takes no transmission; a physical one does.
    expect((glass as Record<string, unknown>).transmission).toBeUndefined();
    expect(glass.maps).toEqual(standard.maps);
    const physical = withMaterialPreset(setMaterialType(standard, "physical"), preset("glass"));
    expect(physical).toMatchObject({ type: "physical", transmission: 1, ior: 1.5 });
    // A type change keeps the values that the new type takes and drops the others.
    const lambert = setMaterialType(physical, "lambert");
    expect(lambert).toMatchObject({ colour: "#e8f2f8", name: "Window" });
    expect((lambert as Record<string, unknown>).transmission).toBeUndefined();
  });
});

describe("a texture slot", () => {
  it("shows the picture of its texture and takes a texture that drops on it", async () => {
    const slot = mount(TextureSlot, {
      props: {
        name: "colour",
        map: { texture: "asset:chequer" },
        textures: [{ id: "chequer", path: "assets/sources/chequer.png", kind: "texture" }],
        stills: new Map([["chequer", "/stills/chequer.webp"]]),
      },
      attachTo: document.body,
    });
    expect(slot.find('[data-testid="material-slot-colour-picture"]').attributes("src")).toBe("/stills/chequer.webp");
    const select = slot.find('[data-testid="material-slot-colour-texture"]');
    // A drag event of a test: the data of the drag as the browser gives it.
    const drop = async (ref: string, kind: string): Promise<void> => {
      const data: Record<string, string> = { [ASSET_DRAG_TYPE]: ref, [ASSET_KIND_DRAG_TYPE]: kind };
      const dataTransfer = { types: Object.keys(data), getData: (type: string) => data[type] ?? "" };
      await select.trigger("drop", { dataTransfer });
    };
    await drop("asset:bricks", "texture");
    await drop("asset:chair", "model");
    expect(slot.emitted("texture")).toEqual([["asset:bricks"]]);
  });
});
