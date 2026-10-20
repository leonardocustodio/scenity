// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schemas of the two documents of the editor settings:
 *
 * - `scenity.editor/1`: the editor settings. A project keeps its settings in `scenity.editor.json` beside
 *   `scenity.project.json`, and each user keeps a document of the same kind in the browser storage. Each value is
 *   optional: a missing value comes from the other document or from the defaults of the editor.
 * - `scenity.keymap/1`: the key map of a user. It gives the keys of a command ID in place of the default keys of the
 *   command. An empty list removes all keys of the command.
 *
 * They are not document kinds of `readDocument` (the scene documents of a player): `readEditorDocument` reads them, so
 * a player build holds no part of them. The JSON Schemas are in `schema/editor.schema.json` and `keymap.schema.json`.
 *
 * The documents give angles in radians. The angle snap is a value of the editor UI only, so it is in degrees, as the
 * gizmo bar shows it. Its name says so (`angleDegrees`).
 */
import { z } from "zod";
import { zodErrors, type DocError } from "../errors";

export const EDITOR_SETTINGS_FORMAT = "scenity.editor/1";
export const KEYMAP_FORMAT = "scenity.keymap/1";

/** The file name of the editor settings of a project, at the root of the project folder. */
export const EDITOR_SETTINGS_FILE = "scenity.editor.json";

/** The quality tiers, the backends and the origins of the assets of the render settings. */
export const RENDER_TIERS = ["ultra", "high", "medium", "low"] as const;
export const RENDER_BACKENDS = ["webgl", "webgpu"] as const;
export const RENDER_ASSETS = ["auto", "build", "source"] as const;

/** The view modes of the viewport of the editor. */
export const EDITOR_VIEW_MODES = ["lit", "unlit", "wireframe", "normals"] as const;
export type EditorViewMode = (typeof EDITOR_VIEW_MODES)[number];

/**
 * The text of one key with its modifiers in a fixed order: `Mod` (⌘ on macOS, Ctrl on other systems), `Alt`, `Shift`,
 * then the key. A key is a capital letter, a digit, a punctuation sign or a named key (for example `Mod+Shift+Z`,
 * `F2`, `Delete`, `Shift+,`).
 */
export const KEY_CHORD =
  /^(Mod\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|[,./;'[\]\\`=-]|Space|Enter|Escape|Tab|Delete|Backspace|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F[1-9]|F1[0-2])$/;

export const keyChordSchema = z.string().regex(KEY_CHORD, "a key is [Mod+][Alt+][Shift+]<key>, for example Mod+S");

/** A command ID: dot-separated words (the form of `COMMAND_ID` of `@scenity/editor-core`). */
export const commandIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/, "a command ID is dot-separated words, for example view.frame");

const positive = (max: number) => z.number().positive().max(max);

export const editorSettingsSchema = z.strictObject({
  format: z.literal(EDITOR_SETTINGS_FORMAT),
  /** The steps of the snaps of the gizmos and of the entity drag. */
  snaps: z
    .strictObject({
      /** The grid step of a move (m). */
      grid: positive(100).optional(),
      /** The step of a turn (degrees: a value of the editor UI). */
      angleDegrees: positive(180).optional(),
      /** The step of a scale (a factor). */
      scale: positive(10).optional(),
    })
    .optional(),
  /** The view of the viewport when a scene opens. */
  view: z
    .strictObject({
      mode: z.enum(EDITOR_VIEW_MODES).optional(),
      grid: z.boolean().optional(),
    })
    .optional(),
  /** The speeds of the editor camera. */
  camera: z
    .strictObject({
      /** The fly speed (m/s), and with Shift. */
      flySpeed: positive(100).optional(),
      flyFastSpeed: positive(100).optional(),
      /** The turn speed of the arrow keys (radians per second), and with Shift. */
      lookSpeed: positive(20).optional(),
      lookFastSpeed: positive(20).optional(),
      /** The factors of the orbit of a drag and of the zoom of the wheel (1: the default speed). */
      orbitSpeed: z.number().min(0.1).max(10).optional(),
      zoomSpeed: z.number().min(0.1).max(10).optional(),
    })
    .optional(),
  /** The bottom area of a new layout of the editor window (a workspace with no stored layout). */
  dock: z
    .strictObject({
      /** The ID of the tab that shows (`assets`, `sequence`, `rules`, `material`, `settings`, or a panel ID). */
      tab: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/)
        .optional(),
      /** The height of the bottom area (rem). */
      height: z.number().min(8).max(60).optional(),
    })
    .optional(),
  /** The workspace that the editor window opens with when the person has no workspace. */
  layout: z
    .strictObject({
      workspace: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/)
        .optional(),
    })
    .optional(),
  /** The count of recent scenes that the start screen and the scene switcher keep. */
  recent: z.strictObject({ count: z.number().int().min(1).max(50).optional() }).optional(),
  /**
   * The options of the render of the scene page: the quality tier, the backend, the render worker, the GPU timer, the
   * origin of the assets and the audio. A URL parameter has priority over each value.
   */
  render: z
    .strictObject({
      tier: z.enum(RENDER_TIERS).optional(),
      backend: z.enum(RENDER_BACKENDS).optional(),
      worker: z.boolean().optional(),
      gpuTimer: z.boolean().optional(),
      assets: z.enum(RENDER_ASSETS).optional(),
      audio: z.boolean().optional(),
    })
    .optional(),
  /** The name of the person on the notes and the replies of a team. */
  notes: z.strictObject({ author: z.string().max(80).optional() }).optional(),
  /** A log of the use of the editor for a usability study, in the browser only (off by default). */
  usage: z.strictObject({ log: z.boolean().optional() }).optional(),
  /** The autosave of the project: a save of the open scene after the given seconds with no edit. */
  autosave: z
    .strictObject({
      enabled: z.boolean().optional(),
      seconds: z.number().int().min(5).max(600).optional(),
    })
    .optional(),
});
export type EditorSettingsDocument = z.infer<typeof editorSettingsSchema>;

export const keymapDocumentSchema = z.strictObject({
  format: z.literal(KEYMAP_FORMAT),
  /** The keys of each command that the user changed: they replace the default keys of the command. */
  keys: z.record(commandIdSchema, z.array(keyChordSchema).max(8)),
});
export type KeymapDocument = z.infer<typeof keymapDocumentSchema>;

/** The result of a read of an editor document. */
export type EditorReadResult<D> =
  { readonly ok: true; readonly doc: D } | { readonly ok: false; readonly errors: readonly DocError[] };

/**
 * Read an editor settings document (`editor`) or a key map (`keymap`) from its text. Each error names the JSON Pointer
 * of the bad value, as the reader of the scene documents does. The documents have version 1 only: a newer major is an
 * error.
 */
export function readEditorDocument(text: string, kind: "editor"): EditorReadResult<EditorSettingsDocument>;
export function readEditorDocument(text: string, kind: "keymap"): EditorReadResult<KeymapDocument>;
export function readEditorDocument(
  text: string,
  kind: "editor" | "keymap",
): EditorReadResult<EditorSettingsDocument | KeymapDocument> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = `the file is not JSON: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, errors: [{ path: "", message }] };
  }
  const parsed = (kind === "editor" ? editorSettingsSchema : keymapDocumentSchema).safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  return { ok: true, doc: parsed.data };
}
