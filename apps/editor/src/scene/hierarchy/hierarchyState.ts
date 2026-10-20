// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the hierarchy panel of the scene page: the rows of the entity tree, the collapsed parents, the search,
 * the selection, the rename field and the drag. The model is `@scenity/editor-core` (no Vue); this module adds the Vue
 * cells. Each change of the scene or of the view state is a command of the page (one step of the history). The
 * selection is the selection of the page, so the outline of the viewport, the inspector and the panel show the same
 * entities.
 *
 * A right click on a row (or on the empty tree) opens the context menu of the entity commands (menuItems).
 *
 * The tree is the expanded document, so the entities of each prefab instance are rows under the instance
 * (`<instance>/<entity>`). A prefab row has no drag, and its rename and its toggles are overrides of the instance. A
 * mark gives the number of overrides of an instance and of a prefab entity. The menu of an instance or a prefab row
 * opens the prefab and applies or reverts the overrides.
 *
 * The menu labels and the refusals are Fluent messages of `src/i18n/en-US/hierarchy.ftl` (the page locale).
 */
import {
  dropTarget,
  overrideMarks,
  isShown,
  lockedEntities,
  rowRange,
  soloEntities,
  treeOrder,
  treeRows,
  type DropPlace,
  type SceneView,
  type TreeRow,
} from "@scenity/editor-core";
import { subtreeOf } from "@scenity/scene/hierarchy";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { computed, inject, ref, shallowReactive, shallowRef, type InjectionKey, type Ref } from "vue";
import { t } from "../../texts";
import type { SelectionPort } from "./sceneCommands";
import type { TreeKeyAction } from "./treeKeys";

/** What the panel needs of the page. */
export interface HierarchyPort {
  doc(): SceneDocument;
  view(): SceneView;
  /** Call `listener` after each change of the document or of the view state; the result stops it. */
  listen(listener: () => void): () => void;
  /** Run a command of the page. A refusal throws an error with the reason. */
  run(id: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  readonly selection: SelectionPort;
  /** Open the prefab of an instance (or of a prefab entity); the reason of a refusal, or null. */
  openPrefab?(id: string): string | null;
}

/** The kind of a row: an entity of the document, a prefab instance, or an entity of a prefab (`a/b`). */
export type RowKind = "entity" | "instance" | "prefab";

/** The kind of the row of an entity of the expanded document. */
export function rowKind(doc: SceneDocument, id: string): RowKind {
  if (id.includes("/")) return "prefab";
  return doc.entities[id]?.components.prefab === undefined ? "entity" : "instance";
}

/** The toggles of a row: hide (a document value), solo and lock (view values). */
export type RowToggle = "hide" | "solo" | "lock";

const TOGGLE_COMMANDS: Readonly<Record<RowToggle, string>> = {
  hide: "entity.hide",
  solo: "entity.solo",
  lock: "entity.lock",
};

/** The open context menu: the row (null: the empty tree) and the page point of the menu. */
export interface MenuState {
  readonly id: string | null;
  readonly x: number;
  readonly y: number;
}

/** One action of the context menu: a command with its arguments, or the rename field. */
export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly command: string | null;
  readonly args: Readonly<Record<string, unknown>>;
}

/** The items of the context menus of the plugins (the `menus` point of a studio face). */
export const PLUGIN_MENU_ITEMS = shallowReactive<{ menu: string; command: string; label: string }[]>([]);

/** The items of the plugins of a menu; the command of a row item gets the entity. */
function pluginItems(id: string | null): MenuItem[] {
  const menu = id === null ? "hierarchy.empty" : "hierarchy";
  return PLUGIN_MENU_ITEMS.filter((item) => item.menu === menu).map((item) => ({
    key: `plugin:${item.command}`,
    label: item.label,
    command: item.command,
    args: id === null ? {} : { entity: id },
  }));
}

