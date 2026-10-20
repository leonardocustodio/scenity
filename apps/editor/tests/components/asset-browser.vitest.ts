// SPDX-License-Identifier: Apache-2.0
// The asset browser: the tiles with stills (the icon of the kind when the still is missing or does not load), the
// search, and the kind and tag filters. Also the "used by" lines of the open scene and of the other documents, the drag
// payload `asset:<id>`, and the import by the button and by a drop. The source is a fake.
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AssetBrowser from "../../src/assetBrowser/AssetBrowser.vue";
import { filterAssets, useLines } from "../../src/assetBrowser/assetFilter";
import type { AssetSource } from "../../src/assetBrowser/assetClient";
import { ASSET_DRAG_TYPE, type AssetList, type AssetListEntry } from "../../src/assetBrowser/assetTypes";

function asset(id: string, kind: string, tags: string[], still: string | null, extra: Partial<AssetListEntry> = {}) {
  return {
    id,
    kind,
    name: id.toLowerCase(),
    tags,
    source: `assets/sources/${id}.gltf`,
    record: `assets/sources/${id}.gltf.meta.json`,
    still,
    stats: { bytes: 2048, triangles: kind === "model" ? 120 : null, lods: 0 },
    usedBy: [],
    problems: [],
    ...extra,
  } satisfies AssetListEntry;
}

const CHAIR = asset("CHAIR00001", "model", ["furniture"], "stills/CHAIR00001.webp", {
  usedBy: [
    { document: "scenes/main.scene.json", entity: "chair", pointer: "/entities/chair/components/model/asset" },
    { document: "scenes/crowd.scene.json", entity: "seat-2", pointer: "/entities/seat-2/components/model/asset" },
  ],
});
const LAMP = asset("LAMP000001", "model", ["light", "furniture"], null);
const SKY = asset("SKY0000001", "environment", ["studio"], "stills/SKY0000001.webp");

const SCENE = {
  entities: {
    chair: { name: "Chair", components: { model: { asset: "asset:CHAIR00001" } } },
    floor: { components: { shape: { kind: "box" } } },
  },
};

function fakeSource(importable = true) {
  const assets: AssetListEntry[] = [CHAIR, LAMP, SKY];
  const importFile = vi.fn((file: File) => {
    const added = asset("NEW0000001", "texture", ["imported"], `assets/sources/${file.name}`);
    assets.push(added);
    return Promise.resolve({ ok: true as const, asset: added, warnings: [] });
  });
  const source: AssetSource = {
    // An absolute URL: happy-dom fails immediately on a relative image URL (no page URL).
    base: "http://127.0.0.1:5176/projects/test/",
    list: () =>
      Promise.resolve<AssetList>({
        assets: [...assets],
        importable,
        reason: importable ? null : "no asset root",
        extensions: [".png", ".glb"],
      }),
    importFile,
  };
  return { source, importFile };
}

