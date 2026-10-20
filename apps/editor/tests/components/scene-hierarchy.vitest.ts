// SPDX-License-Identifier: Apache-2.0
// The hierarchy panel of the scene page: each action of the panel is a command with an undo step. The panel runs the
// commands of the page over a real page editor (the scene channel with the view channel). The tests cover rename
// (double-click, F2), and hide, solo and lock for each row. They also cover a drag that changes the parent, with a drop
// mark and no cycle. They also cover the search by name, tag or component, and a selection that stays the selection of
// the page.
import { builtinRegistry, readDocument, type SceneOp } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createHierarchy, placeAt } from "../../src/scene/hierarchy/hierarchyState";
import HierarchyPanel from "../../src/scene/hierarchy/HierarchyPanel.vue";
import { sceneCommands, type SelectionPort } from "../../src/scene/hierarchy/sceneCommands";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import { renameCommand } from "../../src/scene/hierarchy/hierarchyKeys";
import { pageKeys } from "../../src/scene/settings/pageKeys";

const registry = builtinRegistry();

const SCENE = {
  format: "scenity.scene/1",
  id: "garden",
  entities: {
    table: {
      name: "Table",
      parent: null,
      index: 0,
      tags: ["furniture"],
      components: { transform: { position: [1, 0, 0] }, shape: { kind: "box" } },
    },
    lamp: {
      name: "Lamp",
      parent: "table",
      index: 0,
      components: { transform: { position: [0, 1, 0] }, light: { type: "point" } },
    },
    bench: { name: "Bench", parent: null, index: 1, tags: ["furniture"], components: { shape: { kind: "box" } } },
    sun: { name: "Sun", parent: null, index: 2, components: { light: { type: "directional" } } },
  },
};

