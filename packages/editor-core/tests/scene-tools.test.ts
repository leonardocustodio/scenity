// SPDX-License-Identifier: Apache-2.0
// The query and the transform commands of the generic Claude tools on the generic garden scene. The query gives the
// entities by name, tag and component with their transforms, bounds and values. A transform command is one undo step.
// A run of Claude is a proposal until the owner accepts it, unless the switch of the session says "apply".
import { describe, expect, it } from "bun:test";
import { worldTransform } from "@scenity/scene";
import { CommandError, queryScene, TRANSFORM_COMMANDS } from "../src/index";
import { garden } from "./helpers";
import { hierarchyEditor } from "./hierarchyFixture";

function transformEditor() {
  const editor = hierarchyEditor();
  editor.registry.register(TRANSFORM_COMMANDS);
  return editor;
}

describe("queryScene", () => {
  it("finds the entities by name, tag and component in tree order, with the transforms", () => {
    const doc = garden();
    const lights = queryScene(doc, { component: "light" });
    expect(lights.entities.map((entity) => entity.id)).toEqual(["lamp", "sun"]);
    expect(lights).toMatchObject({ matches: 2, total: Object.keys(doc.entities).length });
    const lamp = lights.entities[0];
    expect(lamp).toMatchObject({ id: "lamp", name: "Lamp", parent: "table", components: ["light", "transform"] });
    expect(lamp?.local?.position).toEqual([0, 1.2, 0]);
    const world = worldTransform(doc, "lamp")?.position;
    expect(lamp?.world?.position).toEqual(world === undefined ? undefined : [world[0], world[1], world[2]]);
    expect(lamp?.bounds).toBeNull();
    expect(lamp).not.toHaveProperty("values");
    expect(queryScene(doc, { where: "tag:furniture name:bench" }).entities.map((entity) => entity.id)).toEqual([
      "bench",
    ]);
    expect(queryScene(doc, { name: "TAB" }).entities.map((entity) => entity.id)).toEqual(["table"]);
  });

  it("gives the subtree, the values, the bounds and the limit; an unknown ID is an error", () => {
    const doc = garden();
    const under = queryScene(doc, { under: "table" }).entities.map((entity) => entity.id);
    expect(under).toContain("table");
    expect(under).toContain("lamp");
    expect(under).not.toContain("bench");
    const [lamp] = queryScene(doc, { ids: ["lamp"], values: ["light"] }).entities;
    expect(lamp?.values).toEqual({ light: { intensity: 2, target: "entity:table#top", type: "spot" } });
    const box = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };
    const boxed = queryScene(doc, { ids: ["table"] }, (id) => (id === "table" ? box : null));
    expect(boxed.entities[0]?.bounds).toEqual(box);
    const one = queryScene(doc, { limit: 1 });
    expect(one.entities).toHaveLength(1);
    expect(one.matches).toBe(one.total);
    expect(() => queryScene(doc, { ids: ["pond"] })).toThrow('No entity "pond" in the scene.');
  });
});

describe("the transform commands", () => {
  it("moves an entity to a world point as one undo step, and back with undo", async () => {
    const editor = transformEditor();
    const run = await editor.run("entity.move", { entity: "bench", x: 0.5, z: 2 });
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Move Bench to x 0.5, z 2" });
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ position: [0.5, 0, 2] });
    editor.channel.undo();
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ position: [1.5, 0, -1] });
  });

  it("moves by a vector, turns and scales; a locked entity does not change", async () => {
    const editor = transformEditor();
    await editor.run("entity.move", { entity: "bench", y: 0.25, relative: true });
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ position: [1.5, 0.25, -1] });
    await editor.run("entity.turn", { entity: "bench", degrees: 90 });
    const rotation = editor.channel.doc.entities.bench?.components.transform as { rotation: number[] };
    expect(rotation.rotation[1]).toBeCloseTo(Math.SQRT1_2, 5);
    await editor.run("entity.scale", { entity: "bench", factor: 2, axis: "x" });
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ scale: [2, 1, 1] });
    await editor.run("entity.lock", { entity: "bench", locked: true });
    const locked = await editor.run("entity.move", { entity: "bench", x: 9 }).catch((error: unknown) => error);
    expect(locked).toBeInstanceOf(CommandError);
    const none = await editor.run("entity.move", { entity: "table" }).catch((error: unknown) => error);
    expect((none as Error).message).toBe("Give x, y or z.");
  });

  it("keeps a move of Claude as a proposal; the accept applies it as one step", async () => {
    const editor = transformEditor();
    const run = await editor.runner.run("entity.move", { entity: "bench", x: 3 }, { by: "claude" });
    expect(run).toMatchObject({ outcome: "proposed", proposal: "p1", step: false });
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ position: [1.5, 0, -1] });
    const accepted = editor.runner.accept("p1");
    expect(accepted).toMatchObject({ outcome: "applied", step: true, proposal: "p1" });
    expect(editor.channel.doc.entities.bench?.components.transform).toMatchObject({ position: [3, 0, -1] });
    editor.runner.setMode("apply");
    const at = await editor.runner.run("entity.move", { entity: "bench", x: 4 }, { by: "claude" });
    expect(at).toMatchObject({ outcome: "applied", step: true });
  });
});
