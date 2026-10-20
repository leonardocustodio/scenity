// SPDX-License-Identifier: Apache-2.0
/**
 * The drag and drop of Scenity (the shell half). In the app, the native drag and drop of Tauri is enabled. WKWebView
 * gives a file from Finder to the shell, and the web content gets no `drop` event and no `File`. Tauri sends the events
 * `tauri://drag-enter`, `tauri://drag-over`, `tauri://drag-drop` and `tauri://drag-leave` to the window, with the file
 * paths and the position of the pointer. This module:
 *
 * 1. listens to these events for the window of the page only (the target `WebviewWindow` with its label);
 * 2. finds the visible lab frame under the position, and the point in the frame (`labFrameAt`);
 * 3. keeps the path of the first file under a new drop ID (`shell-<n>`), and calls `importDropAt` with the drop ID,
 *    the file name and the point in the frame. The lab gives the drop point from its pick (a prop top, else the floor)
 *    and asks for the source and the licence, as in a browser;
 * 4. gives the path to the `import` handler (`take`), which sends it to the host in a JSON body
 *    (imports/importDrop.ts).
 *
 * The frame never gets the path. While a file is over the lab frame, the call `importDragHint` shows the hint of the
 * scene. **The position:** on macOS, wry gives the point of the pointer in points from the top left corner of the web
 * view. These points are the CSS pixels of the page at a zoom of 1. Tauri calls it a `PhysicalPosition`, but it is
 * not a physical position.
 *
 * In a browser, there are no Tauri internals. Nothing here runs, and the drop of the lab page is the browser path.
 */
import { isImportName } from "@scenity/workbench-host/protocol";
import { windowLabel, type CloseWindowHost } from "../host/closeWindow";
import { frameName } from "../surfaces/useSurface";
import { listenShell, shellFeature, type ShellWindow } from "./shell";

/** The feature of the shell whose windows give the drag and drop events (native.rs `DROP_PATHS`). */
export const DROP_FEATURE = "dropPaths";

/** The drag and drop events of Tauri 2 (`tauri://drag-*`). */
export const DRAG_EVENTS = {
  enter: "tauri://drag-enter",
  over: "tauri://drag-over",
  drop: "tauri://drag-drop",
  leave: "tauri://drag-leave",
} as const;

/** The most drop paths that the page keeps; the oldest goes first (a drop that the owner cancelled). */
export const KEPT_DROPS = 16;

/** A point of the page (CSS pixels from the top left corner of the web view). */
export interface WindowPoint {
  readonly x: number;
  readonly y: number;
}

/** A drag and drop event of the shell: the paths (only in `enter` and `drop`) and the position. */
export interface ShellDrag {
  readonly paths: readonly string[];
  readonly at: WindowPoint | null;
}

/** Read the payload of a drag and drop event (`{ paths?, position: { x, y } }`). */
export function readDrag(payload: unknown): ShellDrag {
  const value = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const paths = Array.isArray(value.paths)
    ? value.paths.filter((path): path is string => typeof path === "string" && path !== "")
    : [];
  const position = value.position as { x?: unknown; y?: unknown } | undefined;
  const x = position?.x;
  const y = position?.y;
  const at =
    typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  return { paths, at };
}

/** The base name of a path (`/` or `\` separators). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

/** The parts of a document that `labFrameAt` uses (a test gives a fake). */
export interface FrameDocument {
  elementFromPoint(x: number, y: number): Element | null;
}

/**
 * The point in the visible lab frame (CSS pixels of the frame page) under a point of the page, or null. The
 * lab frame is the visible frame of the scene surface `scene` (null: no scene surface).
 */
export function labFrameAt(doc: FrameDocument, at: WindowPoint, scene: string | null): WindowPoint | null {
  if (scene === null) return null;
  const element = doc.elementFromPoint(at.x, at.y);
  if (element?.tagName !== "IFRAME" || element.getAttribute("data-frame") !== frameName(scene, "visible")) return null;
  const box = element.getBoundingClientRect();
  return { x: at.x - box.left - element.clientLeft, y: at.y - box.top - element.clientTop };
}

/** The answer of the lab to `importDropAt` (apps/editor `DropAtResult`), or the error of the call. */
export type DropAnswer =
  | { readonly point: readonly number[] | null; readonly on: string | null }
  | { readonly refused: string }
  | { readonly error: string };

export interface ShellDropDeps {
  /** A call into the visible lab frame. */
  call(call: string, args: readonly unknown[]): Promise<unknown>;
  /** The point in the visible lab frame under a point of the page, or null. */
  frameAt(at: WindowPoint): WindowPoint | null;
}

export interface ShellDrop {
  /** A drag over the window (`enter`, `over`) or out of it (`leave`, null). */
  drag(at: WindowPoint | null): void;
  /** A drop. Null when the drop is not on the lab frame or has no file. */
  drop(event: ShellDrag): Promise<{ readonly drop: string; readonly answer: DropAnswer } | null>;
  /** The path of a drop, once; null for an unknown drop. */
  take(drop: string): string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createShellDrop(deps: ShellDropDeps): ShellDrop {
  /** The paths of the drops, by drop ID, in the order of the drops. */
  const paths = new Map<string, string>();
  let count = 0;
  /** The last hint state that the lab got. */
  let hint = false;

  function drag(at: WindowPoint | null): void {
    const over = at !== null && deps.frameAt(at) !== null;
    if (over === hint) return;
    hint = over;
    deps.call("importDragHint", [over]).catch(() => undefined);
  }

  return {
    drag,
    async drop(event) {
      drag(null);
      const path = event.paths[0];
      const inFrame = event.at === null ? null : deps.frameAt(event.at);
      if (path === undefined || inFrame === null) return null;
      count += 1;
      const drop = `shell-${String(count)}`;
      const name = baseName(path);
      // The lab refuses another format with its own text; the page keeps no path for it.
      if (isImportName(name)) {
        paths.set(drop, path);
        while (paths.size > KEPT_DROPS) paths.delete(paths.keys().next().value ?? "");
      }
      let answer: DropAnswer;
      try {
        answer = (await deps.call("importDropAt", [{ drop, name, x: inFrame.x, y: inFrame.y }])) as DropAnswer;
      } catch (error) {
        answer = { error: errorText(error) };
      }
      if ("refused" in answer || "error" in answer) paths.delete(drop);
      return { drop, answer };
    },
    take(drop) {
      const path = paths.get(drop) ?? null;
      paths.delete(drop);
      return path;
    },
  };
}

/**
 * Listen to the drag and drop events of the window of the page. Give the stop function, or null in a browser or in a
 * shell without the feature.
 */
export async function listenShellDrop(
  drop: ShellDrop,
  from: ShellWindow & CloseWindowHost = globalThis as ShellWindow & CloseWindowHost,
): Promise<(() => void) | null> {
  const label = windowLabel(from);
  if (label === null || !shellFeature(DROP_FEATURE, from)) return null;
  const target = { kind: "WebviewWindow", label } as const;
  const stops = await Promise.all([
    listenShell(DRAG_EVENTS.enter, (payload) => drop.drag(readDrag(payload).at), from, target),
    listenShell(DRAG_EVENTS.over, (payload) => drop.drag(readDrag(payload).at), from, target),
    listenShell(DRAG_EVENTS.leave, () => drop.drag(null), from, target),
    listenShell(DRAG_EVENTS.drop, (payload) => void drop.drop(readDrag(payload)), from, target),
  ]);
  return () => {
    for (const stop of stops) stop?.();
  };
}
