// SPDX-License-Identifier: Apache-2.0
/**
 * The editor settings, the key map and the dock layout in the edit mode of the scene page. This module is the one
 * call of editMode.ts. It reads the settings file of the project (pageSettings.ts) and applies the layout of the
 * project to the page (pageLayout.ts). It gives the snaps of the settings to the gizmos and the entity drag. It
 * registers the page commands of the file bar (⌘S, ⌘Z, ⇧⌘Z, the play mode) in the key map (pageKeys.ts). It also
 * gives the settings tab of the dock (a lazy chunk with Vue). The script API changes a key and a setting as the tab
 * does.
 */
import type { KeyConflict, SettingPath, SettingScope } from "@scenity/editor-core";
import type { KeymapDocument } from "@scenity/scene/schema/editor";
import type { DockTab } from "../assetDock/dockTab";
import type { TransformSettings } from "../gizmo/gizmoSettings";
import type { PagePlay } from "../play/pagePlay";
import type { ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { t } from "../../texts";
import { pageKeys, type KeyCommandInfo, type PageKeyCommandSpec } from "./pageKeys";
import { pageLayout, type PageLayout } from "./pageLayout";
import { pageSettings, type SettingsInfo } from "./pageSettings";

/** The parts of the page that the settings read. */
export interface EditorSettingsParts {
  readonly project: string;
  readonly files: SceneFilePort;
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  /** The settings of the gizmos and the entity drag (the snaps). */
  readonly transform: TransformSettings;
  /** The play mode of the page (the command `play.toggle`). */
  readonly play?: PagePlay | undefined;
}

/** The current key map, for the script API and the tests. */
export interface KeymapInfo {
  readonly commands: readonly KeyCommandInfo[];
  readonly conflicts: readonly KeyConflict[];
  readonly user: KeymapDocument | null;
}

/** The settings part of the script API of the scene page. */
export interface SettingsApi {
  keymap(): KeymapInfo;
  /** Give a command new keys in the key map of the user (`null`: the default keys). The result is the command. */
  setKeys(id: string, keys: readonly string[] | null): KeyCommandInfo | null;
  editorSettings(): SettingsInfo;
  /** Set a setting (`undefined`: remove it) in its document or in `target`. The result is a refusal reason, or null. */
  setEditorSetting(
    path: SettingPath,
    value: number | boolean | string | undefined,
    target?: SettingScope,
  ): Promise<string | null>;
  /** The dock and panel layout of the project. */
  pageLayout(): PageLayout;
}

/** The editors of the page with the settings started. */
const started = new WeakSet<ScenePageEditor>();

/** The current key map. */
export function keymapInfo(): KeymapInfo {
  const keys = pageKeys();
  return { commands: keys.infos(), conflicts: keys.keyMap().conflicts(), user: pageSettings().keymap };
}

/** Give a command new keys. The result is the changed command, or null for an unknown command. */
export function setCommandKeys(id: string, keys: readonly string[] | null): KeyCommandInfo | null {
  const page = pageKeys();
  if (!page.commands().some((command) => command.id === id)) return null;
  pageSettings().setKeys(id, keys, page.keyMap().defaultsOf(id));
  return page.infos().find((info) => info.id === id) ?? null;
}

/** Apply the snaps of the settings to the transform settings. A value changes only when the settings change it. */
function connectSnaps(transform: TransformSettings): void {
  let last: string | null = null;
  const apply = (): void => {
    const { grid, angleDegrees, scale } = pageSettings().value.snaps;
    const key = JSON.stringify([grid, angleDegrees, scale]);
    if (key === last) return;
    last = key;
    transform.set({ snaps: { grid, angle: angleDegrees, scale } });
  };
  apply();
  pageSettings().listen(apply);
}

/** The page commands of the file bar: the save, the undo and the redo, and the play mode. */
function fileCommands(parts: EditorSettingsParts): PageKeyCommandSpec[] {
  const { editor, play } = parts;
  const commands: PageKeyCommandSpec[] = [
    {
      id: "file.save",
      menu: "file",
      title: t("settings-command-save"),
      keys: ["Mod+S"],
      inText: true,
      run: () => void editor.save(),
    },
    {
      id: "history.undo",
      menu: "edit",
      title: t("settings-command-undo"),
      keys: ["Mod+Z"],
      repeat: true,
      inControls: true,
      run: () => editor.channel.undo(),
    },
    {
      ...{
        id: "history.redo",
        menu: "edit",
        title: t("settings-command-redo"),
        keys: ["Mod+Shift+Z"],
        repeat: true,
        inControls: true,
      },
      run: () => editor.channel.redo(),
    },
  ];
  if (play !== undefined) {
    commands.push({
      id: "play.toggle",
      title: t("settings-command-play"),
      // ⌘P toggles the play mode.
      keys: ["Mod+P"],
      inText: true,
      run: () => {
        if (play.active) play.stop();
        else {
          const reason = play.start();
          if (reason !== null) console.warn(`play.toggle: ${reason}`);
        }
      },
    });
  }
  return commands;
}

/** Start the settings, the key map and the layout of the project. The result is the settings tab of the dock. */
export function startEditorSettings(parts: EditorSettingsParts): Promise<DockTab | null> {
  started.add(parts.editor);
  void pageSettings().attach(parts.files);
  connectSnaps(parts.transform);
  pageKeys().register(fileCommands(parts));
  return import("./settingsTab").then((chunk) => chunk.settingsTab(parts.canvas));
}

/** The settings part of the script API (empty without the edit mode). */
export function settingsApi(editor: ScenePageEditor): Partial<SettingsApi> {
  if (!started.has(editor)) return {};
  return {
    keymap: keymapInfo,
    setKeys: setCommandKeys,
    editorSettings: () => pageSettings().info(),
    setEditorSetting: (path, value, target) => pageSettings().set(path, value, target),
    pageLayout: () => pageLayout().value,
  };
}