/** The prefab actions of the menu of an instance row or of a prefab row. */
function prefabItems(id: string, kind: RowKind): MenuItem[] {
  const cut = id.indexOf("/");
  const scope = cut < 0 ? { instance: id } : { instance: id.slice(0, cut), entity: id.slice(cut + 1) };
  const entity = kind === "prefab";
  const apply = entity ? t("hierarchy-menu-prefab-apply-entity") : t("hierarchy-menu-prefab-apply");
  const revert = entity ? t("hierarchy-menu-prefab-revert-entity") : t("hierarchy-menu-prefab-revert");
  return [
    { key: "prefab-open", label: t("hierarchy-menu-prefab-open"), command: null, args: {} },
    { key: "prefab-apply", label: apply, command: "prefab.apply", args: scope },
    { key: "prefab-revert", label: revert, command: "prefab.revert", args: scope },
    // An instance unpacks; a prefab row renames as an override.
    ...(entity
      ? [{ key: "rename", label: t("hierarchy-menu-rename"), command: null, args: {} }]
      : [{ key: "prefab-unpack", label: t("hierarchy-menu-prefab-unpack"), command: "prefab.unpack", args: scope }]),
  ];
}

/**
 * The actions of the context menu of a row (an entity ID) or of the empty tree (null). `kind` adds
 * the prefab actions; a prefab row has only those.
 */
export function menuItems(id: string | null, kind: RowKind = "entity"): MenuItem[] {
  if (id !== null && kind === "prefab") return prefabItems(id, kind);
  const item = (key: string, label: string, command: string | null, args: Record<string, unknown> = {}): MenuItem => ({
    key,
    label,
    command,
    args,
  });
  if (id === null) {
    return [
      item("add", t("hierarchy-menu-add-entity"), "entity.add"),
      item("paste", t("hierarchy-menu-paste"), "entity.paste"),
      ...pluginItems(null),
    ];
  }
  return [
    item("add", t("hierarchy-menu-add-child"), "entity.add", { parent: id }),
    item("duplicate", t("hierarchy-menu-duplicate"), "entity.duplicate"),
    item("copy", t("hierarchy-menu-copy"), "entity.copy"),
    item("paste", t("hierarchy-menu-paste-child"), "entity.paste", { parent: id }),
    item("rename", t("hierarchy-menu-rename"), null),
    item("delete", t("hierarchy-menu-delete"), "entity.delete"),
    ...(kind === "instance" ? prefabItems(id, kind) : []),
    ...pluginItems(id),
  ];
}

/** The drop indicator of a drag: the row (null: the end of the roots) and the place. */
export interface DropMark {
  readonly target: string | null;
  readonly place: DropPlace;
}

/** The place of a drop on a row from the pointer height: the top quarter, the bottom quarter, or the middle. */
export function placeAt(offset: number, height: number): DropPlace {
  if (!(height > 0)) return "inside";
  if (offset < height / 4) return "before";
  return offset > (height * 3) / 4 ? "after" : "inside";
}

/** The entities that do not show: hidden in the document, under a hidden entity, or outside the solo set. */
export function dimmedEntities(doc: SceneDocument, view: SceneView): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(doc.entities)) {
    if (!isShown(doc, id)) for (const item of subtreeOf(doc.entities, id)) out.add(item);
  }
  const solo = soloEntities(doc, view);
  if (solo !== null) for (const id of Object.keys(doc.entities)) if (!solo.has(id)) out.add(id);
  return out;
}

/** The selection after a click on a row: the row alone; ⌘ or Ctrl adds or removes it; Shift gives a range. */
export function clickSelection(
  rows: readonly TreeRow[],
  now: readonly string[],
  anchor: string | null,
  id: string,
  keys: { readonly shift?: boolean; readonly toggle?: boolean },
): readonly string[] {
  if (keys.shift === true && anchor !== null) {
    const range = rowRange(rows, anchor, id);
    return keys.toggle === true ? [...new Set([...now, ...range])] : range;
  }
  if (keys.toggle === true) return now.includes(id) ? now.filter((item) => item !== id) : [...now, id];
  return [id];
}

/** The cells of the panel that a drag reads and writes. */
interface DragCells {
  readonly doc: Ref<SceneDocument>;
  readonly selected: Ref<readonly string[]>;
  readonly dragging: Ref<readonly string[]>;
  readonly drop: Ref<DropMark | null>;
}

