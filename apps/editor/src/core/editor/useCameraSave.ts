// SPDX-License-Identifier: Apache-2.0
/**
 * "Save camera" and the camera bookmarks of the lab page:
 *
 * - **The current camera** for the commands `camera.*`: the view of the focused pane, else of the main camera
 *   (useLabCamera.ts `current`), the named cameras and the bookmarks.
 * - **The host path of `camera.save`**: in the workbench, the source op goes to the host as the bridge event `camera`.
 *   The host runs `labs camera-save` (a run of the Runs tab: the dry run, then the write) and answers with
 *   `cameraResult`. A lab page without the workbench keeps the run as a pending run and shows its command to copy.
 * - **The bookmarks**: views by name in the URL (`views=`, cameraBookmarks.ts). They are a view setting, not an input
 *   of a frame.
 *
 * The script API (`globalThis.__room3dLab`) gets `cameraResult(value)` (the answer of the host) and `bookmarks()`.
 */
import { computed, ref, shallowRef, type ComputedRef, type InjectionKey, type Ref } from "vue";
import { cameraNames, parseView } from "../cameras";
import { CAMERA_SAVE_TOOL } from "../cameraNames";
import { installApi } from "../edit/useEditPanel";
import type { LabCamera } from "../useLabCamera";
import { bookmarksText, parseBookmarks, withBookmark, BOOKMARKS_PARAM, type CameraBookmark } from "./cameraBookmarks";
import type { BookmarkHost, CameraNow } from "./commandKit";
import type { PendingRun } from "./ops";
import type { CommandRunner, SourceRoute } from "./useCommands";
import type { Editor } from "./useEditor";
import { t } from "../../texts";

/** A save of a camera as the View tab shows it: the run of the host, or the command for a lab page without a host. */
export interface CameraSaveView {
  readonly name: string;
  readonly dry: boolean;
  readonly replace: boolean;
  /** "running", then the status of the run ("passed", "failed", …). "copy" in a lab page without the workbench. */
  readonly status: string;
  readonly output: string;
  /** The ID of the run of the host, or null. */
  readonly run: string | null;
  /** The command for a terminal in the repo root. */
  readonly command: string;
  /** The doc line of the save, or null. */
  readonly doc: string | null;
}

export interface CameraSave {
  /** The last save: the run of the host, else the pending run of a lab page without the workbench. */
  readonly result: ComputedRef<CameraSaveView | null>;
  readonly bookmarks: Ref<readonly CameraBookmark[]>;
  readonly route: SourceRoute;
  readonly host: BookmarkHost;
  now(): CameraNow;
}

/** The parts of the lab page that the View tab uses for "Save camera" (Room3DLab.vue provides them). */
export interface CameraSaveContext {
  readonly runner: CommandRunner;
  readonly save: CameraSave;
}

export const CAMERA_SAVE: InjectionKey<CameraSaveContext> = Symbol("camera-save");

/** The methods of the script API. */
export interface LabCameraSaveApi {
  /** The host gives the answer of a camera save. */
  cameraResult(value: unknown): void;
  /** The camera bookmarks of the URL. */
  bookmarks(): CameraBookmark[];
}

/** A save of a run of `labs camera-save`, before the answer of the host. */
function viewOf(run: PendingRun, status: string): CameraSaveView {
  const { args } = run;
  return {
    name: typeof args.name === "string" ? args.name : "",
    dry: args.dry !== false,
    replace: args.replace === true,
    status,
    output: "",
    run: null,
    command: typeof args.command === "string" ? args.command : "",
    doc: typeof args.doc === "string" ? args.doc : null,
  };
}

/** The save with the answer of the host (`cameraResult` of the bridge), or null when there is no valid answer. */
export function cameraAnswer(save: CameraSaveView | null, value: unknown): CameraSaveView | null {
  if (save === null || typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.status !== "string" || typeof item.output !== "string") return null;
  return { ...save, status: item.status, output: item.output, run: typeof item.run === "string" ? item.run : null };
}

function keepBookmarks(list: readonly CameraBookmark[]): void {
  const url = new URL(globalThis.location.href);
  const text = bookmarksText(list);
  if (text === "") url.searchParams.delete(BOOKMARKS_PARAM);
  else url.searchParams.set(BOOKMARKS_PARAM, text);
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

export function useCameraSave(parts: {
  readonly camera: Pick<LabCamera, "current" | "openView">;
  readonly editor: Pick<Editor, "pending">;
  /** True in a frame of the workbench (the bridge is active). */
  readonly inWorkbench: () => boolean;
  readonly params: URLSearchParams;
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}): CameraSave {
  const sent = ref<CameraSaveView | null>(null);
  const bookmarks = shallowRef<readonly CameraBookmark[]>(parseBookmarks(parts.params.get(BOOKMARKS_PARAM)));
  // In a lab page without the workbench, the newest pending run of `labs camera-save` shows its command.
  const waiting = computed(() => parts.editor.pending.value.filter((run) => run.tool === CAMERA_SAVE_TOOL).at(-1));
  const result = computed(() => {
    const run = waiting.value;
    return parts.inWorkbench() || run === undefined ? sent.value : viewOf(run, "copy");
  });
  const route: SourceRoute = {
    tool: CAMERA_SAVE_TOOL,
    inWorkbench: parts.inWorkbench,
    send(run) {
      const save = viewOf(run, "running");
      sent.value = save;
      const view = typeof run.args.view === "string" ? run.args.view : "";
      if (parseView(view) === null) {
        sent.value = { ...save, status: "failed", output: t("palette-camera-no-view") };
        return;
      }
      const doc = save.doc === null ? {} : { doc: save.doc };
      globalThis.__workbench?.emit({
        event: "camera",
        name: save.name,
        view,
        dry: save.dry,
        replace: save.replace,
        ...doc,
      });
    },
  };
  const host: BookmarkHost = {
    bookmark(name) {
      bookmarks.value = withBookmark(bookmarks.value, name, parts.camera.current());
      keepBookmarks(bookmarks.value);
      return bookmarksText(bookmarks.value.filter((item) => item.name === name));
    },
    recall(name) {
      const item = bookmarks.value.find((entry) => entry.name === name);
      if (item === undefined) return false;
      parts.camera.openView(item.view);
      return true;
    },
  };
  if (parts.api !== false) {
    const api: LabCameraSaveApi = {
      cameraResult: (value) => {
        sent.value = cameraAnswer(sent.value, value) ?? sent.value;
      },
      bookmarks: () => structuredClone([...bookmarks.value]),
    };
    installApi(api);
  }
  return {
    result,
    bookmarks,
    route,
    host,
    now: () => ({
      view: parts.camera.current(),
      names: cameraNames(),
      bookmarks: bookmarks.value.map((item) => item.name),
    }),
  };
}
