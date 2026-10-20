// SPDX-License-Identifier: Apache-2.0
/**
 * A new scene of a project: the ID, the name and the path of an empty `scenity.scene/1` document in the project. The
 * host or the dev server writes the file (the `scene.create` call). A project file that lists its scenes then also
 * lists the new path. No Vue import, no DOM.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";

/** The folder of new scenes in a project. */
export const NEW_SCENE_FOLDER = "scenes";

/** The ID, the name and the path of a new scene. */
export interface NewScenePlan {
  readonly path: string;
  readonly id: string;
  readonly name: string;
}

/** A scene ID from a name: lower case letters, digits, "_" and "-". "scene" for a name with none of them. */
export function sceneIdOf(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return id === "" ? "scene" : id;
}

/**
 * The plan of a new scene with the name `name`. The path is `<folder>/<id>.scene.json`. When a path of `taken` has it
 * already, the ID gets a number ("-2", "-3", …).
 */
export function newScenePlan(name: string, taken: Iterable<string>, folder = NEW_SCENE_FOLDER): NewScenePlan {
  const clean = name.trim() === "" ? "New scene" : name.trim().slice(0, 200);
  const used = new Set(taken);
  const base = sceneIdOf(clean);
  let id = base;
  for (let count = 2; used.has(`${folder}/${id}.scene.json`); count += 1) id = `${base}-${String(count)}`;
  return { path: `${folder}/${id}.scene.json`, id, name: clean };
}

/** The empty scene document of a plan: no entities, the ID and the name. */
export function newSceneDocument(plan: Pick<NewScenePlan, "id" | "name">): SceneDocument {
  return { format: "scenity.scene/1", id: plan.id, name: plan.name, entities: {} };
}
