// SPDX-License-Identifier: Apache-2.0
// Inspector v2: the header of one entity (the ID, the visible switch, the tags), and Copy and Paste values of a
// component. Also the raw JSON mode, "Add component" with a search and groups, and the prefab override mark. Also the
// lock: a locked inspector keeps its entity when the selection changes.
import { SceneChannel } from "@scenity/editor-core";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { copiedComponent, entityJson, jsonOps, tagOps } from "../../src/scene/inspector/entityEdits";
import InspectorHost from "../../src/scene/inspector/InspectorHost.vue";
import InspectorPanel from "../../src/scene/inspector/InspectorPanel.vue";
import { createInspector, type InspectorPort, type InspectorState } from "../../src/scene/inspector/inspectorState";
import { PANEL_STATE_KEY } from "../../src/studio/shell/panelState";

const registry = builtinRegistry();
afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

const SCENE = {
  format: "scenity.scene/1",
  id: "test",
  entities: {
    box: {
      name: "Box",
      parent: null,
      index: 0,
      tags: ["prop"],
      components: { transform: { position: [0, 0, 0] }, shape: { kind: "box", colour: "#ff0000" } },
    },
    cart: { name: "Cart", parent: null, index: 1, components: { shape: { kind: "sphere", colour: "#00ff00" } } },
  },
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
    move: () => null,
    end: (cancel) => channel.end(cancel),
  };
  return { channel, port, state: createInspector(port, ids) };
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("Inspector v2", () => {
  it("shows the ID, switches the visibility and edits the tags of one entity", async () => {
    const { channel, state } = setup(["box"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    expect(byId("inspector-id")?.textContent).toBe("box");
    byId("inspector-visible")?.click();
    await nextTick();
    expect(channel.doc.entities.box?.components.visibility).toEqual({ visible: false });
    const field = byId("inspector-tag-add") as HTMLInputElement;
    field.value = "wood";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await nextTick();
    expect(channel.doc.entities.box?.tags).toEqual(["prop", "wood"]);
    byId("inspector-tag-remove-prop")?.click();
    await nextTick();
    expect(channel.doc.entities.box?.tags).toEqual(["wood"]);
    expect(tagOps(channel.doc, "box", [])).toEqual([{ op: "set", path: "/entities/box/tags" }]);
  });

  it("copies the values of a component and pastes them on another entity", () => {
    const { channel, state } = setup(["box"]);
    const shape = registry.get("shape");
    if (shape === undefined) throw new Error("no shape");
    state.copyValues(shape);
    expect(copiedComponent()?.component).toBe("shape");
    state.follow(["cart"]);
    expect(state.canPaste(shape)).toBe(true);
    state.pasteValues(shape);
    expect(channel.doc.entities.cart?.components.shape).toMatchObject({ kind: "box", colour: "#ff0000" });
  });

  it("applies the raw JSON of an entity, and says why a bad text does not apply", async () => {
    const { channel, state } = setup(["box"]);
    mount(InspectorPanel, { props: { state, raw: true }, attachTo: document.body });
    await nextTick();
    const text = byId("inspector-json-text") as HTMLTextAreaElement;
    const box = channel.doc.entities.box;
    if (box === undefined) throw new Error("no box");
    expect(text.value).toBe(entityJson(box));
    text.value = JSON.stringify({ name: "Crate", components: { shape: { kind: "box", colour: "#0000ff" } } });
    text.dispatchEvent(new Event("input"));
    byId("inspector-json-apply")?.click();
    await nextTick();
    expect(channel.doc.entities.box?.name).toBe("Crate");
    expect(channel.doc.entities.box?.components.transform).toBeUndefined();
    expect(channel.doc.entities.box?.tags).toBeUndefined();
    text.value = "{ not json";
    text.dispatchEvent(new Event("input"));
    byId("inspector-json-apply")?.click();
    await nextTick();
    expect(byId("inspector-json-error")?.textContent).not.toBe("");
    expect(() => jsonOps(channel.doc, "box", "[]", registry)).toThrow();
  });

  it("adds a component from a search in groups, by the keys", async () => {
    const { channel, state } = setup(["cart"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    const search = byId("inspector-add") as HTMLInputElement;
    search.dispatchEvent(new Event("focus"));
    search.value = "spot light";
    search.dispatchEvent(new Event("input"));
    await nextTick();
    search.value = "light";
    search.dispatchEvent(new Event("input"));
    await nextTick();
    const items = document.querySelectorAll<HTMLElement>('[data-testid="inspector-add-item"]');
    expect([...items].map((item) => item.dataset.component)).toContain("light");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await nextTick();
    expect(channel.doc.entities.cart?.components.light).toBeDefined();
  });

  it("takes an asset of the Project window that drops on an asset field of its kind", async () => {
    const { channel, port } = setup(["box"]);
    const withAssets: InspectorPort = {
      ...port,
      assets: [
        { id: "TABLE", kind: "model", label: "table.glb" },
        { id: "SKY", kind: "environment", label: "sky.hdr" },
      ],
    };
    channel.edit([{ op: "addComponent", id: "box", component: "model", value: { asset: "asset:TABLE" } }], "model");
    const state = createInspector(withAssets, ["box"]);
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    const field = document.querySelector<HTMLSelectElement>('[data-drop="asset"]');
    if (field === null) throw new Error("no asset field");
    const drop = (value: string): void => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { types: ["application/x-scenity-asset"], getData: () => value },
      });
      field.dispatchEvent(event);
    };
    // An asset of another kind does not go into a model field.
    drop("asset:SKY");
    await nextTick();
    expect((channel.doc.entities.box?.components.model as { asset: string }).asset).toBe("asset:TABLE");
    channel.edit([{ op: "set", path: "/entities/box/components/model/asset", value: "asset:SKY" }], "x");
    drop("asset:TABLE");
    await nextTick();
    expect((channel.doc.entities.box?.components.model as { asset: string }).asset).toBe("asset:TABLE");
  });

  it("keeps the entity of a locked inspector when the selection changes", async () => {
    const { port, state } = setup(["box"]);
    const store: Record<string, unknown> = {};
    const kept = new Map<string, InspectorState>();
    mount(InspectorHost, {
      props: {
        state,
        locked: (ids: readonly string[]) => {
          const key = ids.join(",");
          const found = kept.get(key) ?? createInspector(port, ids);
          kept.set(key, found);
          return found;
        },
      },
      attachTo: document.body,
      global: {
        provide: {
          [PANEL_STATE_KEY as symbol]: {
            read: (key: string) => store[key],
            write: (key: string, value: unknown) => {
              store[key] = value;
            },
          },
        },
      },
    });
    byId("inspector-lock")?.click();
    await flushPromises();
    expect(store.locked).toEqual(["box"]);
    state.follow(["cart"]);
    await nextTick();
    expect(byId("inspector-title")?.textContent.trim()).toBe("Box");
    byId("inspector-lock")?.click();
    await flushPromises();
    expect(byId("inspector-title")?.textContent.trim()).toBe("Cart");
  });
});