function sceneDoc(): SceneDocument {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

/** The selection of the page: a list of IDs and its listeners (PageSelection of the page). */
function pageSelection(): SelectionPort & { ids: readonly string[] } {
  const listeners = new Set<(ids: readonly string[]) => void>();
  const selection = {
    ids: [] as readonly string[],
    set(ids: readonly string[]) {
      selection.ids = [...ids];
      for (const listener of listeners) listener(selection.ids);
    },
    listen(listener: (ids: readonly string[]) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return selection;
}

function setup() {
  const patches: SceneOp[][] = [];
  const editor = new ScenePageEditor({
    doc: sceneDoc(),
    path: "scenes/garden.scene.json",
    diskText: JSON.stringify(SCENE),
    registry,
    patch: (ops) => {
      patches.push([...ops]);
      return Promise.resolve({ ok: true as const, warnings: [] });
    },
  });
  const selection = pageSelection();
  const commands = sceneCommands(editor, selection);
  const state = createHierarchy({
    doc: () => editor.doc,
    view: () => editor.view,
    listen: (listener) => {
      const stop = [editor.listen(() => listener()), editor.listenView(() => listener())];
      return () => stop.forEach((item) => item());
    },
    run: (id, args) => commands.run(id, args),
    selection,
  });
  const wrapper = mount(HierarchyPanel, { props: { state }, attachTo: document.body });
  return { editor, selection, state, wrapper, patches };
}

const row = (wrapper: VueWrapper, id: string) => wrapper.get(`[data-testid="hierarchy-row-${id}"]`);
const rowIds = (wrapper: VueWrapper) =>
  wrapper.findAll('[role="treeitem"]').map((item) => item.attributes("data-testid")?.replace("hierarchy-row-", ""));
const settle = async () => {
  for (let i = 0; i < 3; i += 1) await nextTick();
};
const steps = (editor: ScenePageEditor) => editor.channel.history.steps().index;

describe("the hierarchy panel", () => {
  it("shows the tree, collapses a parent, and searches by name, tag or component", async () => {
    const { wrapper, state } = setup();
    expect(rowIds(wrapper)).toEqual(["table", "lamp", "bench", "sun"]);
    expect(row(wrapper, "lamp").attributes("aria-level")).toBe("2");
    await wrapper.get('[data-testid="hierarchy-expand-table"]').trigger("click");
    expect(rowIds(wrapper)).toEqual(["table", "bench", "sun"]);
    expect(row(wrapper, "table").attributes("aria-expanded")).toBe("false");
    await wrapper.get('[data-testid="hierarchy-search"]').setValue("tag:furniture");
    expect(rowIds(wrapper)).toEqual(["table", "bench"]);
    await wrapper.get('[data-testid="hierarchy-search"]').setValue("component:light");
    // The search shows the parent of a match (also a collapsed one) as a parent row.
    expect(rowIds(wrapper)).toEqual(["table", "lamp", "sun"]);
    expect(row(wrapper, "table").attributes("data-match")).toBe("parent");
    await wrapper.get('[data-testid="hierarchy-search"]').setValue("pond");
    expect(wrapper.find('[data-testid="hierarchy-empty"]').exists()).toBe(true);
    expect(state.query.value).toBe("pond");
  });

  it("selects with a click, adds with ⌘-click, selects a range with Shift-click, and follows the page", async () => {
    const { wrapper, selection } = setup();
    await row(wrapper, "lamp").trigger("click");
    expect(selection.ids).toEqual(["lamp"]);
    await row(wrapper, "sun").trigger("click", { metaKey: true });
    expect(selection.ids).toEqual(["lamp", "sun"]);
    await row(wrapper, "table").trigger("click");
    await row(wrapper, "bench").trigger("click", { shiftKey: true });
    expect(selection.ids).toEqual(["table", "lamp", "bench"]);
    expect(row(wrapper, "lamp").attributes("aria-selected")).toBe("true");
    // A pick in the viewport sets the selection of the page: the panel shows it.
    selection.set(["sun"]);
    await settle();
    expect(row(wrapper, "sun").attributes("aria-selected")).toBe("true");
    expect(row(wrapper, "lamp").attributes("aria-selected")).toBe("false");
  });

  it("renames with a double-click or F2, as one undo step", async () => {
    const { wrapper, editor, state, selection } = setup();
    await row(wrapper, "bench").trigger("dblclick");
    const field = wrapper.get('[data-testid="hierarchy-rename"]');
    await field.setValue("Garden bench");
    await field.trigger("keydown", { key: "Enter" });
    await settle();
    expect(editor.doc.entities.bench?.name).toBe("Garden bench");
    expect(row(wrapper, "bench").text()).toContain("Garden bench");
    expect(steps(editor)).toBe(1);
    // F2 is the page command `hierarchy.rename` of the key map, in the key context of the panel.
    const stop = pageKeys().register([renameCommand(state, selection)]);
    (wrapper.element as HTMLElement).dataset.keyContext = "hierarchy";
    const sun = row(wrapper, "sun").element as HTMLElement;
    sun.focus();
    sun.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", code: "F2", bubbles: true, cancelable: true }));
    stop();
    await settle();
    await wrapper.get('[data-testid="hierarchy-rename"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-testid="hierarchy-rename"]').exists()).toBe(false);
    expect(editor.channel.undo()).toBe(true);
    await settle();
    expect(row(wrapper, "bench").text()).toContain("Bench");
    expect(editor.doc.entities.bench?.name).toBe("Bench");
  });

  it("hides in the document, solos and locks in the view state, one undo step each", async () => {
    const { wrapper, editor, patches } = setup();
    await wrapper.get('[data-testid="hierarchy-hide-bench"]').trigger("click");
    await settle();
    expect(editor.doc.entities.bench?.components.visibility).toEqual({ visible: false });
    expect(editor.dirty).toBe(true);
    expect(row(wrapper, "bench").classes()).toContain("opacity-50");
    await wrapper.get('[data-testid="hierarchy-solo-lamp"]').trigger("click");
    await wrapper.get('[data-testid="hierarchy-lock-table"]').trigger("click");
    await settle();
    expect(editor.view).toEqual({ solo: ["lamp"], locked: ["table"] });
    // The view state changes the drawn document only: the runtime gets the ops, the document keeps none.
    expect(editor.doc.entities.sun?.components.visibility).toBeUndefined();
    expect(patches.flat()).toContainEqual({
      op: "addComponent",
      id: "sun",
      component: "visibility",
      value: { visible: false },
    });
    expect(patches.at(-1)).toContainEqual({
      op: "addComponent",
      id: "lamp",
      component: "pickable",
      value: { enabled: false },
    });
    expect(wrapper.get('[data-testid="hierarchy-lock-lamp"]').attributes("aria-pressed")).toBe("false");
    expect(wrapper.get('[data-testid="hierarchy-solo-lamp"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.find('[data-testid="hierarchy-show-all"]').exists()).toBe(true);
    expect(steps(editor)).toBe(3);
    editor.channel.undo();
    editor.channel.undo();
    await settle();
    expect(editor.view).toEqual({ solo: [], locked: [] });
    expect(wrapper.find('[data-testid="hierarchy-show-all"]').exists()).toBe(false);
    editor.channel.undo();
    await settle();
    expect(editor.doc.entities.bench?.components.visibility).toBeUndefined();
    expect(editor.dirty).toBe(false);
  });

  it("changes the parent with a drag and a drop mark, refuses a cycle, and undoes in one step", async () => {
    const { wrapper, editor, state } = setup();
    await row(wrapper, "sun").trigger("dragstart");
    // A row with no height gives the middle place: inside.
    await row(wrapper, "table").trigger("dragover");
    expect(row(wrapper, "table").attributes("data-drop")).toBe("inside");
    await row(wrapper, "table").trigger("drop");
    await settle();
    expect(editor.doc.entities.sun).toMatchObject({ parent: "table", index: 1 });
    expect(rowIds(wrapper)).toEqual(["table", "lamp", "sun", "bench"]);
    expect(row(wrapper, "table").attributes("data-drop")).toBeUndefined();
    // A parent onto its own child is a cycle: no drop mark and no change.
    await row(wrapper, "table").trigger("dragstart");
    await row(wrapper, "lamp").trigger("dragover");
    expect(row(wrapper, "lamp").attributes("data-drop")).toBeUndefined();
    expect(state.over("lamp", "inside")).toBe(false);
    await row(wrapper, "lamp").trigger("drop");
    await settle();
    expect(editor.doc.entities.table?.parent).toBeNull();
    // Before a row: the top quarter of the row.
    expect(placeAt(2, 28)).toBe("before");
    expect(placeAt(26, 28)).toBe("after");
    expect(placeAt(14, 28)).toBe("inside");
    state.startDrag("bench");
    expect(state.over("table", "before")).toBe(true);
    await state.dropOn("table", "before");
    await settle();
    expect(rowIds(wrapper)).toEqual(["bench", "table", "lamp", "sun"]);
    expect(steps(editor)).toBe(2);
    editor.channel.undo();
    editor.channel.undo();
    await settle();
    expect(rowIds(wrapper)).toEqual(["table", "lamp", "bench", "sun"]);
    expect(editor.dirty).toBe(false);
  });
});
