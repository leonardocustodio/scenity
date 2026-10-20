// SPDX-License-Identifier: Apache-2.0
// The inspector panel of the scene page. A component of a test plugin (tests/fixtures/inspector-plugin, a zod schema
// and one hint) shows in the inspector with no editor code, and each widget edits it. Each edit is scene ops and one
// step of the history of a real scene channel. A drag of a number is one step. Several entities show mixed values. A
// reset returns to the default, and a revert returns to the prefab value.
import { SceneChannel } from "@scenity/editor-core";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import InspectorPanel from "../../src/scene/inspector/InspectorPanel.vue";
import { createInspector, type InspectorPort } from "../../src/scene/inspector/inspectorState";
import plugin from "../fixtures/inspector-plugin/runtime";

const registry = builtinRegistry();
for (const component of plugin.components) registry.register(component);

const SCENE = {
  format: "scenity.scene/1",
  id: "test",
  entities: {
    box: {
      name: "Box",
      parent: null,
      index: 0,
      components: {
        transform: { position: [0, 0, 0] },
        shape: { kind: "box", colour: "#ff0000" },
        "fixture.beacon": { rate: 1, mode: "steady" },
      },
    },
    cart: {
      name: "Cart",
      parent: null,
      index: 1,
      components: { shape: { kind: "box", colour: "#00ff00" }, socket: { points: { top: [0, 1, 0] } } },
    },
    chair: {
      parent: null,
      index: 2,
      components: {
        prefab: {
          source: "chair.prefab.json",
          overrides: [{ op: "set", path: "/entities/seat/components/shape/colour", value: "#0000ff" }],
        },
      },
    },
  },
};

const CHAIR: PrefabDocument = {
  format: "scenity.prefab/1",
  id: "chair",
  root: "seat",
  entities: {
    seat: { name: "Seat", parent: null, index: 0, components: { shape: { kind: "box", colour: "#888888" } } },
  },
};

