// SPDX-License-Identifier: Apache-2.0
// The commands of the hierarchy panel on the generic garden scene. Each action of the panel is a command with an undo
// step. A change of parent keeps the world transform and refuses a cycle. Hide is a document value. Solo and lock are
// view values in the one history that the saved document never holds. The runtime draws them through the view
// overlay.
import { describe, expect, it } from "bun:test";
import { worldTransform, writeDocument, type SceneOp } from "@scenity/scene";
import { CommandError, reparentOps, viewOverlay } from "../src/index";
import { garden } from "./helpers";
import { hierarchyEditor } from "./hierarchyFixture";

function close(a: readonly number[] | undefined, b: readonly number[] | undefined): void {
  expect(a?.length).toBe(b?.length);
  (a ?? []).forEach((value, index) => expect(value).toBeCloseTo(b?.[index] ?? Number.NaN, 5));
}

/** The error of a command run that must fail. */
async function failure(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("The command did not fail.");
}

/** The garden with a turned, moved and scaled table. Thus a change of parent must change the local values. */
function turnedGarden() {
  const editor = hierarchyEditor();
  const reason = editor.channel.edit(
    [
      { op: "set", path: "/entities/table/components/transform/position", value: [1, 0.5, -2] },
      { op: "set", path: "/entities/table/components/transform/rotation", value: [0, 0.7071068, 0, 0.7071068] },
      { op: "set", path: "/entities/table/components/transform/scale", value: [2, 2, 2] },
    ],
    "Turn the table",
  );
  expect(reason.applied).toBe(true);
  return editor;
}

