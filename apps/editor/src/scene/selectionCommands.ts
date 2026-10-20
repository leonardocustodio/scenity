// SPDX-License-Identifier: Apache-2.0
/**
 * The selection tools of the editor window (the Edit menu): Select all (⌘A), Select none (⌘⇧A), Invert, Select
 * children, Back (⌘[) and Forward (⌘]) in the selection history, and Select by tag, by component or by kind (Edit ▸
 * Select by). Each tool is a command for a person, a script and an agent.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { WindowNotices } from "../studio/shell/dialogs";
import { t } from "../texts";
import type { PageSelectionPort } from "./inspector/startInspector";
import { textOrAsk } from "./projects/fileCommands";
import { pageKeys, SCENE_CONTEXT, type PageKeyCommandSpec } from "./settings/pageKeys";

/** The most selections of the history. */
export const SELECTION_HISTORY_MAX = 50;

/** The kinds of entity of Select by kind, and the component that makes each kind. */
export const ENTITY_KINDS: Readonly<Record<string, string>> = {
  model: "model",
  light: "light",
  camera: "camera",
  sound: "audioSource",
  note: "annotation",
};

/** The history of the selections: Back and Forward go through it. */
export class SelectionHistory {
  #stack: (readonly string[])[] = [];
  #at = -1;
  #moving = false;

  /** Keep a new selection (not a step of Back or Forward); this removes the forward steps. */
  push(ids: readonly string[]): void {
    if (this.#moving) return;
    const now = this.#stack[this.#at];
    if (now?.length === ids.length && now.every((id, index) => id === ids[index])) return;
    this.#stack = [...this.#stack.slice(0, this.#at + 1), [...ids]].slice(-SELECTION_HISTORY_MAX);
    this.#at = this.#stack.length - 1;
  }

  /** Go to the selection before (`step` -1) or after (+1) the current one; false at an end. */
  step(step: -1 | 1, set: (ids: readonly string[]) => void): boolean {
    const next = this.#stack[this.#at + step];
    if (next === undefined) return false;
    this.#at += step;
    this.#moving = true;
    try {
      set(next);
    } finally {
      this.#moving = false;
    }
    return true;
  }

  get canBack(): boolean {
    return this.#at > 0;
  }

  get canForward(): boolean {
    return this.#at < this.#stack.length - 1;
  }
}

/** The entities under some entities (not the entities themselves). */
export function descendants(doc: SceneDocument, ids: readonly string[]): string[] {
  const roots = new Set(ids);
  return Object.keys(doc.entities).filter((id) => {
    for (let at = doc.entities[id]?.parent ?? null, depth = 0; at !== null && depth < 1000; depth += 1) {
      if (roots.has(at)) return true;
      at = doc.entities[at]?.parent ?? null;
    }
    return false;
  });
}

/** The entities with a tag, a component, or a component of a kind. */
export function entitiesBy(doc: SceneDocument, by: "tag" | "component" | "kind", value: string): string[] {
  const component = by === "kind" ? ENTITY_KINDS[value] : value;
  return Object.entries(doc.entities)
    .filter(([, entity]) =>
      by === "tag" ? (entity.tags ?? []).includes(value) : component !== undefined && component in entity.components,
    )
    .map(([id]) => id);
}

/** What the commands read of the page. */
export interface SelectionParts {
  readonly doc: () => SceneDocument;
  readonly selection: PageSelectionPort;
  readonly notices: WindowNotices;
}

/** A command of Select by: the value from the arguments or from a question to the person. */
function selectBy(parts: SelectionParts, by: "tag" | "component" | "kind"): PageKeyCommandSpec {
  return {
    id: `selection.by${by[0]?.toUpperCase() ?? ""}${by.slice(1)}`,
    title: t(`selection-by-${by}`),
    menu: "edit/selectBy",
    agents: true,
    // The argument is optional: a person who runs the command from the menu gets a question for it.
    args: { [by]: { type: "string", description: `The ${by} of the entities to select.`, optional: true } },
    run: async (args) => {
      const label = t(`selection-by-${by}-label`);
      const value = await textOrAsk(parts.notices, args, by, { title: t(`selection-by-${by}`), label });
      if (value !== null) parts.selection.set(entitiesBy(parts.doc(), by, value));
    },
  };
}

/** The selection tools; `history` follows the selection of the page. */
export function selectionCommands(parts: SelectionParts, history: SelectionHistory): PageKeyCommandSpec[] {
  const { selection } = parts;
  const ids = (): string[] => Object.keys(parts.doc().entities);
  const none = (): string | null => (selection.ids.length === 0 ? t("selection-none") : null);
  const base = { keyContext: SCENE_CONTEXT, menu: "edit", agents: true } as const;
  return [
    { ...base, id: "selection.all", title: t("selection-all"), keys: ["Mod+A"], run: () => selection.set(ids()) },
    { ...base, id: "selection.none", title: t("selection-clear"), keys: ["Mod+Shift+A"], run: () => selection.set([]) },
    {
      ...base,
      id: "selection.invert",
      title: t("selection-invert"),
      run: () => selection.set(ids().filter((id) => !selection.ids.includes(id))),
    },
    {
      ...base,
      id: "selection.children",
      title: t("selection-children"),
      when: none,
      run: () => selection.set(descendants(parts.doc(), selection.ids)),
    },
    {
      ...base,
      id: "selection.back",
      title: t("selection-back"),
      keys: ["Mod+["],
      when: () => (history.canBack ? null : t("selection-history-start")),
      run: () => history.step(-1, (next) => selection.set(next)),
    },
    {
      ...base,
      id: "selection.forward",
      title: t("selection-forward"),
      keys: ["Mod+]"],
      when: () => (history.canForward ? null : t("selection-history-end")),
      run: () => history.step(1, (next) => selection.set(next)),
    },
    selectBy(parts, "tag"),
    selectBy(parts, "component"),
    selectBy(parts, "kind"),
  ];
}

/** Start the selection tools of a window: the history follows the selection. */
export function startSelectionTools(
  parts: Omit<SelectionParts, "selection">,
  selection: PageSelectionPort | undefined,
): void {
  if (selection === undefined) return;
  const history = new SelectionHistory();
  history.push(selection.ids);
  selection.listen((ids) => {
    history.push(ids);
  });
  pageKeys().register(selectionCommands({ ...parts, selection }, history));
}
