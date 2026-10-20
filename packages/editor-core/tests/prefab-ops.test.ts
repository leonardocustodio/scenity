// SPDX-License-Identifier: Apache-2.0
// The prefab model of the editor core on a small generic room with two instances of one stool prefab:
// - the expansion that the runtime draws;
// - the revert of overrides (per field, per component, per entity, all);
// - the apply to the prefab (the other instance changes, and its own override stays);
// - the commands `prefab.apply` and `prefab.revert` through a runner, and one undo step for each, for the scene and the
//   prefab together.
import { describe, expect, it } from "bun:test";
import { builtinRegistry, writeDocument } from "@scenity/scene";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  applyOverrideOps,
  createCommandRegistry,
  createRunner,
  editProblems,
  ENTITY_COMMANDS,
  entityTarget,
  HIERARCHY_COMMANDS,
  inScope,
  loadPrefabSet,
  overrideMarks,
  PREFAB_CHANNEL,
  PREFAB_COMMANDS,
  PrefabExpander,
  prefabOpKind,
  revertOverrideOps,
  SceneChannel,
  sceneOpKind,
  setResolver,
  VIEW_OP,
  ViewLayer,
  type EntityHost,
  type OpContext,
  type PrefabPageOp,
  type PrefabSet,
  type PrefabState,
} from "../src/index";
import { cell } from "./helpers";

const registry = builtinRegistry();
const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };
const PATHS = { docPath: "scenes/room.scene.json" };
const STOOL = "scenes/stool.prefab.json";

const prefab: PrefabDocument = {
  format: "scenity.prefab/1",
  id: "stool",
  name: "Stool",
  root: "base",
  entities: {
    base: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
    seat: {
      name: "Seat",
      parent: "base",
      index: 0,
      components: { transform: { position: [0, 0.45, 0], scale: [1, 1, 1] }, model: { asset: "asset:seat_model" } },
    },
  },
};

const SEAT_SCALE = "/entities/seat/components/transform/scale";
const SEAT_POSITION = "/entities/seat/components/transform/position";

function room(overrides: readonly SceneOp[] = []): SceneDocument {
  return {
    format: "scenity.scene/1",
    id: "room",
    entities: {
      floor: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
      left: {
        name: "Left stool",
        parent: null,
        index: 1,
        components: {
          transform: { position: [-1, 0, 0] },
          prefab: { source: "stool.prefab.json", ...(overrides.length === 0 ? {} : { overrides: [...overrides] }) },
        },
      },
      right: {
        name: "Right stool",
        parent: null,
        index: 2,
        components: {
          transform: { position: [1, 0, 0] },
          prefab: { source: "stool.prefab.json", overrides: [{ op: "set", path: SEAT_POSITION, value: [0, 0.5, 0] }] },
        },
      },
    },
  };
}

const LEFT_OVERRIDES: SceneOp[] = [
  { op: "set", path: SEAT_SCALE, value: [1, 1.5, 1] },
  { op: "set", path: "/entities/seat/components/model/asset", value: "asset:other_model" },
  { op: "set", path: "/entities/base/components/transform/position", value: [0, 0.1, 0] },
];

const expander = new PrefabExpander(PATHS, registry);
const set: PrefabSet = { [STOOL]: prefab };

/** The value of a field of an expanded entity. */
function seat(doc: SceneDocument, instance: string): Record<string, unknown> {
  return expander.expand(doc, editorSet.value).entities[`${instance}/seat`]?.components.transform as Record<
    string,
    unknown
  >;
}

let editorSet = cell<PrefabSet>(set);

describe("the expansion of the instances", () => {
  it("gives the prefab entities of each instance and keeps a document with no instance", () => {
    const doc = room(LEFT_OVERRIDES);
    const out = expander.expand(doc, set);
    expect(Object.keys(out.entities).sort()).toEqual([
      "floor",
      "left",
      "left/base",
      "left/seat",
      "right",
      "right/base",
      "right/seat",
    ]);
    expect(out.entities["left/base"]?.parent).toBe("left");
    expect(out.entities["left/seat"]?.components.transform).toMatchObject({ scale: [1, 1.5, 1] });
    expect(out.entities["right/seat"]?.components.transform).toMatchObject({ position: [0, 0.5, 0], scale: [1, 1, 1] });
    // The same objects give the same result. A document with no instance is the document itself.
    expect(expander.expand(doc, set)).toBe(out);
    const plain = { ...doc, entities: { floor: doc.entities.floor! } };
    expect(expander.expand(plain, set)).toBe(plain);
  });

  it("loads the nested prefabs and resolves each source from its own document", async () => {
    const lamp: PrefabDocument = {
      format: "scenity.prefab/1",
      id: "lamp",
      root: "bulb",
      entities: { bulb: { parent: null, index: 0, components: {} } },
    };
    const withLamp: PrefabDocument = {
      ...prefab,
      entities: {
        ...prefab.entities,
        lamp: { parent: "base", index: 1, components: { prefab: { source: "../props/lamp.prefab.json" } } },
      },
    };
    const files: Record<string, PrefabDocument> = { [STOOL]: withLamp, "props/lamp.prefab.json": lamp };
    const read: string[] = [];
    const loaded = await loadPrefabSet(room(), PATHS, (path) => {
      read.push(path);
      return Promise.resolve(files[path]);
    });
    expect(read).toEqual([STOOL, "props/lamp.prefab.json"]);
    const out = expander.expand(room(), loaded);
    expect(out.entities["left/lamp/bulb"]?.parent).toBe("left/lamp");
    expect(setResolver(loaded, PATHS)("stool.prefab.json", undefined)).toBe(withLamp);
  });
});

