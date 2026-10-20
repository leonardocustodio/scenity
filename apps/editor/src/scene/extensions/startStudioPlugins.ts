// SPDX-License-Identifier: Apache-2.0
/**
 * The studio faces of the project plugins in the editor window. The page loads them after its start and installs each
 * one (installStudioPlugin.ts) with the context of the page: the open scene, the selection, the commands, the panels
 * and the toasts. An error of a face or of one of its contributions goes into the Console with the source "plugin" (so
 * Problems shows it too), and the editor continues to work. Safe mode (`safe=1`) loads no
 * studio face.
 */
import { projectSettingsStore } from "./projectPluginSettings";
import type { StudioEntityView } from "../../studio/extensions/api";
import {
  installStudioPlugin,
  type InstallResult,
  type StudioPageContext,
} from "../../studio/extensions/installStudioPlugin";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { pageConsole } from "../console/consoleStore";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSelectionPort } from "../inspector/startInspector";
import { pageKeys } from "../settings/pageKeys";
import { pagePoints } from "./pagePoints";

/** The parts of the page for the studio faces. */
export interface StudioPluginParts {
  readonly shell: Pick<StudioShell, "registry" | "setPanel" | "showPanel" | "notices" | "status">;
  readonly project: string;
  readonly editor: ScenePageEditor;
  readonly selection?: PageSelectionPort;
  /** The canvas of the Scene view (the scene tools of the plugins take its pointer input). */
  readonly canvas?: HTMLCanvasElement;
  /** The faces of the project (the default export of each module); a test gives its own. */
  readonly load?: () => Promise<unknown[]>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The context of the page for the contributions of the plugins. */
function pageContext(parts: StudioPluginParts): StudioPageContext {
  const { editor, selection, shell } = parts;
  return {
    project: parts.project,
    documents: {
      entities: (component) =>
        Object.entries(editor.doc.entities)
          .filter(([, entity]) => component === undefined || component in entity.components)
          .map(([id, entity]): StudioEntityView =>
            Object.freeze({ id, name: entity.name, components: entity.components }),
          ),
      listen: (listener) => editor.listen(() => listener()),
    },
    selection: {
      ids: () => selection?.ids ?? [],
      set: (ids) => selection?.set(ids),
      listen: (listener) => selection?.listen(listener) ?? (() => undefined),
    },
    commands: {
      run: async (id, args = {}) => {
        await pageKeys().execute(id, args);
      },
    },
    panels: { open: (id) => shell.showPanel(id) },
    notify: { toast: (title, text) => shell.notices.toast(title, text) },
  };
}

/** Load and install the studio faces of the project; the result has each install. */
export async function startStudioPlugins(parts: StudioPluginParts): Promise<InstallResult[]> {
  if (new URLSearchParams(location.search).get("safe") === "1") return [];
  const log = (text: string, detail: string | null = null, level: "error" | "warn" = "error"): void =>
    pageConsole().add({ level, source: "plugin", text, detail });
  let faces: unknown[];
  try {
    faces = await (parts.load ?? (async () => (await import("./studioFaces")).studioFaces(parts.project)))();
  } catch (error) {
    log(t("plugin-load-failed", { project: parts.project }), message(error));
    return [];
  }
  const host = {
    context: pageContext(parts),
    // The commands of the shell come from the panels at its start: a panel of a plugin gets its open command here.
    registerPanel: (spec: Parameters<StudioShell["registry"]["register"]>[0]) => {
      const stops = [
        parts.shell.registry.register(spec),
        pageKeys().register([
          {
            id: `panel.open.${spec.id}`,
            title: t("panel-open", { title: t(spec.title) }),
            agents: true,
            run: () => parts.shell.showPanel(spec.id),
          },
        ]),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    setPanel: (id: string, content: { component: unknown; props: Readonly<Record<string, unknown>> }) =>
      parts.shell.setPanel(id, content as Parameters<StudioShell["setPanel"]>[1]),
    registerCommands: (specs: Parameters<ReturnType<typeof pageKeys>["register"]>[0]) => pageKeys().register(specs),
    failed: (plugin: string, name: string, error: unknown) =>
      log(t("plugin-contribution-failed", { plugin, name }), message(error)),
    points: pagePoints(parts.shell, parts.editor, parts.canvas ?? null),
    projectSettings: (plugin: string) => projectSettingsStore(`/projects/${parts.project}/`, plugin),
  };
  const install = (list: readonly unknown[]): InstallResult[] =>
    list.map((face) => {
      const result = installStudioPlugin(face, host);
      if (result.error !== null) log(result.error);
      for (const warning of result.warnings) log(warning, null, "warn");
      return result;
    });
  let results = install(faces);
  if (parts.load === undefined) {
    // A hot update of a studio face: dispose each face, then activate the new ones (no reload).
    const { onStudioFacesChange, studioFaces } = await import("./studioFaces");
    onStudioFacesChange(() => {
      void studioFaces(parts.project).then((next) => {
        for (const result of results) result.dispose();
        results = install(next);
        log(t("plugin-reloaded", { count: next.length }), null, "warn");
      });
    });
  }
  return results;
}
