// SPDX-License-Identifier: Apache-2.0
/**
 * The fixture editor of the hierarchy tests: the garden scene in a scene channel with the view channel, a view layer
 * that gives the ops for the runtime, and a runner of the hierarchy commands, as the scene page has them.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  createCommandRegistry,
  createRunner,
  editProblems,
  entityTarget,
  HIERARCHY_COMMANDS,
  sameView,
  SceneChannel,
  sceneOpKind,
  VIEW_CHANNEL,
  VIEW_OP,
  ViewLayer,
  type CommandHost,
  type HierarchyOp,
  type HierarchyState,
  type OpContext,
  type SceneView,
} from "../src/index";
import { cell, components, garden } from "./helpers";

const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

export function hierarchyEditor(doc: SceneDocument = garden()) {
  const runtime: SceneOp[][] = [];
  const layer = new ViewLayer<SceneDocument>(doc);
  const send = (ops: readonly SceneOp[]): void => {
    if (ops.length > 0) runtime.push([...ops]);
  };
  const channel: SceneChannel<SceneDocument> = new SceneChannel<SceneDocument>({
    doc,
    registry: components,
    patch: (ops) => send(layer.docOps(channel.doc, ops)),
    channels: {
      [VIEW_CHANNEL]: {
        title: "view",
        read: () => layer.view,
        write: (next) => send(layer.viewOps(next as SceneView)),
        same: (a, b) => sameView(a as SceneView, b as SceneView),
      },
    },
    kinds: [VIEW_OP],
  });
  const selected = cell<readonly string[]>([]);
  const registry = createCommandRegistry<HierarchyState, CommandHost, HierarchyOp>();
  registry.register(HIERARCHY_COMMANDS);
  const kinds = [sceneOpKind(components), VIEW_OP];
  const runner = createRunner<HierarchyState, CommandHost, HierarchyOp>({
    registry,
    state: () => {
      const items = selected.value.map((id) => entityTarget(id));
      return { doc: channel.doc, view: layer.view, selection: items[0] ?? null, selected: items };
    },
    host: {
      select: (target) => {
        selected.value = target === null ? [] : [target.id];
      },
      undo: () => channel.undo(),
      redo: () => channel.redo(),
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
  /** Run a command as the owner: it applies immediately. */
  const run = (id: string, args: Record<string, unknown> = {}) => runner.run(id, args, { by: "owner" });
  return { channel, layer, runtime, selected, registry, runner, run };
}
