// SPDX-License-Identifier: Apache-2.0
// The widgets of the environment hints. The fog, the bloom, the ambient occlusion and the selection outline of the
// scene each show a live preview over their fields. The preview follows each edit and each step of a number drag,
// before the drag makes its step.
import { SceneChannel } from "@scenity/editor-core";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { aoPreview, bloomPreview, fogPreview, outlinePreview } from "../../src/scene/inspector/environmentPreviews";
import InspectorPanel from "../../src/scene/inspector/InspectorPanel.vue";
import { createInspector, type InspectorPort } from "../../src/scene/inspector/inspectorState";

const registry = builtinRegistry();
afterEach(() => {
  document.body.innerHTML = "";
});

const SCENE = {
  format: "scenity.scene/1",
  id: "test",
  environment: {
    background: "#000000",
    fog: { type: "linear", colour: "#ffffff", near: 2, far: 10 },
    bloom: { on: true, threshold: 1, strength: 1 },
    ao: { radius: 1, intensity: 0.5 },
  },
  entities: {},
};

function setup(ids: readonly string[]) {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error("bad scene");
  const listeners = new Set<(doc: SceneDocument) => void>();
  const channel = new SceneChannel<SceneDocument>({
    doc: read.doc,
    registry,
    patch: () => undefined,
    onChange: (doc) => {
      for (const listener of listeners) listener(doc);
    },
  });
  const port: InspectorPort = {
    registry,
    assets: [],
    doc: () => channel.doc,
    listen: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    edit: (ops, title) => {
      try {
        channel.edit(ops, title);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    begin: () => channel.begin(),
    // A drag moves the document at each step, as the scene channel of the page does.
    move: (ops) => {
      channel.move(ops);
      return null;
    },
    end: (cancel) => channel.end(cancel),
  };
  return { channel, port, state: createInspector(port, ids) };
}

const preview = (kind: string) =>
  document.querySelector<HTMLElement>(`[data-testid="inspector-preview"][data-kind="${kind}"]`);
const glows = () =>
  [...(preview("bloom")?.querySelectorAll<HTMLElement>('[data-testid="inspector-preview-sample"]') ?? [])].map(
    (sample) => Number(sample.dataset.glow),
  );

describe("the previews of the environment hints", () => {
  it("give the fog over the distance, the glow of the bright samples, the shade and the outline", () => {
    const linear = fogPreview({ type: "linear", colour: "#ffffff", near: 2, far: 10 }, 4);
    expect(linear).toEqual({ on: true, colour: "#ffffff", distance: 12, stops: [0, 0.125, 0.5, 0.875, 1] });
    const exp2 = fogPreview({ type: "exp2", colour: "#808080", density: 0.1 }, 2);
    expect(exp2.stops[0]).toBe(0);
    expect(exp2.stops[2]).toBeCloseTo(0.99, 2);
    expect(fogPreview(undefined).on).toBe(false);
    expect(bloomPreview({ threshold: 1, strength: 2 }).samples.map((sample) => sample.glow)).toEqual([
      0, 0, 0, 0, 0.5, 1, 1,
    ]);
    expect(bloomPreview(undefined).on).toBe(false);
    expect(aoPreview({ radius: 1, intensity: 0.5 })).toEqual({ on: true, darkness: 0.5, width: 0.5 });
    expect(aoPreview({ on: false }).darkness).toBe(0);
    expect(outlinePreview(undefined)).toMatchObject({ on: true, thickness: 1, opacity: 1 });
    expect(outlinePreview({ colour: [255, 0, 0], thickness: 4, strength: 1.5 })).toMatchObject({
      colour: "#ff0000",
      thickness: 4,
      opacity: 0.5,
    });
  });

  it("show over their fields in the inspector of the scene and follow an edit and a drag", async () => {
    const { channel, state } = setup([]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    for (const kind of ["fog", "bloom", "ambientOcclusion", "selectionOutline"]) expect(preview(kind)).not.toBeNull();
    expect(preview("fog")?.querySelector<HTMLElement>("[data-stops]")?.dataset.stops?.split(" ")[0]).toBe("0");
    expect(glows()).toEqual([0, 0, 0, 0, 0.25, 0.5, 1]);
    const environment = registry.get("environment");
    if (environment === undefined) throw new Error("no environment");
    // A drag of the threshold changes the preview at each step. The end of the drag makes one step.
    state.dragStart();
    state.dragTo(environment, ["bloom", "threshold"], 0.5);
    await nextTick();
    expect(glows()).toEqual([0, 0, 0.25, 0.5, 0.75, 1, 1]);
    state.dragEnd(false);
    expect(channel.doc.environment?.bloom?.threshold).toBe(0.5);
    // An edit of the fog and the outline shows immediately.
    state.set(environment, ["fog", "far"], 4);
    state.set(environment, ["outline"], { colour: "#00ff00", thickness: 3 });
    await nextTick();
    expect(preview("fog")?.textContent).toContain("4.8");
    const outline = preview("selectionOutline")?.querySelector<HTMLElement>(
      '[data-testid="inspector-preview-outline"]',
    );
    expect(outline?.dataset).toMatchObject({ colour: "#00ff00", thickness: "3" });
    state.set(environment, ["ao", "on"], false);
    await nextTick();
    expect(preview("ambientOcclusion")?.dataset.off).toBe("1");
  });
});
