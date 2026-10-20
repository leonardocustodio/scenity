// SPDX-License-Identifier: Apache-2.0
// The entity commands on the generic garden scene:
// - add from an asset or empty;
// - duplicate: new IDs, also the children, and the references inside the copy remapped;
// - delete: also the children, and the references to the deleted entities cleared and reported, or the delete refused;
// - copy and paste between two scenes of one project: the asset references stay, new IDs, and a reference to an
//   entity of the other scene cleared.
// Each edit applies and undoes as one step of the history.
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { builtinRegistry, writeDocument } from "@scenity/scene";
import { defineComponent } from "@scenity/scene/components";
import { entityRefSchema } from "@scenity/scene/schema/common";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  addedRoots,
  assetDropPoint,
  CommandError,
  createCommandRegistry,
  createRunner,
  editProblems,
  ENTITY_COMMANDS,
  entityTarget,
  HIERARCHY_COMMANDS,
  sameView,
  SceneChannel,
  sceneOpKind,
  VIEW_CHANNEL,
  VIEW_OP,
  ViewLayer,
  type ClipboardData,
  type EntityHost,
  type EntityState,
  type HierarchyOp,
  type OpContext,
  type SceneView,
} from "../src/index";
import { cell, garden } from "./helpers";

const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

/** A component of a test plugin that needs its entity reference. */
const leash = defineComponent({
  id: "fixture.leash",
  schema: z.strictObject({ to: entityRefSchema }),
  editor: { label: "Leash", fields: {} },
});
const registry = builtinRegistry().register(leash);

/** A store of a clipboard that two editors share (the scene page keeps it for each project). */
function clipboardStore(): { value: ClipboardData | null } {
  return { value: null };
}

/** An editor of a scene with the hierarchy and entity commands, as the scene page has them. */
function entityEditor(doc: SceneDocument, clipboard = clipboardStore()) {
  const layer = new ViewLayer<SceneDocument>(doc);
  const channel: SceneChannel<SceneDocument> = new SceneChannel<SceneDocument>({
    doc,
    registry,
    patch: () => undefined,
    channels: {
      [VIEW_CHANNEL]: {
        title: "view",
        read: () => layer.view,
        write: () => undefined,
        same: (a, b) => sameView(a as SceneView, b as SceneView),
      },
    },
    kinds: [VIEW_OP],
  });
  const selected = cell<readonly string[]>([]);
  const commands = createCommandRegistry<EntityState, EntityHost, HierarchyOp>();
  commands.register(HIERARCHY_COMMANDS);
  commands.register(ENTITY_COMMANDS);
  const kinds = [sceneOpKind(registry), VIEW_OP];
  const runner = createRunner<EntityState, EntityHost, HierarchyOp>({
    registry: commands,
    state: () => {
      const items = selected.value.map((id) => entityTarget(id));
      const base = { doc: channel.doc, view: layer.view, selection: items[0] ?? null, selected: items };
      return { ...base, clipboard: clipboard.value, registry };
    },
    host: {
      select: (target) => {
        selected.value = target === null ? [] : [target.id];
      },
      undo: () => channel.undo(),
      redo: () => channel.redo(),
      copy: (data) => {
        clipboard.value = data;
      },
    },
    apply: (edit) => {
      const result = channel.apply(edit);
      return { step: result.applied, pending: result.pending, sent: [] };
    },
    problems: (edit) => editProblems(edit, kinds, NO_TUNES),
    proposals: cell([]),
    mode: cell("propose"),
    keepMode: () => undefined,
  });
  const run = (id: string, args: Record<string, unknown> = {}) => runner.run(id, args, { by: "owner" });
  return { channel, selected, run, clipboard };
}

/** The ops of a run as scene ops. */
function opsOf(run: { readonly ops: readonly HierarchyOp[] }) {
  return run.ops.flatMap((op) => (op.kind === "scene" ? [op.op] : []));
}

/** The error of a run that must fail. */
async function failure(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("The command did not fail.");
}

