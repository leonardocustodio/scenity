// SPDX-License-Identifier: Apache-2.0
/**
 * The editor settings: the snaps, the view mode, the speeds of the editor camera, the dock, the count of recent scenes
 * and more groups. Two documents of the kind `scenity.editor/1` give the values: the file of the project
 * (`scenity.editor.json`, shared through Git) and the document of the user (the browser storage). The render group
 * holds the options of the render. Each setting has a scope. For a project setting (the snaps), the project file wins
 * over the user. For a personal setting (the view, the camera, the dock, the recent count), the user wins over the
 * project. A value that neither document gives comes from the defaults. No DOM, no Vue.
 */
import {
  EDITOR_SETTINGS_FORMAT,
  EDITOR_VIEW_MODES,
  RENDER_ASSETS,
  RENDER_BACKENDS,
  RENDER_TIERS,
  type EditorSettingsDocument,
  type EditorViewMode,
} from "@scenity/scene/schema/editor";

/** The settings of the editor with each value. */
export interface EditorSettings {
  readonly snaps: { readonly grid: number; readonly angleDegrees: number; readonly scale: number };
  readonly view: { readonly mode: EditorViewMode; readonly grid: boolean };
  readonly camera: {
    readonly flySpeed: number;
    readonly flyFastSpeed: number;
    readonly lookSpeed: number;
    readonly lookFastSpeed: number;
    readonly orbitSpeed: number;
    readonly zoomSpeed: number;
  };
  readonly dock: { readonly tab: string; readonly height: number };
  readonly layout: { readonly workspace: string };
  readonly recent: { readonly count: number };
  /** The options of the render of the scene page (a URL parameter wins over them). */
  readonly render: {
    readonly tier: (typeof RENDER_TIERS)[number];
    readonly backend: (typeof RENDER_BACKENDS)[number];
    readonly worker: boolean;
    readonly gpuTimer: boolean;
    readonly assets: (typeof RENDER_ASSETS)[number];
    readonly audio: boolean;
  };
  /** The autosave of the project (off by default). */
  readonly autosave: { readonly enabled: boolean; readonly seconds: number };
  /** The usage log of a usability study (off by default). It never leaves the browser. */
  readonly usage: { readonly log: boolean };
  /** The name of the person on the notes and the replies of a team ("" for none). */
  readonly notes: { readonly author: string };
}

/** The defaults: the values that apply when no document gives a value. */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  snaps: { grid: 0.01, angleDegrees: 15, scale: 0.1 },
  view: { mode: "lit", grid: true },
  camera: { flySpeed: 1.5, flyFastSpeed: 3.5, lookSpeed: 1.2, lookFastSpeed: 2.6, orbitSpeed: 1, zoomSpeed: 1 },
  dock: { tab: "assets", height: 15 },
  layout: { workspace: "layout" },
  recent: { count: 8 },
  render: { tier: "high", backend: "webgl", worker: true, gpuTimer: false, assets: "auto", audio: true },
  autosave: { enabled: false, seconds: 30 },
  usage: { log: false },
  notes: { author: "" },
};

/** The scope of a setting: "project" (the project file wins) or "user" (the user document wins). */
export type SettingScope = "project" | "user";

/** A path of one setting: `<group>.<name>`, for example `snaps.grid`. */
export type SettingPath = {
  [G in keyof EditorSettings]: `${G & string}.${keyof EditorSettings[G] & string}`;
}[keyof EditorSettings];

/** One setting as a settings panel shows it. */
export interface SettingField {
  readonly path: SettingPath;
  readonly label: string;
  readonly scope: SettingScope;
  readonly type: "number" | "boolean" | "enum" | "string";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly values?: readonly string[];
}

/** The settings in the order of the panel, with their scopes and their limits (the limits of the schema). */
export const SETTING_FIELDS: readonly SettingField[] = [
  {
    path: "snaps.grid",
    label: "Grid snap",
    scope: "project",
    type: "number",
    min: 0.001,
    max: 100,
    step: 0.001,
    unit: "m",
  },
  {
    path: "snaps.angleDegrees",
    label: "Angle snap",
    scope: "project",
    type: "number",
    min: 0.1,
    max: 180,
    step: 0.1,
    unit: "°",
  },
  { path: "snaps.scale", label: "Scale snap", scope: "project", type: "number", min: 0.001, max: 10, step: 0.001 },
  { path: "view.mode", label: "View mode", scope: "user", type: "enum", values: EDITOR_VIEW_MODES },
  { path: "view.grid", label: "Grid", scope: "user", type: "boolean" },
  {
    path: "camera.flySpeed",
    label: "Fly speed",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 100,
    step: 0.1,
    unit: "m/s",
  },
  {
    path: "camera.flyFastSpeed",
    label: "Fly speed (Shift)",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 100,
    step: 0.1,
    unit: "m/s",
  },
  {
    path: "camera.lookSpeed",
    label: "Turn speed",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 20,
    step: 0.1,
    unit: "rad/s",
  },
  {
    path: "camera.lookFastSpeed",
    label: "Turn speed (Shift)",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 20,
    step: 0.1,
    unit: "rad/s",
  },
  {
    path: "camera.orbitSpeed",
    label: "Orbit speed",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 10,
    step: 0.1,
    unit: "×",
  },
  {
    path: "camera.zoomSpeed",
    label: "Zoom speed",
    scope: "user",
    type: "number",
    min: 0.1,
    max: 10,
    step: 0.1,
    unit: "×",
  },
  { path: "dock.tab", label: "Default bottom panel", scope: "user", type: "string" },
  {
    path: "dock.height",
    label: "Default bottom height",
    scope: "user",
    type: "number",
    min: 8,
    max: 60,
    step: 0.5,
    unit: "rem",
  },
  { path: "layout.workspace", label: "Default workspace", scope: "project", type: "string" },
  { path: "recent.count", label: "Recent scenes", scope: "user", type: "number", min: 1, max: 50, step: 1 },
  { path: "render.tier", label: "Quality tier", scope: "user", type: "enum", values: RENDER_TIERS },
  { path: "render.backend", label: "Backend", scope: "user", type: "enum", values: RENDER_BACKENDS },
  { path: "render.worker", label: "Render worker", scope: "user", type: "boolean" },
  { path: "render.gpuTimer", label: "GPU timer", scope: "user", type: "boolean" },
  { path: "render.assets", label: "Assets", scope: "user", type: "enum", values: RENDER_ASSETS },
  { path: "render.audio", label: "Audio", scope: "user", type: "boolean" },
  { path: "autosave.enabled", label: "Autosave", scope: "project", type: "boolean" },
  { path: "usage.log", label: "Usage log", scope: "user", type: "boolean" },
  { path: "notes.author", label: "Your name in notes", scope: "user", type: "string" },
  {
    path: "autosave.seconds",
    label: "Autosave after",
    scope: "project",
    type: "number",
    min: 5,
    max: 600,
    step: 5,
    unit: "s",
  },
];