describe("the scope and the revert of overrides", () => {
  it("picks the overrides of a field, a component, an entity or all", () => {
    const [scale, asset, base] = LEFT_OVERRIDES as [SceneOp, SceneOp, SceneOp];
    expect(inScope(scale, {})).toBe(true);
    expect(inScope(scale, { entity: "seat" })).toBe(true);
    expect(inScope(base, { entity: "seat" })).toBe(false);
    expect(inScope(asset, { entity: "seat", component: "model" })).toBe(true);
    expect(inScope(scale, { entity: "seat", component: "model" })).toBe(false);
    expect(inScope(scale, { entity: "seat", component: "transform", field: ["scale"] })).toBe(true);
    expect(inScope(scale, { entity: "seat", component: "transform", field: ["position"] })).toBe(false);
    // A set of a whole component touches each field of it.
    const whole: SceneOp = { op: "set", path: "/entities/seat/components/transform", value: {} };
    expect(inScope(whole, { entity: "seat", component: "transform", field: ["scale"] })).toBe(true);
  });

  it("reverts a field, a component, an entity and all; an empty scope gives no op", () => {
    const doc = room(LEFT_OVERRIDES);
    const list = (ops: SceneOp[]) => (ops[0] as { value?: unknown } | undefined)?.value;
    expect(list(revertOverrideOps(doc, "left", { entity: "seat", component: "transform", field: ["scale"] }))).toEqual(
      LEFT_OVERRIDES.slice(1),
    );
    expect(list(revertOverrideOps(doc, "left", { entity: "seat", component: "model" }))).toEqual([
      LEFT_OVERRIDES[0],
      LEFT_OVERRIDES[2],
    ]);
    expect(list(revertOverrideOps(doc, "left", { entity: "seat" }))).toEqual([LEFT_OVERRIDES[2]]);
    expect(revertOverrideOps(doc, "left")).toEqual([{ op: "set", path: "/entities/left/components/prefab/overrides" }]);
    expect(revertOverrideOps(doc, "left", { entity: "nothing" })).toEqual([]);
    expect(revertOverrideOps(doc, "floor")).toEqual([]);
  });

  it("marks the instances and the prefab entities with overrides", () => {
    const marks = overrideMarks(room(LEFT_OVERRIDES));
    expect(Object.fromEntries(marks)).toEqual({ left: 3, "left/seat": 2, "left/base": 1, right: 1, "right/seat": 1 });
  });
});

describe("the apply of overrides to the prefab", () => {
  it("moves the ops of the scope into the prefab and out of the instance", () => {
    const doc = room(LEFT_OVERRIDES);
    const applied = applyOverrideOps(
      doc,
      "left",
      set,
      { paths: PATHS, registry },
      { entity: "seat", component: "transform" },
    );
    expect(applied.path).toBe(STOOL);
    expect(applied.count).toBe(1);
    expect(applied.ops[0] as unknown).toEqual({ kind: "prefab", path: STOOL, op: LEFT_OVERRIDES[0] });
    expect(applied.ops.at(-1) as unknown).toEqual({
      kind: "scene",
      op: { op: "set", path: "/entities/left/components/prefab/overrides", value: LEFT_OVERRIDES.slice(1) },
    });
    expect(() => applyOverrideOps(doc, "floor", set, { paths: PATHS, registry })).toThrow("not a prefab instance");
    expect(() => applyOverrideOps(room(), "left", set, { paths: PATHS, registry })).toThrow("No override");
    expect(() => applyOverrideOps(doc, "left", {}, { paths: PATHS, registry })).toThrow("no prefab");
    // A bad override (a removed entity) makes the prefab refuse the apply.
    const bad = room([{ op: "set", path: "/entities/gone/name", value: "x" }]);
    expect(() => applyOverrideOps(bad, "left", set, { paths: PATHS, registry })).toThrow("refuses");
  });
});