/** A second scene of the project: a patio with its own bench and a leash to it. */
function patio(): SceneDocument {
  return {
    format: "scenity.scene/1",
    id: "patio",
    entities: {
      bench: { name: "Patio bench", parent: null, index: 0, components: { transform: { position: [0, 0, 2] } } },
      post: {
        parent: null,
        index: 1,
        components: { transform: { position: [1, 0, 2] }, "fixture.leash": { to: "entity:bench" } },
      },
    },
  };
}

describe("entity.add", () => {
  it("adds an entity with a model of an asset at a place, as one undo step", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    const run = await editor.run("entity.add", { asset: "asset:01CHAIR", name: "Chair", x: 0.2, y: 0.75, z: -0.1 });
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Add Chair" });
    expect(addedRoots(opsOf(run))).toEqual(["chair"]);
    expect(editor.channel.doc.entities.chair).toEqual({
      name: "Chair",
      parent: null,
      index: 3,
      components: { transform: { position: [0.2, 0.75, -0.1] }, model: { asset: "asset:01CHAIR" } },
    });
    expect(editor.channel.undo()).toBe(true);
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("adds an empty entity under a parent; a bad asset or parent refuses", async () => {
    const editor = entityEditor(garden());
    await editor.run("entity.add", { parent: "table" });
    expect(editor.channel.doc.entities.entity).toMatchObject({ parent: "table", index: 1 });
    expect(await failure(editor.run("entity.add", { asset: "no asset" }))).toBeInstanceOf(CommandError);
    expect((await failure(editor.run("entity.add", { parent: "pond" }))).message).toContain('No entity "pond"');
  });
});

describe("entity.duplicate", () => {
  it("copies the entity with its children beside it; the references inside the copy name the copy", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    editor.selected.value = ["table", "lamp"];
    const run = await editor.run("entity.duplicate");
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Duplicate Table" });
    expect(addedRoots(opsOf(run))).toEqual(["table-2"]);
    const doc = editor.channel.doc;
    expect(doc.entities["table-2"]).toMatchObject({ name: "Table", parent: null, index: 1 });
    expect(doc.entities["lamp-2"]).toMatchObject({ parent: "table-2", index: 0 });
    expect((doc.entities["lamp-2"]?.components.light as { target: string }).target).toBe("entity:table-2#top");
    // The original keeps its reference, and the siblings after the copy move one place.
    expect((doc.entities.lamp?.components.light as { target: string }).target).toBe("entity:table#top");
    expect(doc.entities.bench?.index).toBe(2);
    editor.channel.undo();
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("duplicates two siblings in one step; a reference to an entity outside the copy stays", async () => {
    const editor = entityEditor(garden());
    await editor.run("entity.duplicate", { entity: "table,sun" });
    const doc = editor.channel.doc;
    const roots = Object.entries(doc.entities)
      .filter(([, entity]) => entity.parent === null)
      .sort(([, a], [, b]) => a.index - b.index)
      .map(([id]) => id);
    expect(roots).toEqual(["table", "table-2", "bench", "sun", "sun-2"]);
    expect((doc.entities["sun-2"]?.components.light as { target: string }).target).toBe("entity:bench");
  });
});

describe("entity.delete", () => {
  it("deletes an entity with its children as one undo step", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    const run = await editor.run("entity.delete", { entity: "table" });
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Delete Table" });
    expect(Object.keys(editor.channel.doc.entities).sort()).toEqual(["bench", "sun"]);
    expect(editor.channel.doc.entities.bench?.index).toBe(0);
    editor.channel.undo();
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("clears and reports a reference of another entity to the deleted entity (the rule clear)", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    const run = await editor.run("entity.delete", { entity: "bench" });
    expect(run.title).toBe("Delete Bench; cleared 1 reference: sun light/target (entity:bench)");
    expect(editor.channel.doc.entities.sun?.components.light).toEqual({ intensity: 1.5, type: "directional" });
    editor.channel.undo();
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("refuses with the rule refuse, and when a component needs the reference", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    const refused = await failure(editor.run("entity.delete", { entity: "bench", references: "refuse" }));
    expect(refused.message).toContain("sun light/target (entity:bench)");
    expect(writeDocument(editor.channel.doc)).toBe(before);
    const other = entityEditor(patio());
    const needed = await failure(other.run("entity.delete", { entity: "bench" }));
    expect(needed.message).toContain("a component needs its reference (post fixture.leash/to (entity:bench))");
    expect(Object.keys(other.channel.doc.entities)).toEqual(["bench", "post"]);
  });
});

describe("entity.copy and entity.paste", () => {
  it("pastes in the same scene with new IDs as one undo step", async () => {
    const editor = entityEditor(garden());
    const before = writeDocument(editor.channel.doc);
    expect((await editor.run("entity.paste").catch((error: unknown) => error)) instanceof CommandError).toBe(true);
    editor.selected.value = ["table"];
    const copy = await editor.run("entity.copy");
    expect(copy).toMatchObject({ outcome: "ran", step: false, value: 2 });
    expect(writeDocument(editor.channel.doc)).toBe(before);
    const run = await editor.run("entity.paste", { parent: "bench" });
    expect(run).toMatchObject({ outcome: "applied", step: true, title: "Paste 2 entities" });
    expect(addedRoots(opsOf(run))).toEqual(["table-2"]);
    expect(editor.channel.doc.entities["table-2"]?.parent).toBe("bench");
    editor.channel.undo();
    expect(writeDocument(editor.channel.doc)).toBe(before);
  });

  it("pastes across two scenes of a project: asset references stay, references out of the scene go", async () => {
    const clipboard = clipboardStore();
    const source = entityEditor(garden(), clipboard);
    await source.run("entity.add", { asset: "asset:01CHAIR", name: "Chair" });
    await source.run("entity.copy", { entity: "chair,sun,bench" });
    const target = entityEditor(patio(), clipboard);
    const before = writeDocument(target.channel.doc);
    const run = await target.run("entity.paste");
    // The copied bench takes a new ID. The sun names the copy, so its reference stays valid.
    expect(addedRoots(opsOf(run))).toEqual(["bench-2", "sun", "chair"]);
    const doc = target.channel.doc;
    expect(doc.entities.chair?.components.model).toEqual({ asset: "asset:01CHAIR" });
    expect((doc.entities.sun?.components.light as { target: string }).target).toBe("entity:bench-2");
    expect(doc.entities.post?.components["fixture.leash"]).toEqual({ to: "entity:bench" });
    target.channel.undo();
    expect(writeDocument(target.channel.doc)).toBe(before);
    // A copy of the lamp alone names the table of the garden. The patio does not have it, so the paste clears it.
    await source.run("entity.copy", { entity: "lamp" });
    const lamp = await target.run("entity.paste");
    expect(lamp.title).toBe("Paste 1 entity; cleared 1 reference: lamp light/target (entity:table)");
    expect(target.channel.doc.entities.lamp?.components.light).toEqual({ intensity: 2, type: "spot" });
  });
});

describe("the place of an asset drop", () => {
  const table = { id: "table", y: 0.75, minX: -0.6, maxX: 0.6, minZ: -0.4, maxZ: 0.4 };
  const floor = { id: "floor", y: 0, minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
  const down = (x: number, z: number) => ({ origin: [x, 3, z + 3] as const, direction: [0, -0.707107, -0.707107] });

  it("takes the nearest surface top under the pointer in front of the pick hit", () => {
    const ray = {
      origin: [0.1, 3, 2.25] as [number, number, number],
      direction: [0, -0.707107, -0.707107] as [number, number, number],
    };
    expect(assetDropPoint(ray, [floor, table], { entity: "table", point: [0.1, 0.75, 0] })).toEqual({
      point: [0.1, 0.75, 0],
      surface: "table",
    });
    // With no hit, the table top still comes before the floor on the ray.
    expect(assetDropPoint(ray, [floor, table], null)?.surface).toBe("table");
  });

  it("takes the hit point when no surface top is in front of it, else the ground plane", () => {
    const side = { origin: [0, 0.4, 3] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
    expect(assetDropPoint(side, [floor, table], { entity: "table", point: [0, 0.4, 0.4] })).toEqual({
      point: [0, 0.4, 0.4],
      surface: "table",
    });
    const ray = down(5, 5);
    const ground = assetDropPoint({ origin: [...ray.origin], direction: [0, -0.707107, -0.707107] }, [table], null);
    expect(ground?.surface).toBeNull();
    expect(ground?.point[1]).toBe(0);
  });
});
