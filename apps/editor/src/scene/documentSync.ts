// SPDX-License-Identifier: Apache-2.0
/**
 * The document sync of an editor window of the studio. After each change of the open scene (a drag at its end), the
 * window sends the ops of the change (`docOps` of `@scenity/editor-core`) over the socket of the studio. The host gives
 * them to the other windows of the scene, and the ops of an agent with no window come the same way. A window applies
 * the ops of another window as one step of its history. A change of the open scene (the scene switcher) starts the
 * sync again from that scene. The windows of a scene share their selection and their saves. A save of one window is
 * the base of the others, so they show the same dirty state.
 *
 * The host gives the changes of a scene one order (studio-host `documentLog.ts`) and answers each change of this
 * window with its version (`doc.version` with `ack`). The messages of the host come in its order, so a change of
 * another window comes after the `ack` of each change of this window that the host had before it. The changes with
 * no `ack` yet came after it at the host: the window puts them again after the other change (one step), so each
 * window has the values of the order of the host.
 */
import { docOps } from "@scenity/editor-core";
import { writeDocument } from "@scenity/scene";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { t } from "../texts";
import type { ScenePageEditor } from "./sceneEditor";

/** A message of a window on the socket of the studio: a change of the scene, a save, or the selection. */
export type WindowMessage =
  | {
      readonly type: "doc.ops";
      readonly project: string;
      readonly path: string;
      readonly ops: readonly SceneOp[];
      readonly title?: string;
      /** The text and the hash that the host wrote (a run of an agent with no window), or absent. */
      readonly saved?: { readonly text: string; readonly hash: string };
      /** The version of the change at the host. */
      readonly version?: number;
    }
  | {
      readonly type: "doc.version";
      readonly project: string;
      readonly path: string;
      readonly version: number;
      /** True for the answer to a change of this window; false or absent for the version at a `hello`. */
      readonly ack?: boolean;
    }
  | {
      readonly type: "window.saved";
      readonly project: string;
      readonly path: string;
      readonly text: string;
      readonly hash: string;
    }
  | {
      readonly type: "window.selection";
      readonly project: string;
      readonly path: string;
      readonly ids: readonly string[];
    };

/** The types of the messages of the windows. */
export const WINDOW_MESSAGES: ReadonlySet<string> = new Set([
  "doc.ops",
  "doc.version",
  "window.saved",
  "window.selection",
]);

let sender: ((message: object) => void) | null = null;
let receiver: ((message: WindowMessage) => void) | null = null;

/** The studio bridge gives its send function (null: the socket is closed). */
export function setDocumentSender(send: ((message: object) => void) | null): void {
  sender = send;
}

/** The studio bridge gives a message of the socket. */
export function receiveWindowMessage(message: WindowMessage): void {
  receiver?.(message);
}

/** The parts of the window that the sync reads. */
export interface WindowSyncParts {
  readonly editor: ScenePageEditor;
  readonly project: string;
  readonly selection?: {
    readonly ids: readonly string[];
    set(ids: readonly string[]): void;
    listen(fn: (ids: readonly string[]) => void): () => void;
  };
}

/** A save of another window: the base of this window when its scene has the same text (it is not dirty then). */
function takeSaved(editor: ScenePageEditor, text: string, hash: string): void {
  if (writeDocument(editor.doc) !== text) return;
  editor.file.saved(text, hash);
  editor.changed();
}

/** Start the sync of the open scene of a window; the result stops it. */
export function startDocumentSync(parts: WindowSyncParts): () => void {
  const { editor, project, selection } = parts;
  let synced: { path: string; doc: SceneDocument } = { path: editor.file.path, doc: editor.doc };
  /** The changes of this window that the host did not answer yet, in their order. */
  let pending: (readonly SceneOp[])[] = [];
  let remote = false;
  const mine = (message: WindowMessage): boolean => message.project === project && message.path === editor.file.path;
  const applyOps = (message: Extract<WindowMessage, { type: "doc.ops" }>): void => {
    remote = true;
    try {
      // The changes of another window pass the lock of a viewer.
      const reason = editor.channel.remote(() =>
        editor.apply([...message.ops], message.title ?? t("sync-remote-title")),
      );
      if (reason !== null) console.warn(`doc.ops: ${reason}`);
      // The changes of this window with no answer came after this change at the host: they go again after it.
      const again = pending.flat();
      const refused = again.length === 0 ? null : editor.apply(again, t("sync-again-title"));
      if (refused !== null) console.warn(`doc.ops: ${refused}`);
    } finally {
      remote = false;
      synced = { path: editor.file.path, doc: editor.doc };
    }
    if (message.saved !== undefined) takeSaved(editor, message.saved.text, message.saved.hash);
  };
  receiver = (message) => {
    if (!mine(message)) return;
    if (message.type === "doc.version") {
      // An answer removes the oldest change. The version at a `hello` (a new socket) starts with no change.
      pending = message.ack === true ? pending.slice(1) : [];
    } else if (message.type === "doc.ops" && message.ops.length > 0) applyOps(message);
    else if (message.type === "window.saved") takeSaved(editor, message.text, message.hash);
    else if (message.type === "window.selection" && selection !== undefined) {
      remote = true;
      selection.set(message.ids);
      remote = false;
    }
  };
  const send = (message: object): void => sender?.({ project, path: editor.file.path, ...message });
  const stops = [
    editor.listen((doc) => {
      if (remote || editor.channel.live) return;
      const path = editor.file.path;
      if (path !== synced.path || sender === null) {
        pending = [];
        synced = { path, doc };
        return;
      }
      const ops = docOps(synced.doc, doc, editor.registry);
      synced = { path, doc };
      if (ops === null) console.warn("doc.ops: the change gives no ops; the other windows keep their scene.");
      else if (ops.length > 0) {
        pending = [...pending, ops];
        send({ type: "doc.ops", ops });
      }
    }),
    editor.listenSaved((text, hash) => send({ type: "window.saved", text, hash })),
    ...(selection === undefined ? [] : [selection.listen((ids) => remote || send({ type: "window.selection", ids }))]),
  ];
  return () => {
    for (const stop of stops) stop();
    receiver = null;
  };
}
