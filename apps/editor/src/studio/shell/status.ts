// SPDX-License-Identifier: Apache-2.0
/**
 * The status bar of the editor window. The items from left to right are `status.save`, `status.selection`,
 * `status.jobs`, `status.problems`, `status.agent`, `status.render` and `status.bell`. The page fills the values. A
 * press of an item with an action opens its panel, saves or frames. An item with no value does not show.
 */
import { markRaw, shallowReactive, type Ref } from "vue";

export interface SaveStatus {
  /** The state text of the file bar (saved, unsaved, saving, or an error). */
  readonly text: string;
  readonly dirty: boolean;
  readonly error: boolean;
}

export interface RenderStatus {
  readonly backend: string;
  readonly tier: string;
  /** The frames per second of the last frames, or null before the first ones. */
  readonly fps: number | null;
}

/** A fact that needs an action. The bell of the status bar keeps it. */
export interface BellFact {
  readonly id: number;
  readonly text: string;
}

export interface StatusValues {
  save: SaveStatus | null;
  selection: number | null;
  jobs: number | null;
  problems: { readonly fail: number; readonly warn: number } | null;
  agent: string | null;
  /** The count of the changes of agents that wait for review. */
  review: number | null;
  render: RenderStatus | null;
  bell: readonly BellFact[];
  /** The names of the steps that an undo and a redo change (null: none). The value is null with no history. */
  history: { readonly undo: string | null; readonly redo: string | null } | null;
}

export type StatusItem = Exclude<keyof StatusValues, "bell" | "history"> | "bell";

/** The status of one window: the values and the action of each item. */
export class WindowStatus {
  readonly values = shallowReactive<StatusValues>({
    save: null,
    selection: null,
    jobs: null,
    problems: null,
    agent: null,
    review: null,
    render: null,
    bell: [],
    history: null,
  });
  readonly #actions = shallowReactive(new Map<StatusItem, () => void>());
  /** The ID of the command that the press of an item runs. */
  readonly #commands = shallowReactive(new Map<StatusItem, string>());
  /** The runner of the command of a press of a custom item (the page sets it). */
  runCommand: ((id: string) => void) | null = null;
  #next = 1;

  constructor() {
    markRaw(this);
  }

  set<K extends keyof StatusValues>(item: K, value: StatusValues[K]): void {
    this.values[item] = value;
  }

  /** The action of an item (a press of it) and the ID of its command; the result takes it away. */
  onPress(item: StatusItem, action: () => void, command?: string): () => void {
    this.#actions.set(item, action);
    if (command === undefined) this.#commands.delete(item);
    else this.#commands.set(item, command);
    return () => {
      if (this.#actions.get(item) !== action) return;
      this.#actions.delete(item);
      this.#commands.delete(item);
    };
  }

  /** The ID of the command of an item, or undefined. */
  commandOf(item: StatusItem): string | undefined {
    return this.#commands.get(item);
  }

  action(item: StatusItem): (() => void) | undefined {
    return this.#actions.get(item);
  }

  /** Keep a fact that needs an action under the bell; the result takes it away. */
  remember(text: string): () => void {
    const fact: BellFact = { id: this.#next++, text };
    this.values.bell = [...this.values.bell, fact];
    return () => this.forget(fact.id);
  }

  forget(id: number): void {
    this.values.bell = this.values.bell.filter((fact) => fact.id !== id);
  }

  /** The items of the plugins (the `statusItems` point of a studio face), in their order. */
  readonly custom = shallowReactive(new Map<string, CustomStatusItem>());

  /** Add an item of a plugin; the result takes it out. */
  addCustom(item: CustomStatusItem): () => void {
    this.custom.set(item.id, markRaw(item));
    return () => {
      if (this.custom.get(item.id)?.text === item.text) this.custom.delete(item.id);
    };
  }
}

/** An item of a plugin in the status bar: its current text, its title and the command of a press. */
export interface CustomStatusItem {
  readonly id: string;
  /** The current text. The bar reads it again after a change of `version`. */
  readonly text: () => string;
  readonly title?: () => string;
  readonly command?: string;
  /** The version of the text: a change of it shows the text again. */
  readonly version: Ref<number>;
}