/** The drag of rows: the moved entities, the drop mark, and the reparent command at the drop. */
function dragActions(
  cells: DragCells,
  run: (id: string, args: Readonly<Record<string, unknown>>) => Promise<boolean>,
  expand: (id: string) => void,
) {
  const { doc, selected, dragging, drop } = cells;
  /** The entities of a drag that starts on a row: the selection when the row is in it, else the row alone. */
  function startDrag(id: string): void {
    const ids = selected.value.includes(id) ? selected.value : [id];
    const order = treeOrder(doc.value);
    dragging.value = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  /** The pointer of a drag is over a row: true and a drop mark when the drop is good (no cycle, no prefab row). */
  function over(target: string | null, place: DropPlace): boolean {
    const prefabRow = target?.includes("/") === true;
    const good =
      !prefabRow && dragging.value.length > 0 && dropTarget(doc.value, dragging.value, target, place) !== null;
    drop.value = good ? { target, place } : null;
    return good;
  }

  /** The pointer leaves a row or the tree: no drop mark until the next drag over. */
  function clearMark(): void {
    drop.value = null;
  }

  function endDrag(): void {
    dragging.value = [];
    drop.value = null;
  }

  /** A drop on a row: the reparent command with the parent and the index of the drop. */
  async function dropOn(target: string | null, place: DropPlace): Promise<boolean> {
    const ids = dragging.value;
    const found = ids.length === 0 ? null : dropTarget(doc.value, ids, target, place);
    endDrag();
    if (found === null) return false;
    const parent = found.parent === null ? {} : { parent: found.parent };
    const done = await run("entity.reparent", { entity: ids.join(","), ...parent, index: found.index });
    if (done && found.parent !== null) expand(found.parent);
    return done;
  }

  return { startDrag, over, clearMark, endDrag, dropOn };
}

/** The actions of the keys of the tree, of the + menu and of an asset drop. */
function treeActions(parts: {
  readonly doc: Ref<SceneDocument>;
  readonly setCollapsed: (id: string, closed: boolean) => void;
  readonly click: (id: string, keys: { readonly shift?: boolean }) => void;
  readonly run: (id: string, args: Readonly<Record<string, unknown>>) => Promise<boolean>;
  readonly drag: ReturnType<typeof dragActions>;
}) {
  const { doc, setCollapsed, click, run, drag } = parts;
  return {
    /** The action of a key of the tree (treeKeys.ts); a move takes the selection when the row is in it. */
    async keyAction(action: TreeKeyAction): Promise<boolean> {
      if (action.kind === "move") {
        drag.startDrag(action.id);
        return drag.dropOn(action.target, action.place);
      }
      if (action.kind === "focus") click(action.id, { shift: action.extend });
      else setCollapsed(action.id, action.kind === "collapse");
      return true;
    },
    /** The + menu: an entity of a preset at the root of the scene. */
    create: (preset: string) => run(`entity.create.${preset}`, {}),
    /** An asset of the Project window that drops on a row (into it) or on the empty tree (at the root). */
    dropAsset(asset: string, target: string | null, place: DropPlace): Promise<boolean> {
      const parent =
        target === null ? null : place === "inside" ? target : (doc.value.entities[target]?.parent ?? null);
      if (parent !== null) setCollapsed(parent, false);
      return run("entity.add", { asset, ...(parent === null ? {} : { parent }) });
    },
  };
}

/** The cells of the panel that the context menu reads and writes. */
interface MenuCells {
  readonly menu: Ref<MenuState | null>;
  readonly selected: Ref<readonly string[]>;
  readonly editing: Ref<string | null>;
}

/** The actions of the context menu. */
function menuActions(
  cells: MenuCells,
  run: (id: string, args: Readonly<Record<string, unknown>>) => Promise<boolean>,
  click: (id: string) => void,
  openPrefab: (id: string) => boolean,
) {
  const { menu, selected, editing } = cells;
  return {
    /** Open the menu of a row (null: the empty tree); a row out of the selection becomes the selection. */
    openMenu(id: string | null, x: number, y: number): void {
      if (id !== null && !selected.value.includes(id)) click(id);
      menu.value = { id, x, y };
    },
    /** Run an action of the menu, then close the menu. */
    async choose(item: MenuItem): Promise<boolean> {
      const id = menu.value?.id ?? null;
      menu.value = null;
      if (item.command !== null) return run(item.command, item.args);
      if (item.key === "prefab-open" && id !== null) return openPrefab(id);
      if (id !== null) editing.value = id;
      return true;
    },
    closeMenu(): void {
      menu.value = null;
    },
  };
}

/** Open the prefab of a row; a refusal goes to the error of the panel. */
function openPrefabOf(port: HierarchyPort, error: Ref<string | null>, id: string): boolean {
  const reason = port.openPrefab === undefined ? t("hierarchy-no-prefab-tools") : port.openPrefab(id);
  error.value = reason;
  return reason === null;
}

export function createHierarchy(port: HierarchyPort) {
  const doc = shallowRef(port.doc());
  const view = shallowRef(port.view());
  const collapsed = ref<ReadonlySet<string>>(new Set());
  const query = ref("");
  const selected = shallowRef<readonly string[]>(port.selection.ids);
  const anchor = ref<string | null>(null);
  const editing = ref<string | null>(null);
  const error = ref<string | null>(null);
  const dragging = shallowRef<readonly string[]>([]);
  const drop = shallowRef<DropMark | null>(null);
  const menu = shallowRef<MenuState | null>(null);

  const rows = computed<TreeRow[]>(() => treeRows(doc.value, { collapsed: collapsed.value, query: query.value }));
  const dimmed = computed(() => dimmedEntities(doc.value, view.value));
  const locked = computed(() => lockedEntities(doc.value, view.value));
  const overrides = computed(() => overrideMarks(doc.value));

  port.listen(() => {
    doc.value = port.doc();
    view.value = port.view();
  });
  port.selection.listen((ids) => {
    selected.value = ids;
  });

  async function run(id: string, args: Readonly<Record<string, unknown>>): Promise<boolean> {
    error.value = null;
    try {
      await port.run(id, args);
      return true;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
      return false;
    }
  }

  function setCollapsed(id: string, closed: boolean): void {
    const next = new Set(collapsed.value);
    if (closed) next.add(id);
    else next.delete(id);
    collapsed.value = next;
  }

  /** A click on a row (clickSelection). A click with no Shift sets the anchor of the next Shift-click. */
  function click(id: string, keys: { readonly shift?: boolean; readonly toggle?: boolean } = {}): void {
    const next = clickSelection(rows.value, selected.value, anchor.value, id, keys);
    if (keys.shift !== true || anchor.value === null) anchor.value = id;
    port.selection.set(next);
  }

  const drag = dragActions({ doc, selected, dragging, drop }, run, (id) => setCollapsed(id, false));

  const menuActs = menuActions({ menu, selected, editing }, run, click, (id) => openPrefabOf(port, error, id));

  return {
    ...{ doc, view, rows, dimmed, locked, collapsed, query, selected, editing, error, dragging, drop, menu },
    overrides,
    ...menuActs,
    run,
    click,
    toggleExpand: (id: string) => setCollapsed(id, !collapsed.value.has(id)),
    /** Open the rename field of a row (double-click or F2). */
    startRename: (id: string) => {
      editing.value = id;
    },
    cancelRename: () => {
      editing.value = null;
    },
    async rename(id: string, name: string): Promise<boolean> {
      editing.value = null;
      const text = name.trim();
      if (text === "" || text === (doc.value.entities[id]?.name ?? id)) return false;
      return run("entity.rename", { entity: id, name: text });
    },
    toggle: (kind: RowToggle, id: string) => run(TOGGLE_COMMANDS[kind], { entity: id }),
    showAll: () => run("view.showAll", {}),
    ...{ ...drag, ...treeActions({ doc, setCollapsed, click, run, drag }) },
  };
}

export type HierarchyState = ReturnType<typeof createHierarchy>;

export const HIERARCHY_KEY: InjectionKey<HierarchyState> = Symbol("hierarchy");

/** The hierarchy state of the panel (inside the panel only). */
export function useHierarchy(): HierarchyState {
  const state = inject(HIERARCHY_KEY);
  if (state === undefined) throw new Error("no hierarchy state");
  return state;
}
