// SPDX-License-Identifier: Apache-2.0
// The lock of the scene channel: a viewer of the studio changes nothing. An edit throws an EditError with the reason,
// and undo and redo do nothing. A live drag returns to its start at its end. The changes of another window
// (`remote`) pass.
import { describe, expect, it } from "bun:test";
import { builtinRegistry, readDocument, type SceneDocument } from "@scenity/scene";
import { EditError, SceneChannel } from "../src/index";

const registry = builtinRegistry();
const SCENE = {
  format: "scenity.scene/1",
  id: "main",
  entities: { lamp: { name: "Lamp", parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } } },
};
const at = (x: number) => [
  { op: "set" as const, path: "/entities/lamp/components/transform/position", value: [x, 0, 0] },
];
const x = (doc: SceneDocument): unknown =>
  (doc.entities.lamp?.components.transform as { position: number[] }).position[0];

function channel(): SceneChannel<SceneDocument> {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error("bad scene");
  return new SceneChannel<SceneDocument>({ doc: read.doc, registry, patch: () => undefined });
}

describe("the lock of the scene channel", () => {
  it("refuses an edit with the reason, keeps the history, and takes a drag back", () => {
    const scene = channel();
    scene.edit(at(1), "Move");
    scene.lock = "a viewer changes nothing";
    expect(() => scene.edit(at(2), "Move")).toThrow(new EditError("a viewer changes nothing"));
    expect(() => scene.apply({ id: "e", title: "Move", ops: [] })).toThrow(EditError);
    expect(scene.undo()).toBe(false);
    expect(x(scene.doc)).toBe(1);
    scene.begin();
    scene.move(at(5));
    scene.end();
    expect(x(scene.doc)).toBe(1);
  });

  it("lets the changes of another window pass, and edits again with no lock", () => {
    const scene = channel();
    scene.lock = "a viewer changes nothing";
    scene.remote(() => scene.edit(at(3), "A change from another window"));
    expect(x(scene.doc)).toBe(3);
    scene.lock = null;
    scene.edit(at(4), "Move");
    expect(scene.undo()).toBe(true);
    expect(x(scene.doc)).toBe(3);
  });
});
