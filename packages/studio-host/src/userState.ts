// SPDX-License-Identifier: Apache-2.0
/**
 * The user state of the studio: the preferences, the layouts, the key map, the registry of
 * projects and the trust list, as JSON files of the studio state folder. Every browser of the machine sees the same
 * state; browser storage is only a cache. `importBrowserState` moves the `scenity.*` keys of the browser into the
 * files once.
 */
import { join } from "node:path";
import { z } from "zod";
import { JsonFile } from "./store";

const THEMES = ["dark", "light", "navy"] as const;

export const preferencesSchema = z.object({
  format: z.literal("scenity.studio-preferences/1"),
  theme: z.enum(THEMES),
  contrast: z.enum(["standard", "more"]),
  locale: z.string().min(2).max(16),
  recentCount: z.number().int().min(1).max(50),
  autosave: z.boolean(),
  firstRunDone: z.boolean(),
  /** The user settings of the editor (`@scenity/editor-core` settings of the user scope), by key. */
  editor: z.record(z.string(), z.unknown()),
  agent: z.object({
    mode: z.enum(["ask", "review", "auto"]),
    model: z.string().optional(),
    effort: z.string().optional(),
    budgetUsd: z.number().min(0),
    /** The value per kind of action (scene, files, runs, imports, network, git): allow, ask or deny. */
    kinds: z.record(z.string(), z.enum(["allow", "ask", "deny"])).optional(),
  }),
  /** The browser keys that `importBrowserState` moved, so each key moves once. */
  importedKeys: z.array(z.string()),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export function defaultPreferences(): Preferences {
  return {
    format: "scenity.studio-preferences/1",
    theme: "dark",
    contrast: "standard",
    locale: "en-US",
    recentCount: 8,
    autosave: false,
    firstRunDone: false,
    editor: {},
    agent: { mode: "review", budgetUsd: 5 },
    importedKeys: [],
  };
}

/** The layouts of the docks: one opaque value per scope (`*` for every project, else a project key). */
export const layoutsSchema = z.object({
  format: z.literal("scenity.studio-layouts/1"),
  scopes: z.record(z.string(), z.unknown()),
});
export type Layouts = z.infer<typeof layoutsSchema>;

/** The key map of the person: a `scenity.keymap/1` document (a command ID → its keys). */
export const keymapSchema = z.object({
  format: z.literal("scenity.keymap/1"),
  keys: z.record(z.string(), z.array(z.string())),
});
export type Keymap = z.infer<typeof keymapSchema>;

export const registryEntrySchema = z.object({
  /** The project folder (absolute). */
  dir: z.string().min(1),
  /** The key of the project in the studio (the project ID, then `-2`, `-3` for a second project with that ID). */
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  lastOpened: z.string(),
  pinned: z.boolean(),
});
export type RegistryEntry = z.infer<typeof registryEntrySchema>;

export const registrySchema = z.object({
  format: z.literal("scenity.studio-registry/1"),
  projects: z.array(registryEntrySchema),
});
export type Registry = z.infer<typeof registrySchema>;

export const trustSchema = z.object({ format: z.literal("scenity.studio-trust/1"), trusted: z.array(z.string()) });
export type Trust = z.infer<typeof trustSchema>;

/** The JSON files of the user state in the studio state folder. */
export class UserState {
  readonly preferences: JsonFile<Preferences>;
  readonly layouts: JsonFile<Layouts>;
  readonly keymap: JsonFile<Keymap>;
  readonly registry: JsonFile<Registry>;
  readonly trust: JsonFile<Trust>;

  constructor(readonly dir: string) {
    this.preferences = new JsonFile(join(dir, "preferences.json"), preferencesSchema, defaultPreferences);
    this.layouts = new JsonFile(join(dir, "layouts.json"), layoutsSchema, () => ({
      format: "scenity.studio-layouts/1" as const,
      scopes: {},
    }));
    this.keymap = new JsonFile(join(dir, "keymap.json"), keymapSchema, () => ({
      format: "scenity.keymap/1" as const,
      keys: {},
    }));
    this.registry = new JsonFile(join(dir, "registry.json"), registrySchema, () => ({
      format: "scenity.studio-registry/1" as const,
      projects: [],
    }));
    this.trust = new JsonFile(join(dir, "trust.json"), trustSchema, () => ({
      format: "scenity.studio-trust/1" as const,
      trusted: [],
    }));
  }
}

/** The browser keys of the editor that the studio state replaces (apps/editor `scene/settings`, `projects`). */
const EDITOR_USER_KEY = "scenity.editor.user";
const KEYMAP_KEY = "scenity.keymap.user";
const LAYOUT_PREFIX = "scenity.scene.layout.";

function parsed(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Move the `scenity.*` keys of a browser into the user state, once per key: the editor user settings, the key map and
 * the page layout of each project. The function skips a key that the state already took. Returns the keys that moved.
 */
export function importBrowserState(state: UserState, entries: Readonly<Record<string, string>>): string[] {
  const done = new Set(state.preferences.read().importedKeys);
  const moved: string[] = [];
  const editor = parsed(entries[EDITOR_USER_KEY]);
  if (!done.has(EDITOR_USER_KEY) && editor !== null && typeof editor === "object") {
    state.preferences.update((p) => ({ ...p, editor: { ...(editor as Record<string, unknown>), ...p.editor } }));
    moved.push(EDITOR_USER_KEY);
  }
  const keymap = keymapSchema.safeParse(parsed(entries[KEYMAP_KEY]));
  if (!done.has(KEYMAP_KEY) && keymap.success) {
    state.keymap.update((k) => ({ ...k, keys: { ...keymap.data.keys, ...k.keys } }));
    moved.push(KEYMAP_KEY);
  }
  for (const [key, text] of Object.entries(entries)) {
    if (!key.startsWith(LAYOUT_PREFIX) || done.has(key)) continue;
    const layout = parsed(text);
    if (layout === undefined) continue;
    const scope = `legacy:${key.slice(LAYOUT_PREFIX.length)}`;
    state.layouts.update((l) => ({ ...l, scopes: { [scope]: layout, ...l.scopes } }));
    moved.push(key);
  }
  if (moved.length > 0) state.preferences.update((p) => ({ ...p, importedKeys: [...p.importedKeys, ...moved] }));
  return moved;
}
