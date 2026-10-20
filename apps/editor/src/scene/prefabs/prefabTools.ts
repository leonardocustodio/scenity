// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab tools of the scene page in the edit mode: the actions that the inspector, the hierarchy panel and the
 * asset browser share, and the script API.
 *
 * - Open a prefab: the page goes to the prefab mode of the prefab file (`scene=<path>.prefab.json&from=<scene>`): the
 *   same editor tools edit the prefab document, and Save writes it through the canonical writer. A page with changes
 *   that are not saved does not open the prefab (the prefab set is not in the local draft).
 * - Apply and revert: the commands `prefab.apply` and `prefab.revert` of the page (one step of the history each).
 * - In the prefab mode, the file bar has a breadcrumb: the scene of the URL (`from`: a press returns to it) and the
 *   prefab.
 *
 * The texts are Fluent messages of `src/i18n/en-US/prefab.ftl`.
 */
import { instancePrefabPath, type PrefabSet } from "@scenity/editor-core";
import type { PrefabReportEntry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import type { ScenePageEditor } from "../sceneEditor";
import { t } from "../../texts";
import { isPrefabPath, prefabUrl } from "./pagePrefabs";

/** The prefab actions of the page. */
export interface PrefabActions {
  /** The project path of the prefab of an instance (or of the instance of a prefab entity), or undefined. */
  pathOf(id: string): string | undefined;
  /** Open a prefab file in the prefab mode of the page. The reason of a refusal, or null. */
  openPath(path: string): string | null;
  /** Open the prefab of an instance (or of the instance of a prefab entity). The reason of a refusal, or null. */
  open(id: string): string | null;
  /** Run `prefab.apply`, `prefab.revert` or `prefab.unpack`; the reason of a refusal, or null. */
  run(
    command: "prefab.apply" | "prefab.revert" | "prefab.unpack",
    args: Readonly<Record<string, string>>,
  ): Promise<string | null>;
}

/** The prefab part of the script API of the scene page. */
export interface PrefabApi {
  /** The expanded document, the prefab set and the problems of the expansion. */
  prefabs(): {
    readonly expanded: SceneDocument;
    readonly set: PrefabSet;
    readonly report: readonly PrefabReportEntry[];
  };
  /** Open the prefab of an instance in the prefab mode; the reason of a refusal, or null. */
  openPrefab(id: string): string | null;
}

const pageActions = new WeakMap<ScenePageEditor, PrefabActions>();

/** The prefab actions of an editor in the edit mode, or undefined. */
export function prefabActions(editor: ScenePageEditor): PrefabActions | undefined {
  return pageActions.get(editor);
}

/** The prefab part of the script API (empty without the edit mode). */
export function prefabApi(editor: ScenePageEditor): Partial<PrefabApi> {
  const actions = pageActions.get(editor);
  if (actions === undefined) return {};
  return {
    prefabs: () => {
      const expansion = editor.expander?.expansion(editor.doc, editor.prefabs);
      return { expanded: expansion?.doc ?? editor.doc, set: editor.prefabs, report: expansion?.report ?? [] };
    },
    openPrefab: (id) => actions.open(id),
  };
}

/**
 * The breadcrumb of the prefab mode in the file bar: the scene of the URL (`from`; a press returns to it, "Back to the
 * scene"), then the prefab. With no `from` the breadcrumb shows the prefab only.
 */
function breadcrumb(editor: ScenePageEditor, params: URLSearchParams): void {
  const bar = document.querySelector("#scene-bar");
  if (!isPrefabPath(editor.file.path) || bar === null) return;
  const from = params.get("from");
  const nav = document.createElement("nav");
  nav.className = "scene-breadcrumb";
  nav.dataset.testid = "prefab-breadcrumb";
  nav.setAttribute("aria-label", t("prefab-breadcrumb"));
  const name = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.(scene|prefab)\.json$/, "");
  if (from !== null) {
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = name(from);
    back.title = t("prefab-back-title", { path: from });
    back.dataset.testid = "prefab-back";
    back.setAttribute("aria-label", t("prefab-back"));
    back.setAttribute("translate", "no");
    back.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("scene", from);
      url.searchParams.delete("from");
      location.assign(url.toString());
    });
    const step = document.createElement("span");
    step.textContent = "▸";
    step.setAttribute("aria-hidden", "true");
    nav.append(back, step);
  }
  const current = document.createElement("span");
  current.textContent = name(editor.file.path);
  current.setAttribute("aria-current", "page");
  current.setAttribute("translate", "no");
  current.dataset.testid = "prefab-crumb";
  nav.append(current);
  bar.prepend(nav);
}

/** Make the prefab actions of an editor in the edit mode. */
export function startPrefabTools(
  editor: ScenePageEditor,
  commands: SceneCommands | undefined,
  params: URLSearchParams,
): PrefabActions {
  const paths = (): { docPath: string } => editor.expander?.paths ?? { docPath: editor.file.path };
  const openPath = (path: string): string | null => {
    if (editor.dirty) return t("prefab-save-first");
    location.assign(prefabUrl(location, path, editor.file.path));
    return null;
  };
  const actions: PrefabActions = {
    pathOf: (id) => instancePrefabPath(editor.doc, id.split("/")[0] ?? id, paths()),
    openPath,
    open(id) {
      const path = actions.pathOf(id);
      return path === undefined ? t("prefab-not-instance", { id }) : openPath(path);
    },
    async run(command, args) {
      if (commands === undefined) return t("prefab-no-commands");
      try {
        await commands.run(command, args);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  };
  pageActions.set(editor, actions);
  breadcrumb(editor, params);
  return actions;
}
