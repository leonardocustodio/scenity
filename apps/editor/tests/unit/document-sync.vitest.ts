// SPDX-License-Identifier: Apache-2.0
// The document sync of an editor window: the host orders the changes of a scene and answers each change of the window
// (`ack`). A change of another window can come before the answer to a change of this window. Then that change was
// first at the host, and the window puts its own change again after it. Thus the window has the value of the host
// order.
import { applyOps, builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import {
  receiveWindowMessage,
  setDocumentSender,
  startDocumentSync,
  type WindowMessage,
} from "../../src/scene/documentSync";
import type { ScenePageEditor } from "../../src/scene/sceneEditor";

const registry = builtinRegistry();
const PATH = "scenes/main.scene.json";
const SCENE = {
  format: "scenity.scene/1",
  id: "main",
  entities: { lamp: { name: "Lamp", parent: null, index: 0, components: { transform: { position: [1, 0, 0] } } } },
};

/** A fake editor of one scene: `apply` makes a step and tells the listeners. */
function fakeEditor() {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error("bad scene");
  let doc: SceneDocument = read.doc;
  const listeners = new Set<(doc: SceneDocument) => void>();
  const steps: string[] = [];
  const editor = {
    get doc() {
      return doc;
    },
    registry,
    channel: { live: false, remote: <T>(work: () => T): T => work() },
    file: { path: PATH, saved: () => undefined },
    changed: () => undefined,
    listen: (fn: (doc: SceneDocument) => void) => (listeners.add(fn), () => listeners.delete(fn)),
    listenSaved: () => () => undefined,
    apply: (ops: SceneOp[], title: string): string | null => {
      const result = applyOps(doc, ops, registry);
      if (!result.ok) return result.reason;
      doc = result.doc;
      steps.push(title);
      for (const fn of listeners) fn(doc);
      return null;
    },
  };
  return { editor: editor as unknown as ScenePageEditor, steps, value: () => placeX(doc) };
}

/** The x of the place of the lamp. */
function placeX(doc: SceneDocument): unknown {
  return (doc.entities.lamp?.components.transform as { position?: number[] } | undefined)?.position?.[0];
}

const set = (x: number): SceneOp[] => [
  { op: "set", path: "/entities/lamp/components/transform/position", value: [x, 0, 0] },
];
const message = (body: object): WindowMessage => ({ project: "room", path: PATH, ...body }) as WindowMessage;

describe("the document sync of a window", () => {
  it("puts its change with no answer again after a change of another window", () => {
    const sent: Record<string, unknown>[] = [];
    setDocumentSender((item) => sent.push(item as Record<string, unknown>));
    const { editor, steps, value } = fakeEditor();
    const stop = startDocumentSync({ editor, project: "room" });
    receiveWindowMessage(message({ type: "doc.version", version: 0 }));
    // This window sets x = 2; before its answer, the change of another window (5) comes: it was first at the host.
    expect(editor.apply(set(2), "Set")).toBeNull();
    expect(sent.at(-1)).toMatchObject({ type: "doc.ops", project: "room", path: PATH });
    receiveWindowMessage(message({ type: "doc.ops", ops: set(5), version: 1 }));
    // The host order is 5, then 2: the window has x = 2.
    expect(value()).toBe(2);
    expect(steps).toEqual(["Set", "A change from another window", "Your change, after the change of another window"]);
    // The answer removes the change from the queue. The next change of another window stays.
    receiveWindowMessage(message({ type: "doc.version", version: 2, ack: true }));
    receiveWindowMessage(message({ type: "doc.ops", ops: set(7), version: 3 }));
    expect(value()).toBe(7);
    expect(steps).toHaveLength(4);
    // The changes of the sync are not sent again.
    expect(sent.filter((item) => item.type === "doc.ops")).toHaveLength(1);
    stop();
    setDocumentSender(null);
  });

  it("forgets the changes with no answer at a new hello (a new socket)", () => {
    const sent: Record<string, unknown>[] = [];
    setDocumentSender((item) => sent.push(item as Record<string, unknown>));
    const { editor, value } = fakeEditor();
    const stop = startDocumentSync({ editor, project: "room" });
    expect(editor.apply(set(2), "Set")).toBeNull();
    receiveWindowMessage(message({ type: "doc.version", version: 4 }));
    receiveWindowMessage(message({ type: "doc.ops", ops: set(5), version: 5 }));
    expect(value()).toBe(5);
    stop();
    setDocumentSender(null);
  });
});
