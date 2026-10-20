// SPDX-License-Identifier: Apache-2.0
// The asset inspector: the preview of each asset kind of docs/formats.md, the channels of a texture, and the facts of a
// model and of a sound. Also the record fields, and a new import with the settings of the record. The source is a fake.
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AssetInspector from "../../src/assetBrowser/AssetInspector.vue";
import type { AssetSource } from "../../src/assetBrowser/assetClient";
import type { AssetDetails, AssetListEntry } from "../../src/assetBrowser/assetTypes";
import AssetPreview from "../../src/assetBrowser/preview/AssetPreview.vue";
import { channelPixels, factsOf, previewOf, recordFields } from "../../src/assetBrowser/preview/previewKinds";

const BASE = "http://127.0.0.1:5176/projects/test/";

function asset(kind: string, source: string, still: string | null = null): AssetListEntry {
  return {
    id: "ASSET00001",
    kind,
    name: "asset",
    tags: [],
    source,
    record: `${source}.meta.json`,
    still,
    stats: { bytes: 3 * 1024 * 1024, triangles: null, lods: 0 },
    usedBy: [],
    problems: [],
  };
}

/** The asset kinds of docs/formats.md (and a plugin kind) with their preview and the part that shows it. */
const KINDS: readonly (readonly [string, string, string])[] = [
  ["model", "turntable", "asset-preview-canvas"],
  ["skinned-model", "turntable", "asset-preview-canvas"],
  ["animation", "turntable", "asset-preview-canvas"],
  ["texture", "texture", "asset-preview-texture"],
  ["material", "material", "asset-preview-canvas"],
  ["environment", "environment", "asset-preview-canvas"],
  ["scene", "still", "asset-preview-still"],
  ["prefab", "still", "asset-preview-still"],
  ["audio", "audio", "asset-preview-wave"],
  ["acme.level", "still", "asset-preview-still"],
];

const MODEL_DETAILS: AssetDetails = {
  id: "ASSET00001",
  record: {
    importer: "gltf",
    source: "Lamp.glb",
    rights: "../../rights/kenney.yaml",
    tags: ["light"],
    settings: { maxTextureSize: 1024 },
    rig: "mixamo",
  },
  imported: {
    importer: "gltf",
    settings: { maxTextureSize: 1024 },
    warnings: ["a texture is larger than 1024 px"],
    report: { meshes: 3, triangles: 5626, extent: [0.85, 1.07, 0.77], clips: ["Idle", "Walk"], joints: 52 },
    files: [".scenity/imports/ASSET00001/model.glb"],
  },
  built: [
    { tier: "high", file: "ASSET00001.high.glb", triangles: 5626, bytes: 700_532 },
    { tier: "low", file: "ASSET00001.low.glb", triangles: 2813, bytes: 217_460 },
  ],
};