describe("the hierarchy commands", () => {
  it("moves an entity under a new parent with its world transform, as one undo step", async () => {
    const editor = turnedGarden();
    const before = writeDocument(editor.channel.doc);
    const world = worldTransform(editor.channel.doc, "bench");
    const run = await editor.run("entity.reparent", { entity: "bench", parent: "table" });
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Move Bench under Table" });
    const doc = editor.channel.doc;
    expect(doc.entities.bench).toMatchObject({ parent: "table", index: 1 });
    expect(doc.entities.sun?.index).toBe(1);
    const after = worldTransform(doc, "bench");
    close(after?.position, world?.position);
    close(after?.rotation, world?.rotation);
    close(after?.scale, world?.scale);
    // The local values change: the parent is turned, moved and scaled.
    const local = doc.entities.bench?.components.transform as { rotation?: number[]; scale?: number[] };
    close(local.scale, [0.5, 0.5, 0.5]);
    close(local.rotation, [0, -0.7071068, 0, 0.7071068]);
    expect(editor.channel.undo()).toBe(true);
    expect(writeDocument(editor.channel.doc)).toBe(before);
    // A move to the root: the world transform stays again.
    await editor.run("entity.reparent", { entity: "lamp", index: 0 });
    expect(editor.channel.doc.entities.lamp).toMatchObject({ parent: null, index: 0 });
    close(worldTransform(editor.channel.doc, "lamp")?.position, [1, 2.9, -2]);
  });

  it("refuses a parent that makes a cycle or does not exist, and changes nothing", async () => {
    const editor = hierarchyEditor();
    const doc = editor.channel.doc;
    expect(await failure(editor.run("entity.reparent", { entity: "table", parent: "lamp" }))).toBeInstanceOf(
      CommandError,
    );
    expect((await failure(editor.run("entity.reparent", { entity: "table", parent: "table" }))).message).toMatch(
      /cycle/,
    );
    expect(await failure(editor.run("entity.reparent", { entity: "bench", parent: "pond" }))).toBeInstanceOf(
      CommandError,
    );
    expect((await failure(editor.run("entity.reparent", { entity: "pond" }))).message).toMatch(/No entity "pond"/);
    expect(editor.channel.doc).toBe(doc);
    expect(editor.channel.history.canUndo).toBe(false);
  });

  it("moves the selected entities in their order, and a selected child moves with its parent", async () => {
    const editor = hierarchyEditor();
    editor.selected.value = ["sun", "lamp", "table"];
    await editor.run("entity.reparent", { parent: "bench" });
    const doc = editor.channel.doc;
    expect(doc.entities.sun).toMatchObject({ parent: "bench", index: 0 });
    expect(doc.entities.table).toMatchObject({ parent: "bench", index: 1 });
    expect(doc.entities.lamp).toMatchObject({ parent: "table", index: 0 });
    close(worldTransform(doc, "lamp")?.position, [0, 1.2, 0]);
    expect(editor.channel.history.steps().steps).toHaveLength(2);
  });

  it("reorders under one parent with the index of the children without the moved entities", () => {
    const doc = garden();
    const ops = reparentOps(doc, ["sun", "table"], { parent: null, index: 1 });
    // The roots go from table, bench, sun to bench, sun, table: the sun does not move.
    expect(ops).toEqual<SceneOp[]>([{ op: "move", id: "table", parent: null, index: 2 }]);
    expect(reparentOps(doc, ["sun", "table"], { parent: null, index: 0 })).toEqual<SceneOp[]>([
      { op: "move", id: "sun", parent: null, index: 0 },
    ]);
    expect(reparentOps(doc, ["bench"], { parent: null, index: 1 })).toEqual([]);
  });

  it("renames an entity as one undo step", async () => {
    const editor = hierarchyEditor();
    editor.selected.value = ["bench"];
    await editor.run("entity.rename", { name: "Garden bench" });
    expect(editor.channel.doc.entities.bench?.name).toBe("Garden bench");
    expect((await editor.run("entity.rename", { name: "Garden bench" })).step).toBe(false);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.channel.doc.entities.bench?.name).toBe("Bench");
  });

  it("hides and shows through the visibility component of the document", async () => {
    const editor = hierarchyEditor();
    const before = writeDocument(editor.channel.doc);
    await editor.run("entity.hide", { entity: "bench,sun" });
    expect(editor.channel.doc.entities.bench?.components.visibility).toEqual({ visible: false });
    expect(writeDocument(editor.channel.doc)).toContain('"visible": false');
    // The toggle shows the entities again, and the document has no remaining visibility value.
    await editor.run("entity.hide", { entity: "bench,sun" });
    expect(writeDocument(editor.channel.doc)).toBe(before);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.channel.doc.entities.sun?.components.visibility).toEqual({ visible: false });
    expect(editor.channel.undo()).toBe(true);
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("keeps solo and lock in the view channel: one undo step each, and no change of the document", async () => {
    const editor = hierarchyEditor();
    const doc = editor.channel.doc;
    await editor.run("entity.solo", { entity: "table" });
    await editor.run("entity.lock", { entity: "bench" });
    expect(editor.layer.view).toEqual({ solo: ["table"], locked: ["bench"] });
    expect(editor.channel.doc).toBe(doc);
    expect(editor.channel.history.steps().steps.map((step) => step.label?.title ?? "start")).toEqual([
      "start",
      "Solo Table",
      "Lock Bench",
    ]);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.layer.view).toEqual({ solo: ["table"], locked: [] });
    expect(editor.channel.undo()).toBe(true);
    expect(editor.layer.view).toEqual({ solo: [], locked: [] });
    expect(editor.channel.redo()).toBe(true);
    await editor.run("view.showAll");
    expect(editor.layer.view.solo).toEqual([]);
    expect(
      editor.registry.block(editor.registry.named("view.showAll")!, { doc, view: editor.layer.view, selection: null }),
    ).toBe("No entity is solo.");
  });

  it("draws solo and lock through the view overlay: the runtime gets the ops, the document keeps none", async () => {
    const editor = hierarchyEditor();
    await editor.run("entity.solo", { entity: "lamp" });
    // The lamp and its parent show, but the bench and the sun do not.
    expect(editor.runtime.at(-1)).toEqual<SceneOp[]>([
      { op: "addComponent", id: "bench", component: "visibility", value: { visible: false } },
      { op: "addComponent", id: "sun", component: "visibility", value: { visible: false } },
    ]);
    await editor.run("entity.lock", { entity: "table" });
    expect(editor.runtime.at(-1)).toEqual<SceneOp[]>([
      { op: "addComponent", id: "lamp", component: "pickable", value: { enabled: false } },
      { op: "addComponent", id: "table", component: "pickable", value: { enabled: false } },
    ]);
    expect(editor.layer.shown.entities.lamp?.components.pickable).toEqual({ enabled: false });
    expect(editor.channel.doc.entities.lamp?.components.pickable).toBeUndefined();
    // A document edit under the overlay: the runtime gets the diff of the drawn documents.
    await editor.run("entity.rename", { entity: "sun", name: "Moon" });
    expect(editor.runtime.at(-1)).toEqual<SceneOp[]>([{ op: "set", path: "/entities/sun/name", value: "Moon" }]);
    expect(editor.layer.shown.entities.sun?.components.visibility).toEqual({ visible: false });
    // The undo of all steps returns the document to the runtime with no overlay.
    while (editor.channel.undo());
    expect(editor.layer.shown).toBe(editor.channel.doc);
    expect(viewOverlay(editor.channel.doc, editor.layer.view)).toBe(editor.channel.doc);
  });

  it("needs an entity: the selection or the entity argument", async () => {
    const editor = hierarchyEditor();
    expect((await failure(editor.run("entity.hide"))).message).toMatch(/needs a entity selection/);
    expect((await failure(editor.run("entity.rename", { entity: "bench" }))).message).toMatch(/name/);
  });
});