type Value = number | boolean | string;

/** The group and the name of a setting path. */
function partsOf(path: SettingPath): [keyof EditorSettings, string] {
  const [group, name] = path.split(".") as [keyof EditorSettings, string];
  return [group, name];
}

/** The value of a setting in a document, or undefined. */
export function documentValue(doc: EditorSettingsDocument | null | undefined, path: SettingPath): Value | undefined {
  const [group, name] = partsOf(path);
  const values = doc?.[group] as Readonly<Record<string, Value | undefined>> | undefined;
  return values?.[name];
}

/** The value of a setting in the resolved settings. */
export function settingValue(settings: EditorSettings, path: SettingPath): Value {
  const [group, name] = partsOf(path);
  const value = (settings[group] as Readonly<Record<string, Value | undefined>>)[name];
  if (value === undefined) throw new Error(`No setting "${path}".`);
  return value;
}

/** The field of a setting path. */
export function settingField(path: SettingPath): SettingField {
  const field = SETTING_FIELDS.find((item) => item.path === path);
  if (field === undefined) throw new Error(`No setting "${path}".`);
  return field;
}

/** Where the value of a setting comes from: the document that wins for its scope, or the defaults. */
export function settingSource(
  path: SettingPath,
  project: EditorSettingsDocument | null,
  user: EditorSettingsDocument | null,
): "project" | "user" | "default" {
  const order: ("project" | "user")[] =
    settingField(path).scope === "project" ? ["project", "user"] : ["user", "project"];
  const docs = { project, user };
  return order.find((source) => documentValue(docs[source], path) !== undefined) ?? "default";
}

/** The settings of the two documents and the defaults (see the module comment for the order). */
export function resolveSettings(
  project: EditorSettingsDocument | null,
  user: EditorSettingsDocument | null,
): EditorSettings {
  const defaults = DEFAULT_EDITOR_SETTINGS as unknown as Readonly<Record<string, Readonly<Record<string, Value>>>>;
  const out: Record<string, Record<string, Value>> = {};
  for (const [group, values] of Object.entries(defaults)) out[group] = { ...values };
  for (const field of SETTING_FIELDS) {
    const source = settingSource(field.path, project, user);
    if (source === "default") continue;
    const [group, name] = partsOf(field.path);
    const value = documentValue(source === "project" ? project : user, field.path);
    const target = out[group];
    if (value !== undefined && target !== undefined) target[name] = value;
  }
  return out as unknown as EditorSettings;
}

/** An empty editor settings document. */
export function emptySettings(): EditorSettingsDocument {
  return { format: EDITOR_SETTINGS_FORMAT };
}

/**
 * The document with a new value of a setting. `undefined` removes the value (the other document or the defaults then
 * apply). A group with no remaining value goes out of the document. Thus the file keeps only the changes.
 */
export function withSetting(
  doc: EditorSettingsDocument | null,
  path: SettingPath,
  value: Value | undefined,
): EditorSettingsDocument {
  const [group, name] = partsOf(path);
  const base = doc ?? emptySettings();
  const old = Object.entries((base[group] ?? {}) as Readonly<Record<string, Value>>).filter(([key]) => key !== name);
  const kept: [string, Value][] = value === undefined ? old : [...old, [name, value]];
  const values = Object.fromEntries(kept);
  const rest: [string, unknown][] = Object.entries(base).filter(([key]) => key !== group);
  const next = Object.fromEntries(kept.length === 0 ? rest : [...rest, [group, values]]);
  return next as EditorSettingsDocument;
}

/** Why a value cannot be the value of a setting, or null for a good value. */
export function settingProblem(path: SettingPath, value: Value): string | null {
  const field = settingField(path);
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} is a number.`;
    if (path === "recent.count" && !Number.isInteger(value)) return `${field.label} is a whole number.`;
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
      return `${field.label} is from ${String(field.min)} to ${String(field.max)}.`;
    }
    return null;
  }
  if (field.type === "boolean") return typeof value === "boolean" ? null : `${field.label} is on or off.`;
  if (field.type === "enum") {
    return field.values?.includes(String(value)) === true
      ? null
      : `${field.label} is one of ${field.values?.join(", ") ?? ""}.`;
  }
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value)
    ? null
    : `${field.label} is an ID (small letters, digits and "-").`;
}
