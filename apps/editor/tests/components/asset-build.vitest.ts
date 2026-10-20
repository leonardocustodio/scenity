// SPDX-License-Identifier: Apache-2.0
// The asset build panel: the state marks, the run of the build, and the build settings of an asset (the codecs and the
// levels). Also the levels of the build with a preview. The source is a fake.
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { AssetSource } from "../../src/assetBrowser/assetClient";
import type { AssetBuildReport } from "../../src/assetBrowser/assetTypes";
import AssetBuildPanel from "../../src/assetBrowser/build/AssetBuildPanel.vue";
import { formSettings, formTexts, stateCounts } from "../../src/assetBrowser/build/buildForm";

const REPORT: AssetBuildReport = {
  job: { running: false, log: ["showroom build: wrote 3 files, 900 KB to build (2.1 s)"], code: 0 },
  assets: [
    {
      id: "LAMP000001",
      name: "Lamp",
      kind: "model",
      state: "stale",
      reason: "the record or the source changed after the build of 2026-10-18",
      lods: [
        { tier: "high", file: "LAMP000001.high.glb", triangles: 5626, bytes: 700_000 },
        { tier: "low", file: "LAMP000001.low.glb", triangles: 2813, bytes: 200_000 },
      ],
      build: { lods: 2 },
    },
    { id: "WALL000001", name: "wall", kind: "texture", state: "built", reason: null, lods: [], build: null },
    { id: "SKY0000001", name: "sky", kind: "environment", state: "failed", reason: "no file", lods: [], build: null },
  ],
};

function source() {
  const runBuild = vi.fn(() => Promise.resolve({ ok: true as const }));
  const writeBuildSettings = vi.fn(() => Promise.resolve({ ok: true as const }));
  const fake: AssetSource = {
    base: "http://127.0.0.1:5176/projects/test/",
    list: () => Promise.resolve({ assets: [], importable: true, reason: null, extensions: [] }),
    importFile: () => Promise.resolve({ ok: false, reason: "no" }),
    build: () => Promise.resolve(REPORT),
    runBuild,
    writeBuildSettings,
  };
  return { fake, runBuild, writeBuildSettings };
}

describe("the build settings form", () => {
  it("keeps the project settings for empty choices and refuses a bad level count", () => {
    expect(formSettings(formTexts(null))).toBeNull();
    const texts = formTexts({ codecs: { color: "uastc" }, lods: 3 });
    expect(texts.codecs.color).toBe("uastc");
    expect(texts.lods).toBe("3");
    expect(formSettings(texts)).toEqual({ codecs: { color: "uastc" }, lods: 3 });
    expect(() => formSettings({ ...texts, lods: "9" })).toThrow("lods");
    expect(stateCounts(REPORT.assets)).toEqual([
      ["failed", 1],
      ["stale", 1],
      ["unbuilt", 0],
      ["built", 1],
    ]);
  });
});

describe("the asset build panel", () => {
  it("marks each state, runs the build, saves the settings and previews a level", async () => {
    const { fake, runBuild, writeBuildSettings } = source();
    const wrapper = mount(AssetBuildPanel, { props: { source: fake }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('[data-testid="asset-build-row-LAMP000001"]').attributes("data-state")).toBe("stale");
    expect(wrapper.get('[data-testid="asset-build-row-SKY0000001"]').attributes("title")).toBe("no file");
    expect(wrapper.get('[data-testid="asset-build-log"]').text()).toContain("wrote 3 files");
    expect(wrapper.get('[data-testid="asset-build-result"]').attributes("data-code")).toBe("0");
    await wrapper.get('[data-testid="asset-build-run"]').trigger("click");
    expect(runBuild).toHaveBeenCalledOnce();

    await wrapper.get('[data-testid="asset-build-row-LAMP000001"]').trigger("click");
    await flushPromises();
    expect((wrapper.get('[data-testid="asset-build-lods"]').element as HTMLInputElement).value).toBe("2");
    await wrapper.get('[data-testid="asset-build-codec-normal"]').setValue("uastc");
    await wrapper.get('[data-testid="asset-build-save"]').trigger("click");
    await flushPromises();
    expect(writeBuildSettings).toHaveBeenCalledWith("LAMP000001", { codecs: { normal: "uastc" }, lods: 2 });

    expect(wrapper.find('[data-testid="asset-preview-canvas"]').exists()).toBe(false);
    await wrapper.get('[data-testid="asset-build-preview-low"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="asset-preview-canvas"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
