// SPDX-License-Identifier: Apache-2.0
// The entity commands of the scene page over a real page editor. The context menu of the hierarchy panel has duplicate,
// delete, copy, paste as a child and add an empty child. Also the keys (⌘D, Delete, ⌘C, ⌘V), the clipboard of the
// project across two scenes, and the selection of the new roots. Each action is one step of the history, and an undo
// puts the document back.
import { builtinRegistry, readDocument, writeDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createHierarchy } from "../../src/scene/hierarchy/hierarchyState";
import HierarchyPanel from "../../src/scene/hierarchy/HierarchyPanel.vue";
import { sceneCommands, type SelectionPort } from "../../src/scene/hierarchy/sceneCommands";
import { chordOfEvent, createKeyMap } from "@scenity/editor-core";
import { listenEntityKeys } from "../../src/scene/entityKeys";
import { clipboardKey, pageClipboard, parseClipboard } from "../../src/scene/pageClipboard";
import { ScenePageEditor } from "../../src/scene/sceneEditor";

const registry = builtinRegistry();
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  document.body.innerHTML = "";
  globalThis.localStorage.clear();
});

function sceneOf(id: string, entities: Record<string, unknown>): SceneDocument {
  const read = readDocument(JSON.stringify({ format: "scenity.scene/1", id, entities }), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

const GARDEN = {
  table: { name: "Table", parent: null, index: 0, components: { transform: { position: [1, 0, 0] } } },
  lamp: {
    name: "Lamp",
    parent: "table",
    index: 0,
    components: { transform: { position: [0, 1, 0] }, light: { type: "spot", target: "entity:table" } },
  },
  bench: { name: "Bench", parent: null, index: 1, components: { model: { asset: "asset:01BENCH" } } },
};

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

/** A page editor of a scene with the commands of the page and the clipboard of the project "garden". */
function page(doc: SceneDocument) {
  const editor = new ScenePageEditor({
    doc,
    path: `scenes/${doc.id}.scene.json`,
    diskText: writeDocument(doc),
    registry,
    patch: () => Promise.resolve({ ok: true as const, warnings: [] }),
  });
  const selection = pageSelection();
  const commands = sceneCommands(editor, selection, pageClipboard());
  return { editor, selection, commands };
}

function panel(parts: ReturnType<typeof page>) {
  const { editor, selection, commands } = parts;
  const state = createHierarchy({
    doc: () => editor.doc,
    view: () => editor.view,
    listen: (listener) => editor.listen(() => listener()),
    run: (id, args) => commands.run(id, args),
    selection,
  });
  return mount(HierarchyPanel, { props: { state }, attachTo: document.body });
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("the entity commands of the scene page", () => {
  it("duplicates, deletes, copies and pastes through the context menu, each one undo step", async () => {
    const parts = page(sceneOf("garden", GARDEN));
    const { editor, selection } = parts;
    const wrapper = panel(parts);
    const before = writeDocument(editor.doc);
    await wrapper.get('[data-testid="hierarchy-row-table"]').trigger("contextmenu", { clientX: 20, clientY: 30 });
    expect(selection.ids).toEqual(["table"]);
    await wrapper.get('[data-testid="hierarchy-menu-duplicate"]').trigger("click");
    await settle();
    expect(editor.doc.entities["table-2"]?.index).toBe(1);
    expect(editor.doc.entities["lamp-2"]?.components.light).toEqual({ type: "spot", target: "entity:table-2" });
    expect(selection.ids).toEqual(["table-2"]);
    expect(wrapper.find('[data-testid="hierarchy-menu"]').exists()).toBe(false);
    editor.channel.undo();
    expect(writeDocument(editor.doc)).toBe(before);
    expect(selection.ids).toEqual([]);

    await wrapper.get('[data-testid="hierarchy-row-bench"]').trigger("contextmenu");
    await wrapper.get('[data-testid="hierarchy-menu-copy"]').trigger("click");
    await settle();
    await wrapper.get('[data-testid="hierarchy-row-table"]').trigger("contextmenu");
    await wrapper.get('[data-testid="hierarchy-menu-paste"]').trigger("click");
    await settle();
    expect(editor.doc.entities["bench-2"]).toMatchObject({ parent: "table", index: 1 });
    await wrapper.get('[data-testid="hierarchy-row-table"]').trigger("contextmenu");
    await wrapper.get('[data-testid="hierarchy-menu-delete"]').trigger("click");
    await settle();
    expect(Object.keys(editor.doc.entities)).toEqual(["bench"]);
    editor.channel.undo();
    editor.channel.undo();
    expect(writeDocument(editor.doc)).toBe(before);
    wrapper.unmount();
  });

  it("runs the keys on the selection and pastes into a second scene of the project", async () => {
    const first = page(sceneOf("garden", GARDEN));
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    stops.push(listenEntityKeys({ canvas, commands: first.commands, live: () => false }));
    first.selection.set(["bench"]);
    key({ key: "d", metaKey: true });
    await settle();
    expect(first.selection.ids).toEqual(["bench-2"]);
    key({ key: "Backspace" });
    await settle();
    expect(Object.keys(first.editor.doc.entities).sort()).toEqual(["bench", "lamp", "table"]);
    first.selection.set(["table"]);
    key({ key: "c", ctrlKey: true });
    await settle();
    const stored = parseClipboard(globalThis.localStorage.getItem(clipboardKey()));
    expect(stored?.roots).toEqual(["table"]);
    // A field takes its own keys: Delete in a text field deletes no entity.
    const field = document.createElement("input");
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    await settle();
    expect(first.editor.doc.entities.table).toBeDefined();
    stops.splice(0).forEach((stop) => stop());

    const second = page(sceneOf("patio", { post: { parent: null, index: 0, components: {} } }));
    stops.push(listenEntityKeys({ canvas, commands: second.commands, live: () => false }));
    const before = writeDocument(second.editor.doc);
    key({ key: "v", metaKey: true });
    await settle();
    expect(second.selection.ids).toEqual(["table"]);
    expect(second.editor.doc.entities.lamp?.components.light).toEqual({ type: "spot", target: "entity:table" });
    second.editor.channel.undo();
    expect(writeDocument(second.editor.doc)).toBe(before);
  });

  it("maps the keys to the commands (the default keys of the command definitions in the key map)", () => {
    const { commands } = page(sceneOf("garden", GARDEN));
    const map = createKeyMap(commands.definitions());
    const of = (init: KeyboardEventInit) => {
      const chord = chordOfEvent(new KeyboardEvent("keydown", init));
      return chord === null ? null : (map.commandsFor(chord, ["scene", "global"])[0] ?? null);
    };
    expect(of({ key: "Delete" })).toBe("entity.delete");
    expect(of({ key: "Backspace" })).toBe("entity.delete");
    expect(of({ key: "D", metaKey: true })).toBe("entity.duplicate");
    expect(of({ key: "c", ctrlKey: true })).toBe("entity.copy");
    expect(of({ key: "v", metaKey: true })).toBe("entity.paste");
    expect(of({ key: "z", metaKey: true })).toBeNull();
    expect(of({ key: "Delete", metaKey: true })).toBeNull();
    expect(of({ key: "d" })).toBeNull();
  });
});
