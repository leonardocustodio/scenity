// SPDX-License-Identifier: Apache-2.0
// The scene channel and the file state of a scene document. An edit is one step and patches the runtime. A live drag
// is one step. An undo sends the inverse diff. The dirty state follows the canonical text. The draft stays over a
// reload of the page, and there is no draft when the storage fails.
import { describe, expect, it } from "bun:test";
import { applyOps, writeDocument, type SceneOp } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  draftOffer,
  EditError,
  SceneChannel,
  sceneDraftKey,
  SceneDrafts,
  SceneFile,
  sceneTextHash,
  type DraftStorage,
} from "../src/index";
import { components, garden } from "./helpers";

const POSITION = "/entities/table/components/transform/position";

function channel(doc = garden()) {
  const patches: SceneOp[][] = [];
  const changes: SceneDocument[] = [];
  const scene = new SceneChannel<SceneDocument>({
    doc,
    registry: components,
    patch: (ops) => patches.push([...ops]),
    onChange: (next) => changes.push(next),
  });
  return { scene, patches, changes };
}

/** A storage in memory; `fail` makes each call throw (a blocked storage). */
function memory(fail = false): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  const check = (): void => {
    if (fail) throw new Error("blocked");
  };
  return {
    items,
    getItem: (key) => (check(), items.get(key) ?? null),
    setItem: (key, value) => (check(), void items.set(key, value)),
    removeItem: (key) => (check(), void items.delete(key)),
  };
}

describe("the scene channel", () => {
  it("applies an edit as one step, patches the runtime with its diff and undoes to the same bytes", () => {
    const { scene, patches, changes } = channel();
    const before = writeDocument(scene.doc);
    const result = scene.edit([{ op: "set", path: POSITION, value: [0.5, 0, 0.25] }], "Move the table");
    expect(result.applied).toBe(true);
    expect(scene.doc.entities.table?.components.transform).toMatchObject({ position: [0.5, 0, 0.25] });
    // The runtime gets the diff of the two documents: the same document after the patch.
    expect(patches).toHaveLength(1);
    const patched = applyOps(garden(), patches[0] ?? [], components);
    expect(patched.ok && writeDocument(patched.doc)).toBe(writeDocument(scene.doc));
    expect(changes).toHaveLength(1);
    const edited = scene.doc;
    expect(scene.undo()).toBe(true);
    expect(writeDocument(scene.doc)).toBe(before);
    // The undo sends the inverse diff, so the runtime shows the document of the history.
    const undone = applyOps(edited, patches[1] ?? [], components);
    expect(undone.ok && writeDocument(undone.doc)).toBe(before);
    expect(scene.redo()).toBe(true);
    expect(scene.doc.entities.table?.components.transform).toMatchObject({ position: [0.5, 0, 0.25] });
  });

  it("refuses a bad op with an EditError and changes nothing", () => {
    const { scene, patches } = channel();
    expect(() => scene.edit([{ op: "set", path: "/entities/nobody/name", value: "x" }], "Bad")).toThrow(EditError);
    expect(patches).toEqual([]);
    expect(scene.history.canUndo).toBe(false);
  });

  it("makes a live drag one step: each move patches at once, the end records the last document", () => {
    const { scene, patches } = channel();
    scene.begin();
    for (const x of [0.1, 0.2, 0.3]) scene.move([{ op: "set", path: `${POSITION}/0`, value: x }]);
    expect(patches).toHaveLength(3);
    expect(scene.history.canUndo).toBe(false);
    expect(() => scene.edit([], "An edit in a drag")).toThrow(EditError);
    scene.end();
    expect(scene.history.steps().steps).toHaveLength(2);
    expect(scene.undo()).toBe(true);
    expect(writeDocument(scene.doc)).toBe(writeDocument(garden()));
  });

  it("puts the start document back when a drag is cancelled, with no step", () => {
    const { scene, patches } = channel();
    scene.begin();
    scene.move([{ op: "set", path: `${POSITION}/0`, value: 2 }]);
    scene.end(true);
    expect(writeDocument(scene.doc)).toBe(writeDocument(garden()));
    expect(patches).toHaveLength(2);
    expect(scene.history.canUndo).toBe(false);
  });
});

describe("the file state of a scene document", () => {
  it("is dirty after an edit and clean after an undo or a save", () => {
    const doc = garden();
    const disk = writeDocument(doc);
    const file = new SceneFile("scenes/garden.scene.json", doc, disk);
    expect(file.baseHash).toBe(sceneTextHash(disk));
    const { scene } = channel(doc);
    expect(file.dirty(scene.doc)).toBe(false);
    scene.edit([{ op: "set", path: `${POSITION}/2`, value: 1 }], "Move");
    expect(file.dirty(scene.doc)).toBe(true);
    const request = file.saveRequest(scene.doc);
    expect(request).toEqual({ path: file.path, text: writeDocument(scene.doc), baseHash: sceneTextHash(disk) });
    expect(file.saveRequest(scene.doc, true).force).toBe(true);
    file.saved(request.text, sceneTextHash(request.text));
    expect(file.dirty(scene.doc)).toBe(false);
    expect(file.changedOnDisk(request.text)).toBe(false);
    expect(file.changedOnDisk(disk)).toBe(true);
  });

  it("gives a stable SHA-256 of a text", () => {
    expect(sceneTextHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("keeps a draft over a reload and offers it while it differs from the file", () => {
    const storage = memory();
    const key = sceneDraftKey("garden", "scenes/garden.scene.json");
    const doc = garden();
    const file = new SceneFile("scenes/garden.scene.json", doc, writeDocument(doc));
    const drafts = new SceneDrafts(storage, key, file.path);
    const { scene } = channel(doc);
    scene.edit([{ op: "set", path: `${POSITION}/0`, value: 3 }], "Move");
    drafts.write(file, scene.doc, 1000);
    // A new page reads the same storage.
    const again = new SceneDrafts(storage, key, file.path).read();
    expect(again?.text).toBe(writeDocument(scene.doc));
    expect(draftOffer(again, file)).toEqual({ draft: again!, stale: false });
    // The file changed on the disk after the draft: the offer is stale.
    const moved = new SceneFile(file.path, doc, `${writeDocument(doc)} `);
    expect(draftOffer(again, moved)?.stale).toBe(true);
    // A draft equal to the file is no offer.
    const saved = new SceneFile(file.path, scene.doc, writeDocument(scene.doc));
    expect(draftOffer(again, saved)).toBeNull();
    drafts.clear();
    expect(drafts.read()).toBeNull();
  });

  it("gives no draft for a bad value, another path or a blocked storage", () => {
    const storage = memory();
    storage.items.set("k", "{not json");
    expect(new SceneDrafts(storage, "k", "a.scene.json").read()).toBeNull();
    storage.items.set("k", JSON.stringify({ format: "scenity.sceneDraft/1", path: "b.scene.json" }));
    expect(new SceneDrafts(storage, "k", "a.scene.json").read()).toBeNull();
    const blocked = new SceneDrafts(memory(true), "k", "a.scene.json");
    const doc = garden();
    expect(() => {
      blocked.write(new SceneFile("a.scene.json", doc, null), doc, 1);
      blocked.clear();
    }).not.toThrow();
    expect(blocked.read()).toBeNull();
    expect(new SceneDrafts(null, "k", "a.scene.json").read()).toBeNull();
  });
});