async function browser(importable = true) {
  const fake = fakeSource(importable);
  const selectEntity = vi.fn();
  const wrapper = mount(AssetBrowser, {
    props: {
      source: fake.source,
      openScene: () => ({ path: "scenes/main.scene.json", scene: SCENE }),
      selectEntity,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, ...fake, selectEntity };
}

const tileIds = (wrapper: Awaited<ReturnType<typeof browser>>["wrapper"]) =>
  wrapper.findAll("[data-testid^='asset-tile-']").map((tile) => tile.attributes("data-testid"));

describe("the asset browser", () => {
  it("shows a tile for each asset: the still, else the icon of the kind", async () => {
    const { wrapper } = await browser();
    expect(tileIds(wrapper)).toEqual(["asset-tile-CHAIR00001", "asset-tile-LAMP000001", "asset-tile-SKY0000001"]);
    const chair = wrapper.get("[data-testid='asset-tile-CHAIR00001']");
    expect(chair.get("img").attributes("src")).toBe("http://127.0.0.1:5176/projects/test/stills/CHAIR00001.webp");
    expect(wrapper.get("[data-testid='asset-tile-LAMP000001']").find("[data-testid='asset-kind-icon']").exists()).toBe(
      true,
    );
    await wrapper.get("[data-testid='asset-tile-SKY0000001'] img").trigger("error");
    expect(wrapper.get("[data-testid='asset-tile-SKY0000001']").attributes("data-still")).toBe("0");
    wrapper.unmount();
  });

  it("filters by the search, the kinds and the tags", async () => {
    const { wrapper } = await browser();
    await wrapper.get("[data-testid='asset-search']").setValue("lamp");
    expect(tileIds(wrapper)).toEqual(["asset-tile-LAMP000001"]);
    await wrapper.get("[data-testid='asset-search']").setValue("");
    await wrapper.get("[data-testid='asset-kind-environment']").trigger("click");
    expect(tileIds(wrapper)).toEqual(["asset-tile-SKY0000001"]);
    await wrapper.get("[data-testid='asset-kind-environment']").trigger("click");
    await wrapper.get("[data-testid='asset-tag-furniture']").trigger("click");
    expect(tileIds(wrapper)).toEqual(["asset-tile-CHAIR00001", "asset-tile-LAMP000001"]);
    expect(wrapper.get("[data-testid='asset-shown']").text()).toContain("2 of 3");
    wrapper.unmount();
  });

  it("lists the users of the selected asset: the open scene first, then the other documents", async () => {
    const { wrapper, selectEntity } = await browser();
    await wrapper.get("[data-testid='asset-tile-CHAIR00001']").trigger("click");
    const lines = wrapper.findAll("[data-testid='asset-used-by'] li");
    expect(lines.map((line) => line.attributes("data-where"))).toEqual(["scene", "document"]);
    expect(lines[0]?.text()).toBe("Chair (chair)");
    expect(lines[1]?.text()).toBe("scenes/crowd.scene.json · seat-2");
    await lines[0]?.get("button").trigger("click");
    expect(selectEntity).toHaveBeenCalledWith("chair");
    await wrapper.get("[data-testid='asset-tile-LAMP000001']").trigger("click");
    expect(wrapper.get("[data-testid='asset-used-by']").text()).toContain("Nothing uses this asset.");
    wrapper.unmount();
  });

  it("puts asset:<id> on the drag of a tile", async () => {
    const { wrapper } = await browser();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), effectAllowed: "" };
    await wrapper.get("[data-testid='asset-tile-LAMP000001']").trigger("dragstart", { dataTransfer });
    expect(data.get(ASSET_DRAG_TYPE)).toBe("asset:LAMP000001");
    expect(data.get("text/plain")).toBe("asset:LAMP000001");
    wrapper.unmount();
  });

  it("imports a dropped file, reads the list again and selects the new asset", async () => {
    const { wrapper, importFile } = await browser();
    const file = new File([new Uint8Array([1, 2, 3])], "chequer.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "" };
    await wrapper.get("[data-testid='asset-browser']").trigger("dragover", { dataTransfer });
    expect(wrapper.get("[data-testid='asset-browser']").attributes("data-dropping")).toBe("1");
    await wrapper.get("[data-testid='asset-browser']").trigger("drop", { dataTransfer });
    await flushPromises();
    expect(importFile).toHaveBeenCalledWith(file, {});
    expect(tileIds(wrapper)).toContain("asset-tile-NEW0000001");
    expect(wrapper.get("[data-testid='asset-tile-NEW0000001']").attributes("aria-pressed")).toBe("true");
    expect(wrapper.get("[data-testid='asset-status']").text()).toContain("Imported chequer.png");
    wrapper.unmount();
  });

  it("does not import the drop of a tile and turns the button off when the project cannot import", async () => {
    const { wrapper, importFile } = await browser(false);
    const dataTransfer = { types: ["Files", ASSET_DRAG_TYPE], files: [] };
    await wrapper.get("[data-testid='asset-browser']").trigger("drop", { dataTransfer });
    expect(importFile).not.toHaveBeenCalled();
    const button = wrapper.get("[data-testid='asset-import']");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("no asset root");
    wrapper.unmount();
  });
});

describe("the reads of the browser", () => {
  it("needs each word of the query", () => {
    const found = filterAssets([CHAIR, LAMP, SKY], { query: "model light", kinds: new Set(), tags: new Set() });
    expect(found.map((item) => item.id)).toEqual(["LAMP000001"]);
  });

  it("takes the open scene from the editor and the other documents from the database", () => {
    const lines = useLines(CHAIR, { path: "scenes/crowd.scene.json", scene: { entities: {} } });
    // A line of another document names its path, so a click opens that scene.
    expect(lines).toEqual([
      { where: "document", text: "scenes/main.scene.json · chair", document: "scenes/main.scene.json" },
    ]);
  });
});

describe("the prefab assets of the asset browser", () => {
  it("offers Open prefab for a prefab file and gives its source path", async () => {
    const stool = asset("STOOL00001", "prefab", [], null, {
      source: "prefabs/stool.prefab.json",
      record: "prefabs/stool.prefab.json.meta.json",
    });
    const source: AssetSource = {
      base: "http://127.0.0.1:5176/projects/test/",
      list: () =>
        Promise.resolve<AssetList>({ assets: [CHAIR, stool], importable: false, reason: null, extensions: [] }),
      importFile: () => Promise.reject(new Error("no import")),
    };
    const openPrefab = vi.fn();
    const wrapper = mount(AssetBrowser, { props: { source, openPrefab }, attachTo: document.body });
    await flushPromises();
    await wrapper.get("[data-testid='asset-tile-CHAIR00001']").trigger("click");
    expect(wrapper.find("[data-testid='asset-open-prefab']").exists()).toBe(false);
    await wrapper.get("[data-testid='asset-tile-STOOL00001']").trigger("click");
    await wrapper.get("[data-testid='asset-open-prefab']").trigger("click");
    expect(openPrefab).toHaveBeenCalledWith("prefabs/stool.prefab.json");
    wrapper.unmount();
  });
});
