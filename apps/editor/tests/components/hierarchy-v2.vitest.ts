// SPDX-License-Identifier: Apache-2.0
// Hierarchy v2: the keys of the tree (select, open, close, move by Alt and the arrows), and the icon of the main
// component. Also the virtual list (10,000 entities give a few rows in the page), the + menu, and an asset that drops
// on a row.
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { treeRows } from "@scenity/editor-core";
import { entityIcon } from "../../src/scene/hierarchy/entityIcons";
import { createHierarchy } from "../../src/scene/hierarchy/hierarchyState";
import HierarchyPanel from "../../src/scene/hierarchy/HierarchyPanel.vue";
import { sceneCommands, type SelectionPort } from "../../src/scene/hierarchy/sceneCommands";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import { siblingsOf, treeKey } from "../../src/scene/hierarchy/treeKeys";

const registry = builtinRegistry();
afterEach(() => {
  document.body.innerHTML = "";
});

const SCENE = {
  format: "scenity.scene/1",
  id: "garden",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { model: { asset: "asset:TABLE" } } },
    lamp: { name: "Lamp", parent: "table", index: 0, components: { light: { type: "point" } } },
    bench: { name: "Bench", parent: null, index: 1, components: { shape: { kind: "box" } } },
    sun: { name: "Sun", parent: null, index: 2, components: { light: { type: "directional" } } },
  },
};

function docOf(scene: object): SceneDocument {
  const read = readDocument(JSON.stringify(scene), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

function setup(scene: object = SCENE) {
  const editor = new ScenePageEditor({
    doc: docOf(scene),
    path: "scenes/garden.scene.json",
    diskText: JSON.stringify(scene),
    registry,
    patch: () => Promise.resolve({ ok: true as const, warnings: [] }),
  });
  const listeners = new Set<(ids: readonly string[]) => void>();
  const selection: SelectionPort & { ids: readonly string[] } = {
    ids: [],
    set(ids) {
      selection.ids = [...ids];
      for (const listener of listeners) listener(selection.ids);
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ran: string[] = [];
  const commands = sceneCommands(editor, selection);
  const state = createHierarchy({
    doc: () => editor.doc,
    view: () => editor.view,
    listen: (listener) => editor.listen(() => listener()),
    run: (id, args) => {
      ran.push(`${id} ${JSON.stringify(args)}`);
      return commands.run(id, args);
    },
    selection,
  });
  return { editor, selection, state, ran };
}

describe("the keys of the tree", () => {
  it("go up and down, open and close, and move with Alt", () => {
    const doc = docOf(SCENE);
    const rows = treeRows(doc);
    const mods = { alt: false, shift: false };
    expect(treeKey(rows, doc, "table", "ArrowDown", mods)).toEqual({ kind: "focus", id: "lamp", extend: false });
    expect(treeKey(rows, doc, "bench", "ArrowUp", { ...mods, shift: true })).toEqual({
      kind: "focus",
      id: "lamp",
      extend: true,
    });
    expect(treeKey(rows, doc, "lamp", "ArrowLeft", mods)).toEqual({ kind: "focus", id: "table", extend: false });
    expect(treeKey(rows, doc, "table", "ArrowLeft", mods)).toEqual({ kind: "collapse", id: "table" });
    expect(treeKey(rows, doc, "table", "ArrowRight", mods)).toEqual({ kind: "focus", id: "lamp", extend: false });
    expect(treeKey(rows, doc, "sun", "Home", mods)?.id).toBe("table");
    expect(treeKey(rows, doc, "table", "End", mods)?.id).toBe("sun");
    const alt = { alt: true, shift: false };
    expect(treeKey(rows, doc, "bench", "ArrowUp", alt)).toEqual({
      kind: "move",
      id: "bench",
      target: "table",
      place: "before",
    });
    expect(treeKey(rows, doc, "bench", "ArrowRight", alt)).toEqual({
      kind: "move",
      id: "bench",
      target: "table",
      place: "inside",
    });
    expect(treeKey(rows, doc, "lamp", "ArrowLeft", alt)).toEqual({
      kind: "move",
      id: "lamp",
      target: "table",
      place: "after",
    });
    expect(treeKey(rows, doc, "table", "ArrowLeft", alt)).toBeNull();
    expect(siblingsOf(doc, "bench")).toEqual(["table", "bench", "sun"]);
  });

  it("move an entity by the keys of the panel, as one step each", async () => {
    const { editor, state } = setup();
    mount(HierarchyPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    const row = (id: string) => document.querySelector<HTMLElement>(`[data-row="${id}"]`);
    const press = async (id: string, key: string, alt = false) => {
      row(id)?.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: alt, bubbles: true }));
      for (let at = 0; at < 4; at += 1) await nextTick();
      await new Promise((done) => setTimeout(done, 0));
    };
    await press("bench", "ArrowUp", true);
    expect(siblingsOf(editor.doc, "bench")).toEqual(["bench", "table", "sun"]);
    await press("sun", "ArrowRight", true);
    expect(editor.doc.entities.sun?.parent).toBe("table");
    await press("table", "ArrowDown");
    expect(document.activeElement?.getAttribute("data-row")).toBe("lamp");
  });
});

describe("the rows of the tree", () => {
  it("show the icon of the main component", () => {
    expect(entityIcon({ model: {} }, "entity").component).toBe("model");
    expect(entityIcon({ light: {}, model: {} }, "entity").component).toBe("light");
    expect(entityIcon({}, "entity").component).toBe("empty");
    expect(entityIcon({ prefab: {} }, "instance").component).toBe("prefab");
  });

  it("put only the rows in the view in the page for 10,000 entities", async () => {
    const entities = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, at) => [
        `e${String(at)}`,
        { name: `E${String(at)}`, parent: null, index: at, components: {} },
      ]),
    );
    const { state } = setup({ format: "scenity.scene/1", id: "big", entities });
    mount(HierarchyPanel, { props: { state }, attachTo: document.body });
    await nextTick();
    expect(document.querySelector('[data-testid="hierarchy-tree"]')?.getAttribute("data-rows")).toBe("10000");
    const shown = document.querySelectorAll('[role="treeitem"]');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(120);
    expect(shown[0]?.getAttribute("aria-setsize")).toBe("10000");
  });

  it("create from the + menu, and add a model for an asset that drops on a row", async () => {
    const { state, ran } = setup();
    await state.create("box");
    await state.dropAsset("asset:CHAIR", "table", "inside");
    await state.dropAsset("asset:LAMP", null, "inside");
    expect(ran).toEqual([
      "entity.create.box {}",
      'entity.add {"asset":"asset:CHAIR","parent":"table"}',
      'entity.add {"asset":"asset:LAMP"}',
    ]);
  });
});
