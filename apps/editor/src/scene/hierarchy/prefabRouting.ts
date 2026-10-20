// SPDX-License-Identifier: Apache-2.0
/**
 * The edits inside a prefab instance for the scene commands: a run with an entity of a
 * prefab instance (`<instance>/<entity>`) in the selection or in its arguments sees the expanded document, and its
 * ops on prefab entities become overrides of the instance (`routeOverrides` of `@scenity/editor-core`). So a rename,
 * a hide, a lock or a move of a prefab entity changes the instance only.
 */
import { routeOverrides } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageOp, SceneCommands } from "./sceneCommands";

/** An edit with its scene ops on the entities of prefab instances as overrides of the instances. */
export function routedEdit<E extends { readonly ops: readonly PageOp[] }>(doc: SceneDocument, edit: E): E {
  const scene = edit.ops.filter((op): op is Extract<PageOp, { kind: "scene" }> => op.kind === "scene");
  const routed = routeOverrides(
    doc,
    scene.map((op) => op.op),
  );
  // An edit with no op on a prefab entity stays as it is (the order of its scene and prefab ops too).
  if (routed.length === scene.length && routed.every((op, at) => op === scene[at]?.op)) return edit;
  const others = edit.ops.filter((op) => op.kind !== "scene");
  return { ...edit, ops: [...routed.map((op) => ({ kind: "scene" as const, op })), ...others] };
}

/** A run that names an entity of a prefab instance in its arguments sees the expanded document. */
export function insideRun(
  run: SceneCommands["run"],
  editor: ScenePageEditor,
  inside: { value: boolean; base: boolean },
): SceneCommands["run"] {
  return async (id, args = {}, options = {}) => {
    const named = Object.values(args).some(
      (value) => typeof value === "string" && value.includes("/") && editor.expanded.entities[value] !== undefined,
    );
    inside.value = named;
    inside.base = id.startsWith("prefab.");
    try {
      return await run(id, args, options);
    } finally {
      inside.value = false;
      inside.base = false;
    }
  };
}
