// SPDX-License-Identifier: Apache-2.0
/**
 * The presets of the person in the editor window. The browser storage keeps them (`userPresets.ts` of
 * `@scenity/editor-core`), so each project of the person has them. The scene commands get a create command for each
 * entity preset (Entity ▸ Create) and an apply command for each preset; the inspector card menu lists the presets of
 * its component. The page commands `preset.save` and `preset.remove` change the list; a save from the menu asks the
 * person for a name.
 */
import {
  CommandError,
  makeUserPreset,
  readUserPresets,
  userPresetCommands,
  writeUserPresets,
  type UserPreset,
} from "@scenity/editor-core";
import { shallowRef, type ShallowRef } from "vue";
import { currentShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import { textOrAsk } from "../projects/fileCommands";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageKeyCommandSpec } from "../settings/pageKeys";

type Args = Readonly<Record<string, unknown>>;

/** The text of an argument ("" when it is not a text). */
const textOf = (args: Args, name: string): string => (typeof args[name] === "string" ? args[name] : "");

/** The browser storage, or null when the page has none. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export class PagePresets {
  readonly list: ShallowRef<readonly UserPreset[]> = shallowRef(readUserPresets(storage()));
  readonly #commands: Pick<SceneCommands, "extend">;
  #remove: () => void = () => undefined;

  constructor(commands: Pick<SceneCommands, "extend">) {
    this.#commands = commands;
    this.#sync();
  }

  /** The presets of one component (the card menu of the inspector lists them). */
  of(component: string): UserPreset[] {
    return this.list.value.filter((preset) => preset.component === component);
  }

  /** Keep a new preset of an entity, or of one component of it. */
  save(doc: ScenePageEditor["doc"], entity: string, name: string, component?: string): UserPreset {
    const preset = makeUserPreset(doc, entity, name, this.list.value, component);
    this.#write([...this.list.value, preset]);
    return preset;
  }

  remove(id: string): boolean {
    const next = this.list.value.filter((preset) => preset.id !== id);
    if (next.length === this.list.value.length) return false;
    this.#write(next);
    return true;
  }

  #write(presets: readonly UserPreset[]): void {
    if (!writeUserPresets(storage(), presets)) throw new CommandError(t("preset-not-kept"));
    this.list.value = presets;
    this.#sync();
  }

  /** Put the commands of the presets in the scene commands. */
  #sync(): void {
    this.#remove();
    const { create, apply } = userPresetCommands(this.list.value);
    this.#remove = this.#commands.extend([...create, ...apply]);
  }
}

/** What the page commands of the presets read. */
export interface PresetCommandParts {
  readonly presets: PagePresets;
  readonly editor: ScenePageEditor;
  readonly selection: () => readonly string[];
}

/** The page commands `preset.save` and `preset.remove`. */
export function presetCommands(parts: PresetCommandParts): PageKeyCommandSpec[] {
  const arg = (name: string) => ({ type: "string" as const, description: t(`preset-arg-${name}`), optional: true });
  return [
    {
      id: "preset.save",
      menu: "component",
      title: t("preset-command-save"),
      agents: true,
      args: { entity: arg("entity"), component: arg("component"), name: arg("name") },
      run: async (given: Args) => {
        const entity = textOf(given, "entity") || parts.selection()[0];
        if (entity === undefined) throw new CommandError(t("preset-no-entity"));
        const component = textOf(given, "component") || undefined;
        const notices = currentShell()?.notices;
        const ask = { title: t("preset-ask-title"), label: t("preset-ask-label") };
        const name = notices === undefined ? textOf(given, "name") : await textOrAsk(notices, given, "name", ask);
        if (name === null) throw new CommandError(t("preset-ask-cancelled"));
        return parts.presets.save(parts.editor.doc, entity, name, component).id;
      },
    },
    {
      id: "preset.remove",
      title: t("preset-command-remove"),
      agents: true,
      args: { preset: { ...arg("preset"), optional: false } },
      run: (given: Args) => {
        if (!parts.presets.remove(textOf(given, "preset"))) throw new CommandError(t("preset-none"));
      },
    },
  ];
}

/** The presets of the page (none before the edit mode starts them). */
const current = shallowRef<PagePresets | null>(null);

export function pagePresets(): PagePresets | null {
  return current.value;
}

export function setPagePresets(presets: PagePresets | null): void {
  current.value = presets;
}