/** An editor of the room as the scene page has it: the scene and prefab channels, the expansion and the commands. */
function prefabEditor(doc: SceneDocument) {
  editorSet = cell<PrefabSet>(set);
  // What the runtime gets: the ops on the document and each new prefab set. The core expands them itself.
  const sent: (SceneOp[] | PrefabSet)[] = [];
  const layer = new ViewLayer<SceneDocument>(doc);
  const channel: SceneChannel<SceneDocument> = new SceneChannel<SceneDocument>({
    doc,
    registry,
    patch: (ops) => sent.push([...layer.docOps(channel.doc, ops)]),
    channels: {
      [PREFAB_CHANNEL]: {
        title: "prefabs",
        read: () => editorSet.value,
        write: (next) => {
          editorSet.value = next as PrefabSet;
          sent.push(editorSet.value);
        },
        same: (a, b) => a === b,
      },
    },
    kinds: [VIEW_OP, prefabOpKind(registry)],
  });
  const selected = cell<readonly string[]>([]);
  const commands = createCommandRegistry<PrefabState, EntityHost, PrefabPageOp>();
  commands.register(HIERARCHY_COMMANDS);
  commands.register(ENTITY_COMMANDS);
  commands.register(PREFAB_COMMANDS);
  const kinds = [sceneOpKind(registry), VIEW_OP, prefabOpKind(registry)];
  const runner = createRunner<PrefabState, EntityHost, PrefabPageOp>({
    registry: commands,
    state: () => {
      const items = selected.value.map((id) => entityTarget(id));
      const base = { doc: channel.doc, view: layer.view, selection: items[0] ?? null, selected: items };
      return { ...base, clipboard: null, registry, prefabs: editorSet.value, prefabPaths: PATHS };
    },
    host: { select: () => undefined, undo: () => channel.undo(), redo: () => channel.redo(), copy: () => undefined },
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
  return { channel, layer, selected, run, sent };
}

describe("the prefab commands", () => {
  it("applies to the prefab: the other instance changes, its override stays; one undo puts both back", async () => {
    const editor = prefabEditor(room(LEFT_OVERRIDES));
    editor.selected.value = ["left/seat"];
    const before = writeDocument(editor.channel.doc);
    const run = await editor.run("prefab.apply", { component: "transform", field: "scale" });
    expect(run.outcome).toBe("applied");
    expect(editorSet.value[STOOL]?.entities.seat?.components.transform).toMatchObject({ scale: [1, 1.5, 1] });
    expect(seat(editor.channel.doc, "right")).toEqual({ position: [0, 0.5, 0], scale: [1, 1.5, 1] });
    expect(seat(editor.channel.doc, "left")).toMatchObject({ scale: [1, 1.5, 1] });
    // The runtime got the ops on the document (no expanded ID) and the new prefab set.
    const ops = editor.sent.filter((item): item is SceneOp[] => Array.isArray(item)).flat();
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((op) => op.op === "set" && !op.path.includes("~1"))).toBe(true);
    expect(editor.sent).toContain(editorSet.value);
    expect(editor.channel.undo()).toBe(true);
    expect(writeDocument(editor.channel.doc)).toBe(before);
    expect(editorSet.value[STOOL]).toBe(prefab);
    expect(seat(editor.channel.doc, "right")).toEqual({ position: [0, 0.5, 0], scale: [1, 1, 1] });
    expect(editor.channel.redo()).toBe(true);
    expect(seat(editor.channel.doc, "right")).toMatchObject({ scale: [1, 1.5, 1] });
  });

  it("reverts per field, per component and per entity, each one undo step", async () => {
    const editor = prefabEditor(room(LEFT_OVERRIDES));
    await editor.run("prefab.revert", { instance: "left", entity: "seat", component: "transform", field: "scale" });
    expect(seat(editor.channel.doc, "left")).toMatchObject({ scale: [1, 1, 1] });
    await editor.run("prefab.revert", { instance: "left", entity: "seat", component: "model" });
    expect(expander.expand(editor.channel.doc, editorSet.value).entities["left/seat"]?.components.model).toEqual({
      asset: "asset:seat_model",
    });
    editor.selected.value = ["left/base"];
    await editor.run("prefab.revert");
    expect(editor.channel.doc.entities.left?.components.prefab).toEqual({ source: "stool.prefab.json" });
    expect(editor.channel.undo()).toBe(true);
    expect(editor.channel.doc.entities.left?.components.prefab).toMatchObject({ overrides: [LEFT_OVERRIDES[2]] });
    expect(editorSet.value).toBe(set);
  });

  it("refuses a target that is no instance and a revert with nothing to revert", async () => {
    const editor = prefabEditor(room());
    const reason = (run: Promise<unknown>) =>
      run.then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    expect(await reason(editor.run("prefab.apply", { instance: "floor" }))).toContain("not a prefab instance");
    expect(await reason(editor.run("prefab.revert", { instance: "left" }))).toContain("No override to revert");
    expect(await reason(editor.run("prefab.apply", { instance: "left", component: "model" }))).toContain(
      "needs an entity",
    );
    expect(await reason(editor.run("prefab.apply", {}))).not.toBe("");
  });
});
