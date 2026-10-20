// SPDX-License-Identifier: Apache-2.0
/**
 * The documents of the studio host: an agent edits a scene of a project with no open editor window. The host reads
 * the scene file and runs a scene command of `@scenity/editor-core` on it (the entity, hierarchy, transform, component
 * and create commands). It writes the file through the one gate of the writer (`saveMeasured`: the host measures the
 * rules of the save). It gives the ops, so the open windows of the scene apply the same change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saveMeasured } from "@scenity/cli/check";
import { sceneTextHash } from "@scenity/cli/sceneFile";
import {
  COMPONENT_COMMANDS,
  createCommandRegistry,
  ENTITY_COMMANDS,
  HIERARCHY_COMMANDS,
  PRESET_COMMANDS,
  TRANSFORM_COMMANDS,
  type CommandHost,
  type ComponentCommandState,
  type EntityHost,
  type EntityState,
  type HierarchyOp,
} from "@scenity/editor-core";
import { applyOps, builtinRegistry, readDocument, writeDocument } from "@scenity/scene";
import type { SceneOp } from "@scenity/scene/schema/entity";

/** A run of a command on a scene file. */
export interface DocumentRun {
  /** The path of the scene file in the project (`scenes/main.scene.json`). */
  readonly path: string;
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** The result of a run: the title and the scene ops of the change, or the reason of a refusal. */
export type DocumentRunResult =
  | {
      readonly ok: true;
      readonly title: string;
      readonly ops: readonly SceneOp[];
      /** The text and the hash of the file that the host wrote (the new base of the open windows). */
      readonly saved: { readonly text: string; readonly hash: string };
    }
  | { readonly ok: false; readonly reason: string };

type State = EntityState & ComponentCommandState;

/** The commands of the host on a scene with no window (no clipboard, no selection). */
function hostCommands() {
  const registry = createCommandRegistry<State, CommandHost & EntityHost, HierarchyOp>();
  registry.register(HIERARCHY_COMMANDS);
  registry.register(ENTITY_COMMANDS);
  registry.register(TRANSFORM_COMMANDS);
  registry.register(COMPONENT_COMMANDS);
  registry.register(PRESET_COMMANDS);
  return registry;
}

/** Run a scene command on a scene file of the project folder `dir` and write the file. */
export async function runDocumentCommand(dir: string, run: DocumentRun): Promise<DocumentRunResult> {
  const components = builtinRegistry();
  let disk: string;
  try {
    disk = readFileSync(join(dir, run.path), "utf8");
  } catch {
    return { ok: false, reason: `No scene file ${run.path} in the project.` };
  }
  const read = readDocument(disk, "scene", { registry: components });
  if (!read.ok) return { ok: false, reason: `${run.path} does not read: ${read.errors[0]?.message ?? ""}` };
  const state: State = {
    doc: read.doc,
    view: { solo: [], locked: [] },
    selection: null,
    selected: [],
    clipboard: null,
    registry: components,
  };
  let outcome;
  try {
    outcome = hostCommands().prepare(run.command, run.args ?? {}, state);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (outcome.kind !== "edit") return { ok: false, reason: `${run.command} is no edit of the document.` };
  const ops = outcome.ops.flatMap((op) => (op.kind === "scene" ? [op.op] : []));
  const applied = applyOps(read.doc, ops, components);
  if (!applied.ok) return { ok: false, reason: applied.reason };
  const text = writeDocument(applied.doc);
  const saved = await saveMeasured(dir, { path: run.path, text, baseHash: sceneTextHash(disk) });
  if (!saved.ok) return { ok: false, reason: "reason" in saved ? saved.reason : "The file changed on the disk." };
  return { ok: true, title: outcome.title, ops, saved: { text: saved.text, hash: saved.hash } };
}
