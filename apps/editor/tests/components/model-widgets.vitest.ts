// SPDX-License-Identifier: Apache-2.0
// The widgets of the models: the chain of the levels of detail, and the overrides of the parts with a pick of a part in
// the view. Also the overrides of the variants of a character, the clip source of an animator, and the overrides of a
// prefab instance. Each widget writes through the inspector, with one undo step for each change.
import { SceneChannel } from "@scenity/editor-core";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import InspectorPanel from "../../src/scene/inspector/InspectorPanel.vue";
import { createInspector, type InspectorPort } from "../../src/scene/inspector/inspectorState";
import { overridePlace, overrideRows } from "../../src/scene/inspector/widgets/overrideRows";

const registry = builtinRegistry();
afterEach(() => {
  document.body.innerHTML = "";
});

const CONTROLLER = {
  layers: [{ name: "base", start: "idle", states: { idle: { motion: { kind: "clip", clip: "Idle" } } } }],
};
const SCENE = {
  format: "scenity.scene/1",
  id: "test",
  entities: {
    lamp: {
      name: "Lamp",
      parent: null,
      index: 0,
      components: { model: { asset: "asset:lamp", lod: { screen: [0.5] } } },
    },
    hero: {
      name: "Hero",
      parent: null,
      index: 1,
      components: {
        model: { asset: "asset:hero" },
        character: { variants: { red: {} } },
        animator: { controller: CONTROLLER },
      },
    },
    chair: {
      name: "Chair",
      parent: null,
      index: 2,
      components: {
        prefab: {
          source: "chair.prefab.json",
          overrides: [
            { op: "set", path: "/entities/seat/components/shape/colour", value: "#ff0000" },
            { op: "set", path: "/entities/seat/name", value: "Red seat" },
          ],
        },
      },
    },
  },
};

function setup(ids: readonly string[], pickPart?: InspectorPort["pickPart"]) {
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
    assets: [{ id: "moves", kind: "model", label: "Moves" }],
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
    ...(pickPart === undefined ? {} : { pickPart }),
  };
  return { channel, port, state: createInspector(port, ids) };
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const press = async (id: string): Promise<void> => {
  byId(id)?.click();
  await flushPromises();
};
/** Type a number into a number input of the inspector and commit it. */
async function typeNumber(id: string, value: number): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  if (input === null) throw new Error(`no input ${id}`);
  input.value = String(value);
  input.dispatchEvent(new Event("change"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await flushPromises();
}

describe("the widgets of the models", () => {
  it("edit the chain of the levels of detail: add, a new size in order, the hysteresis, remove", async () => {
    const { channel, state } = setup(["lamp"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    const lod = () =>
      (channel.doc.entities.lamp?.components.model as { lod?: { screen: number[]; hysteresis?: number } }).lod;
    expect(byId("field-model-lod")?.dataset.levels).toBe("1");
    await press("field-model-lod-add");
    expect(lod()?.screen).toEqual([0.5, 0.25]);
    await typeNumber("field-model-lod-level-1", 0.8);
    expect(lod()?.screen).toEqual([0.8, 0.5]);
    await typeNumber("field-model-lod-hysteresis", 0.1);
    expect(lod()?.hysteresis).toBe(0.1);
    await press("field-model-lod-remove");
    await press("field-model-lod-remove");
    expect(lod()).toBeUndefined();
  });

  it("add the override of a part that a click in the view names, for a model and for a variant", async () => {
    const { channel, state } = setup(["hero"], () => Promise.resolve({ entity: "hero", part: "Cape" }));
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    await press("field-model-materials-pick");
    expect((channel.doc.entities.hero?.components.model as { materials?: unknown }).materials).toEqual({
      "mesh:Cape": {},
    });
    // A variant of the character is a map of the overrides of the parts: it picks a part too.
    await press("field-character-variants-red-pick");
    expect((channel.doc.entities.hero?.components.character as { variants: unknown }).variants).toEqual({
      red: { "mesh:Cape": {} },
    });
  });

  it("set the clip source of an animator with its rig, and go back to the clips of the model", async () => {
    const { channel, state } = setup(["hero"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    const source = () => (channel.doc.entities.hero?.components.animator as { clipSource?: unknown }).clipSource;
    expect(byId("field-animator-clipSource")?.textContent).toContain("own model");
    const asset = document.querySelector<HTMLSelectElement>('[data-testid="field-animator-clipSource-asset"]');
    if (asset === null) throw new Error("no asset field");
    asset.value = "moves";
    asset.dispatchEvent(new Event("change"));
    await flushPromises();
    expect(source()).toEqual({ asset: "asset:moves" });
    const rig = document.querySelector<HTMLSelectElement>('[data-testid="field-animator-clipSource-rig"]');
    if (rig === null) throw new Error("no rig menu");
    rig.value = "mixamo";
    rig.dispatchEvent(new Event("change"));
    await flushPromises();
    expect(source()).toEqual({ asset: "asset:moves", rig: "mixamo" });
    await press("field-animator-clipSource-remove");
    expect(source()).toBeUndefined();
  });

  it("list the overrides of a prefab instance and revert one or all of them", async () => {
    expect(overridePlace("/entities/seat/components/shape/colour")).toBe("seat ▸ shape ▸ colour");
    expect(overridePlace("/entities/seat/name")).toBe("seat ▸ name");
    expect(overrideRows([{ op: "remove", path: "/entities/leg" }])[0]).toMatchObject({ kind: "remove", value: null });
    const { channel, state } = setup(["chair"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    const overrides = () => (channel.doc.entities.chair?.components.prefab as { overrides: unknown[] }).overrides;
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="inspector-override-row"]')];
    expect(rows().map((row) => row.textContent.replace(/\s+/g, " ").trim())).toEqual([
      'set seat ▸ shape ▸ colour = "#ff0000"ApplyRevert',
      'set seat ▸ name = "Red seat"ApplyRevert',
    ]);
    await press("field-prefab-overrides-revert-0");
    expect(overrides()).toEqual([{ op: "set", path: "/entities/seat/name", value: "Red seat" }]);
    channel.undo();
    await nextTick();
    await press("field-prefab-overrides-revert-all");
    expect(overrides()).toEqual([]);
  });
});
