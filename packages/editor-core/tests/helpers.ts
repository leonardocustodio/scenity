// SPDX-License-Identifier: Apache-2.0
/**
 * The fixture editor of the tests of @scenity/editor-core: a small generic scene (a garden with a table, a lamp, a
 * bench and the sun), the channels of its edit state (the scene document, the tune values and a scratch list), the op
 * kinds and a few commands over the scene. It holds no part of a plugin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  CommandError,
  createCommandRegistry,
  defineCommands,
  EditHistory,
  editProblems,
  entityTarget,
  numberArg,
  pendingRuns,
  sameTunes,
  sceneOpKind,
  selectOnly,
  SOURCE_OP,
  textArg,
  TUNE_OP,
  type BaseOp,
  type Channel,
  type CommandHost,
  type CommandState,
  type EditOp,
  type EntityTarget,
  type OpContext,
  type OpKind,
  type Selection,
  type Tunes,
} from "../src/index";

export const components = builtinRegistry();

/** Read the garden scene of the fixtures. */
export function garden(): SceneDocument {
  const text = readFileSync(join(import.meta.dir, "fixtures", "garden.scene.json"), "utf8");
  const result = readDocument(text, "scene");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** A plain cell of a value (an editor of a page gives a reactive cell). */
export function cell<T>(value: T): { value: T } {
  return { value };
}

export interface FixtureState extends CommandState<EntityTarget> {
  readonly doc: SceneDocument;
}

export interface FixtureHost extends CommandHost<EntityTarget> {
  readonly calls: string[];
}

/** The fixture commands: a move and a rename of the selected entity, a save (a source op) and two view commands. */
export const FIXTURE_COMMANDS = defineCommands<FixtureState, FixtureHost>([
  {
    id: "entity.move",
    title: "Move the entity",
    key: null,
    kind: "edit",
    args: {
      x: { type: "number", description: "The x position in metres." },
      y: { type: "number", description: "The y position in metres.", default: 0 },
      z: { type: "number", description: "The z position in metres." },
    },
    selection: { kinds: ["entity"] },
    build: (args, state) => {
      const id = state.selection?.id ?? "";
      const position = [numberArg(args, "x") ?? 0, numberArg(args, "y") ?? 0, numberArg(args, "z") ?? 0];
      return {
        kind: "edit",
        title: `Move ${id}`,
        ops: [
          { kind: "scene", op: { op: "set", path: `/entities/${id}/components/transform/position`, value: position } },
        ],
      };
    },
  },
  {
    id: "entity.rename",
    title: "Rename the entity",
    key: null,
    kind: "edit",
    args: { name: { type: "string", description: "The new name." } },
    selection: { kinds: ["entity"] },
    proposes: true,
    build: (args, state) => ({
      kind: "edit",
      title: "Rename",
      ops: [
        {
          kind: "scene",
          op: { op: "set", path: `/entities/${state.selection?.id ?? ""}/name`, value: textArg(args, "name") },
        },
      ],
    }),
  },
  {
    id: "light.dim",
    title: "Dim the lights",
    key: null,
    kind: "edit",
    args: { value: { type: "number", description: "The share of the light.", min: 0, max: 1 } },
    selection: { kinds: [] },
    build: (args) => ({
      kind: "edit",
      title: "Dim",
      ops: [{ kind: "tune", path: "light.share", value: numberArg(args, "value") ?? 1 }],
    }),
  },
  {
    id: "scene.save",
    title: "Save the scene",
    key: "⌘S",
    kind: "edit",
    args: {},
    selection: { kinds: [] },
    build: () => ({
      kind: "edit",
      title: "Save",
      ops: [{ kind: "source", tool: "scene save", args: { scene: "garden" } }],
    }),
  },
  {
    id: "selection.clear",
    title: "Clear the selection",
    key: "Escape",
    kind: "view",
    args: {},
    selection: { kinds: "any" },
    build: () => ({
      kind: "view",
      title: "Clear",
      run: (host) => {
        host.select(null);
        return "cleared";
      },
    }),
  },
  {
    id: "proposal.acceptAll",
    title: "Accept all proposals",
    key: null,
    kind: "view",
    args: {},
    selection: { kinds: [] },
    owner: true,
    when: (state) => (state.proposals === 0 ? "No proposal waits." : null),
    build: () => ({ kind: "view", title: "Accept all", run: (host) => host.acceptAll() }),
  },
]);

/** The fixture editor: the registry, the history over its channels and the selection. */
export function fixtureEditor() {
  const scene = cell<SceneDocument>(garden());
  const tunes = cell<Tunes>({});
  const scratch = cell<readonly string[]>([]);
  const selection = cell<Selection>({ items: [] });
  const channels: Record<string, Channel<unknown>> = {
    scene: {
      read: () => scene.value,
      write: (next) => {
        scene.value = next as SceneDocument;
      },
      same: (a, b) => a === b,
    },
    tunes: {
      title: "tune values",
      read: () => tunes.value,
      write: (next) => {
        tunes.value = next as Tunes;
      },
      same: (a, b) => sameTunes(a as Tunes, b as Tunes),
    },
    scratch: {
      title: "scratch props",
      read: () => scratch.value,
      write: (next) => {
        scratch.value = next as string[];
      },
      same: (a, b) => a === b,
    },
  };
  const history = new EditHistory(channels);
  const kinds: readonly OpKind[] = [sceneOpKind(components), TUNE_OP, SOURCE_OP];
  const defaults = new Map([["light.share", 1]]);
  const context: OpContext = { known: (path) => defaults.has(path), defaults };
  const registry = createCommandRegistry<FixtureState, FixtureHost, EditOp>();
  registry.register(FIXTURE_COMMANDS);
  const state = (proposals: number): FixtureState => ({
    doc: scene.value,
    selection: selection.value.items[0] ?? null,
    selected: selection.value.items,
    tunes: tunes.value,
    defaults,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    proposals,
  });
  const calls: string[] = [];
  const host = {
    calls,
    select: (target: EntityTarget | null) => {
      calls.push(`select ${target?.id ?? "none"}`);
      selection.value = selectOnly(target);
    },
    undo: () => history.undo(),
    redo: () => history.redo(),
  };
  const apply = (edit: { id: string; title: string; ops: readonly BaseOp[] }) => {
    const problems = editProblems(edit, kinds, context);
    if (problems.length > 0) throw new CommandError(problems.join(" "));
    const result = history.apply(edit, kinds, context);
    return { step: result.applied, pending: result.pending, sent: [] };
  };
  return {
    scene,
    tunes,
    scratch,
    selection,
    history,
    kinds,
    context,
    registry,
    state,
    host,
    apply,
    select: (id: string, sub?: string) => {
      selection.value = selectOnly(entityTarget(id, sub));
    },
    pendingRuns,
  };
}
