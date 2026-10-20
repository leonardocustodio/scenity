// SPDX-License-Identifier: Apache-2.0
/**
 * The editor settings of the scene page. The settings of a project are a separate document, `scenity.editor.json`
 * (`scenity.editor/1`), adjacent to `scenity.project.json`. Thus `scenity.project.json` stays as the owner wrote it,
 * and the host, the build and the check read it with no change. The settings are not in `.scenity/`, because Git
 * ignores that folder (it holds the imports and the build cache of one machine). Also, the dev server writes no
 * hidden path. The editor writes the settings file of the project through the save of the scene files (the canonical
 * writer, an atomic write, the conflict check).
 *
 * The settings of a user (`scenity.editor/1`) and the key map of a user (`scenity.keymap/1`) are in the browser
 * storage, the same for each project. For the snaps, the settings file of the project has priority. For the personal
 * settings, the user has priority (`resolveSettings` of `@scenity/editor-core`). The page has one settings store
 * (`pageSettings()`). A page with no edit mode reads only the user documents.
 */
import {
  readUserKeymap,
  readUserSettings,
  resolveSettings,
  settingField,
  settingProblem,
  withKeys,
  withSetting,
  writeUserKeymap,
  writeUserSettings,
  type EditorSettings,
  type SettingPath,
  type SettingScope,
} from "@scenity/editor-core";
import { writeDocument } from "@scenity/scene";
import {
  EDITOR_SETTINGS_FILE,
  readEditorDocument,
  type EditorSettingsDocument,
  type KeymapDocument,
} from "@scenity/scene/schema/editor";
import type { SceneFilePort } from "../sceneFiles";
import { t } from "../../texts";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem"> | null;
type Value = number | boolean | string;

/** The browser storage, or null when the browser blocks it. */
export function browserStorage(): Storage {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The current settings documents and the resolved settings of the page. */
export interface SettingsInfo {
  readonly settings: EditorSettings;
  readonly project: EditorSettingsDocument | null;
  readonly user: EditorSettingsDocument | null;
  readonly keymap: KeymapDocument | null;
  /** True after the read of the settings file of the project (immediately true for a page with no files port). */
  readonly loaded: boolean;
  /** The path of the settings file of the project in the project folder. */
  readonly file: string;
}

/** The settings store of one page. */
export class PageSettings {
  #project: EditorSettingsDocument | null = null;
  #hash: string | null = null;
  #user: EditorSettingsDocument | null;
  #keymap: KeymapDocument | null;
  #value: EditorSettings;
  #files: Pick<SceneFilePort, "read" | "save"> | null = null;
  #loaded = true;
  readonly #listeners = new Set<(settings: EditorSettings) => void>();

  constructor(private readonly storage: Storage) {
    this.#user = readUserSettings(storage);
    this.#keymap = readUserKeymap(storage);
    this.#value = resolveSettings(null, this.#user);
  }

  get value(): EditorSettings {
    return this.#value;
  }

  get keymap(): KeymapDocument | null {
    return this.#keymap;
  }

  info(): SettingsInfo {
    return {
      settings: this.#value,
      project: this.#project,
      user: this.#user,
      keymap: this.#keymap,
      loaded: this.#loaded,
      file: EDITOR_SETTINGS_FILE,
    };
  }

  /** Read and write the settings file of the project through the files port of the edit mode. */
  attach(files: Pick<SceneFilePort, "read" | "save">): Promise<void> {
    this.#files = files;
    this.#loaded = false;
    return this.load();
  }

  /** Read the settings file of the project. A missing file or a file that does not parse gives no project values. */
  async load(): Promise<void> {
    if (this.#files === null) return;
    try {
      const file = await this.#files.read(EDITOR_SETTINGS_FILE);
      const read = readEditorDocument(file.text, "editor");
      this.#project = read.ok ? read.doc : null;
      this.#hash = read.ok ? file.hash : null;
      if (!read.ok) console.warn(`${EDITOR_SETTINGS_FILE} does not read: ${read.errors[0]?.message ?? ""}`);
    } catch {
      // No file: the project has no settings of its own yet.
      this.#project = null;
      this.#hash = null;
    }
    this.#loaded = true;
    this.#changed();
  }

  /**
   * Set a setting (`undefined`: remove it) in the document of its scope, or of `target`. A project value goes to the
   * settings file of the project. The result is the reason of a refusal, or null.
   */
  async set(path: SettingPath, value: Value | undefined, target?: SettingScope): Promise<string | null> {
    if (value !== undefined) {
      const problem = settingProblem(path, value);
      if (problem !== null) return problem;
    }
    const scope = target ?? settingField(path).scope;
    if (scope === "user") {
      this.#user = withSetting(this.#user, path, value);
      writeUserSettings(this.storage, this.#user);
      this.#changed();
      return null;
    }
    return this.#saveProject((doc) => withSetting(doc, path, value));
  }

  /** Set the keys of a command in the key map of the user (`null`: use the defaults again). */
  setKeys(id: string, keys: readonly string[] | null, defaults: readonly string[]): KeymapDocument {
    this.#keymap = withKeys(this.#keymap, id, keys, defaults);
    writeUserKeymap(this.storage, this.#keymap);
    this.#changed();
    return this.#keymap;
  }

  /** Replace the key map of the user (an import, or no keys for the default keys of each command). */
  setKeymap(keymap: KeymapDocument): void {
    this.#keymap = keymap;
    writeUserKeymap(this.storage, keymap);
    this.#changed();
  }

  /** Call `listener` after each change of the settings or the key map. The result stops it. */
  listen(listener: (settings: EditorSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Write the settings file of the project with a change. After a conflict, read it and apply the change one time. */
  async #saveProject(
    change: (doc: EditorSettingsDocument | null) => EditorSettingsDocument,
    again = true,
  ): Promise<string | null> {
    if (this.#files === null) return t("settings-refuse-no-file");
    const text = writeDocument(change(this.#project));
    const result = await this.#files.save({ path: EDITOR_SETTINGS_FILE, text, baseHash: this.#hash });
    if (result.ok) {
      const read = readEditorDocument(result.text, "editor");
      this.#project = read.ok ? read.doc : null;
      this.#hash = result.hash;
      this.#changed();
      return null;
    }
    if (result.conflict && again) {
      await this.load();
      return this.#saveProject(change, false);
    }
    return result.conflict ? t("settings-refuse-changed", { file: EDITOR_SETTINGS_FILE }) : result.reason;
  }

  #changed(): void {
    this.#value = resolveSettings(this.#project, this.#user);
    for (const listener of this.#listeners) listener(this.#value);
  }
}

let current: PageSettings | null = null;

/** The settings store of the page (one store for each page). */
export function pageSettings(): PageSettings {
  current ??= new PageSettings(browserStorage());
  return current;
}