describe("the previews of the asset inspector", () => {
  it.each(KINDS)("gives a %s asset the %s preview", async (kind, preview, part) => {
    expect(previewOf(kind)).toBe(preview);
    const wrapper = mount(AssetPreview, {
      props: { asset: asset(kind, `assets/a.${kind}`, "stills/ASSET00001.webp"), base: BASE, version: 0 },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="asset-preview"]').attributes("data-preview")).toBe(preview);
    expect(wrapper.find(`[data-testid="${part}"]`).exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows the icon of the kind for a source with no project files", () => {
    const wrapper = mount(AssetPreview, { props: { asset: asset("model", "a.glb"), base: null, version: 0 } });
    expect(wrapper.get('[data-testid="asset-preview"]').attributes("data-preview")).toBe("still");
    expect(wrapper.find("canvas").exists()).toBe(false);
  });

  it("splits the channels of a texture", () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(channelPixels(pixels, "rgb")).toBe(pixels);
    expect([...channelPixels(pixels, "g")]).toEqual([20, 20, 20, 255, 60, 60, 60, 255]);
    expect([...channelPixels(pixels, "a")]).toEqual([40, 40, 40, 255, 80, 80, 80, 255]);
  });
});

describe("the facts and the record of the asset inspector", () => {
  it("gives the facts of a model: triangles, meshes, extent, clips, rig and levels of detail", () => {
    const facts = Object.fromEntries(factsOf(asset("model", "a.glb"), MODEL_DETAILS).map((f) => [f.label, f.value]));
    expect(facts).toEqual({
      "asset-fact-size": "3.0 MB",
      "asset-fact-triangles": "5,626",
      "asset-fact-meshes": "3",
      "asset-fact-extent": "0.85 × 1.07 × 0.77 m",
      "asset-fact-clips": "Idle, Walk",
      "asset-fact-rig": "mixamo",
      "asset-fact-lods": "high 5,626 · low 2,813",
    });
  });

  it("gives the facts of a sound and of a texture", () => {
    const sound: AssetDetails = {
      ...MODEL_DETAILS,
      record: {},
      built: [],
      imported: {
        ...MODEL_DETAILS.imported!,
        report: { codec: "pcm", channels: 2, sampleRate: 48_000, duration: 1.5 },
      },
    };
    const labels = factsOf(asset("audio", "a.wav"), sound).map((fact) => `${fact.label}=${fact.value}`);
    expect(labels).toEqual([
      "asset-fact-size=3.0 MB",
      "asset-fact-duration=1.50 s",
      "asset-fact-channels=2 · 48,000 Hz",
      "asset-fact-codec=pcm",
    ]);
    const texture = {
      ...sound,
      imported: { ...sound.imported!, report: { width: 512, height: 256, mimeType: "image/png" } },
    };
    expect(factsOf(asset("texture", "a.png"), texture).map((fact) => fact.value)).toEqual([
      "3.0 MB",
      "512 × 256",
      "image/png",
    ]);
  });

  it("gives the record fields", () => {
    expect(recordFields(MODEL_DETAILS.record).map((field) => [field.label, field.value])).toEqual([
      ["asset-record-importer", "gltf"],
      ["asset-record-source", "Lamp.glb"],
      ["asset-record-rights", "../../rights/kenney.yaml"],
      ["asset-record-tags", "#light"],
    ]);
  });

  it("imports again with the settings of the record and a changed field", async () => {
    const reimport = vi.fn(() => Promise.resolve({ ok: true as const, details: MODEL_DETAILS }));
    const source: AssetSource = {
      base: BASE,
      list: () => Promise.resolve({ assets: [], importable: true, reason: null, extensions: [] }),
      importFile: () => Promise.resolve({ ok: false, reason: "no" }),
      importers: () =>
        Promise.resolve([
          {
            name: "gltf",
            extensions: [".glb"],
            kinds: ["model"],
            schema: {
              properties: {
                maxTextureSize: { type: "integer", default: 2048 },
                merge: { type: "boolean", default: false },
              },
            },
          },
        ]),
      details: () => Promise.resolve(MODEL_DETAILS),
      reimport,
    };
    const wrapper = mount(AssetInspector, {
      props: { asset: asset("model", "a.glb"), source, stills: false, lines: [] },
    });
    await flushPromises();
    expect(wrapper.get('[data-fact="asset-fact-meshes"]').text()).toBe("3");
    expect(wrapper.text()).toContain("a texture is larger than 1024 px");
    expect((wrapper.get('[data-testid="import-setting-maxTextureSize"]').element as HTMLInputElement).value).toBe(
      "1024",
    );
    await wrapper.get('[data-testid="import-setting-merge"]').setValue(true);
    await wrapper.get('[data-testid="asset-reimport-start"]').trigger("click");
    await flushPromises();
    expect(reimport).toHaveBeenCalledWith({ id: "ASSET00001", settings: { maxTextureSize: 1024, merge: true } });
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });
});