function sceneDoc(): SceneDocument {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

/** A port over a real scene channel, as the page gives it. */
function setup(ids: readonly string[]) {
  const listeners = new Set<(doc: SceneDocument) => void>();
  const channel = new SceneChannel<SceneDocument>({
    doc: sceneDoc(),
    registry,
    patch: () => undefined,
    onChange: (doc) => {
      for (const listener of listeners) listener(doc);
    },
  });
  const port: InspectorPort = {
    registry,
    assets: [{ id: "chime01", kind: "audio", label: "chime.ogg" }],
    doc: () => channel.doc,
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    edit: (ops, title) => {
      try {
        channel.edit(ops, title);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    begin: () => channel.begin(),
    move: (ops) => {
      channel.move(ops);
      return null;
    },
    end: (cancel) => channel.end(cancel),
    prefab: (source) => (source === "chair.prefab.json" ? CHAIR : undefined),
  };
  const state = createInspector(port, ids);
  const wrapper = mount(InspectorPanel, { props: { state } });
  return { channel, state, wrapper };
}

const beacon = (channel: SceneChannel<SceneDocument>) =>
  channel.doc.entities.box?.components["fixture.beacon"] as Record<string, unknown>;
const steps = (channel: SceneChannel<SceneDocument>) => channel.history.steps().index;
const byId = (wrapper: VueWrapper, id: string) => wrapper.get(`[data-testid="${id}"]`);

async function change(wrapper: VueWrapper, id: string, value: string): Promise<void> {
  await byId(wrapper, id).setValue(value);
  await nextTick();
}

describe("the inspector panel", () => {
  it("shows each field of a plugin component from its schema, with no editor code", () => {
    const { wrapper } = setup(["box"]);
    expect(byId(wrapper, "inspector-title").text()).toBe("Box");
    const section = byId(wrapper, "inspector-component-fixture.beacon");
    expect(section.text()).toContain("Beacon");
    for (const key of ["rate", "tint", "mode", "on", "label", "offset", "target", "sound", "glow"]) {
      expect(section.find(`[data-testid="field-fixture.beacon-${key}-row"]`).exists(), key).toBe(true);
    }
    expect(section.text()).toContain("Blink rate");
    expect(byId(wrapper, "field-fixture.beacon-mode").element.tagName).toBe("SELECT");
    expect((byId(wrapper, "field-fixture.beacon-tint").element as HTMLInputElement).type).toBe("color");
    expect(wrapper.findAll('[data-testid^="field-fixture.beacon-offset-"]').length).toBeGreaterThanOrEqual(3);
  });

  it("writes a number, a colour, an enum, a switch and the references, one step each", async () => {
    const { channel, wrapper } = setup(["box"]);
    await change(wrapper, "field-fixture.beacon-rate", "2.5");
    expect(beacon(channel).rate).toBe(2.5);
    await change(wrapper, "field-fixture.beacon-rate", "99");
    expect(beacon(channel).rate).toBe(10);
    await change(wrapper, "field-fixture.beacon-tint", "#00ff00");
    expect(beacon(channel).tint).toBe("#00ff00");
    await change(wrapper, "field-fixture.beacon-mode", "pulse");
    expect(beacon(channel).mode).toBe("pulse");
    await byId(wrapper, "field-fixture.beacon-on").trigger("click");
    expect(beacon(channel).on).toBe(false);
    await change(wrapper, "field-fixture.beacon-target", "cart");
    expect(beacon(channel).target).toBe("entity:cart");
    await change(wrapper, "field-fixture.beacon-target-sub", "top");
    expect(beacon(channel).target).toBe("entity:cart#top");
    await change(wrapper, "field-fixture.beacon-sound", "chime01");
    expect(beacon(channel).sound).toBe("asset:chime01");
    await byId(wrapper, "field-fixture.beacon-glow-add").trigger("click");
    await byId(wrapper, "field-fixture.beacon-glow-add").trigger("click");
    expect(beacon(channel).glow).toEqual([
      { t: 0, value: 0 },
      { t: 1000, value: 0 },
    ]);
    expect(steps(channel)).toBe(10);
    expect(channel.undo()).toBe(true);
    expect(beacon(channel).glow).toEqual([{ t: 0, value: 0 }]);
  });

  it("a drag of a number grip is one step", async () => {
    const { channel, wrapper } = setup(["box"]);
    const grip = byId(wrapper, "field-fixture.beacon-rate-grip");
    await grip.trigger("pointerdown", { button: 0, clientX: 100, pointerId: 1 });
    for (const x of [110, 120, 140]) await grip.trigger("pointermove", { clientX: x, pointerId: 1 });
    await grip.trigger("pointerup", { clientX: 140, pointerId: 1 });
    expect(beacon(channel).rate).toBe(2);
    expect(steps(channel)).toBe(1);
    expect(channel.undo()).toBe(true);
    expect(beacon(channel).rate).toBe(1);
  });

  it("shows mixed values of several entities and writes one value to each", async () => {
    const { channel, wrapper } = setup(["box", "cart"]);
    expect(byId(wrapper, "inspector-title").text()).toBe("2 entities");
    expect(wrapper.find('[data-testid="inspector-component-fixture.beacon"]').exists()).toBe(false);
    const row = byId(wrapper, "field-shape-colour-row");
    expect(row.attributes("data-mixed")).toBe("1");
    expect(row.text()).toContain("(mixed)");
    await change(wrapper, "field-shape-colour-hex", "#123456");
    expect(channel.doc.entities.box?.components.shape).toMatchObject({ colour: "#123456" });
    expect(channel.doc.entities.cart?.components.shape).toMatchObject({ colour: "#123456" });
    expect(steps(channel)).toBe(1);
  });

  it("resets a field to the default, and adds and removes a component", async () => {
    const { channel, wrapper } = setup(["box"]);
    await change(wrapper, "field-fixture.beacon-tint", "#00ff00");
    await byId(wrapper, "field-fixture.beacon-tint-row-reset").trigger("click");
    expect(beacon(channel).tint).toBeUndefined();
    // "Add component" is a search: Enter adds the first match.
    await change(wrapper, "inspector-add", "light");
    await byId(wrapper, "inspector-add").trigger("keydown", { key: "Enter" });
    expect(channel.doc.entities.box?.components.light).toEqual({ type: "directional" });
    await byId(wrapper, "inspector-remove-fixture.beacon").trigger("click");
    expect(channel.doc.entities.box?.components["fixture.beacon"]).toBeUndefined();
    await change(wrapper, "inspector-add", "fixture.beacon");
    await wrapper.get('[data-testid="inspector-add-item"][data-component="fixture.beacon"]').trigger("click");
    expect(beacon(channel)).toEqual({ rate: 0, mode: "steady" });
  });

  it("shows the overrides of a prefab entity and reverts one to the prefab value", async () => {
    const { channel, state, wrapper } = setup(["chair"]);
    expect(byId(wrapper, "inspector-prefab-chair/seat").text()).toContain("1 overridden");
    state.select(["chair/seat"]);
    await nextTick();
    const row = byId(wrapper, "field-shape-colour-row");
    expect(row.attributes("data-overridden")).toBe("1");
    expect((byId(wrapper, "field-shape-colour-hex").element as HTMLInputElement).value).toBe("#0000ff");
    await byId(wrapper, "field-shape-colour-row-revert").trigger("click");
    expect(channel.doc.entities.chair?.components.prefab).toEqual({ source: "chair.prefab.json" });
    expect((byId(wrapper, "field-shape-colour-hex").element as HTMLInputElement).value).toBe("#888888");
    await change(wrapper, "field-shape-colour-hex", "#abcdef");
    expect(channel.doc.entities.chair?.components.prefab).toEqual({
      source: "chair.prefab.json",
      overrides: [{ op: "set", path: "/entities/seat/components/shape/colour", value: "#abcdef" }],
    });
  });

  it("shows the scene values when nothing is selected", async () => {
    const { channel, wrapper } = setup([]);
    expect(byId(wrapper, "inspector-title").text()).toBe("Scene");
    await change(wrapper, "field-environment-exposure", "1.5");
    expect(channel.doc.environment).toEqual({ exposure: 1.5 });
  });
});
