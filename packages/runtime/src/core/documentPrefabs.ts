// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab instances of a document core. With the prefabs of a "load", the core draws and picks the expanded scene
 * (`expandPrefabs` of `@scenity/scene`): each instance gets the entities of its prefab, with the IDs
 * `<instance>/<entity>`. This module keeps the scene before the expansion (the base):
 *
 * - a patch is ops on the base (the editor has the base document); the base changes, then it expands again, and the
 *   builder shows the new expanded scene (a build changes only the entities that differ);
 * - a new prefab set (an apply of overrides to a prefab, an undo) expands the same base again.
 *
 * A core with no prefab set, or a scene with no instance, keeps the plain path: the builder applies the ops itself,
 * and the frames do not change.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import { expandPrefabs, hasInstances, prefabSetResolver } from "@scenity/scene/prefabs";
import { applyOps } from "@scenity/scene/ops";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { ScenePrefabs } from "../protocolScene";
import type { ApplyOutcome } from "../scene/builder";

export class DocumentPrefabs {
  #prefabs: ScenePrefabs | null = null;
  /** The base scene before the expansion while it differs from the shown scene, else null. */
  #base: SceneDocument | null = null;

  constructor(private readonly registry: () => ComponentRegistry) {}

  /** A load of documents: the scene that the builder shows. */
  load(scene: SceneDocument, prefabs: ScenePrefabs | undefined): SceneDocument {
    this.#prefabs = prefabs ?? null;
    return this.#show(scene);
  }

  /** A new prefab set: the expansion of the base again. `shown` is the current scene of the builder. */
  use(prefabs: ScenePrefabs, shown: SceneDocument): SceneDocument {
    this.#prefabs = prefabs;
    return this.#show(this.#base ?? shown);
  }

  /**
   * A patch: null when the core has no prefab set (the builder applies the ops itself). Else the ops apply to the
   * base, and `show` gets the new expanded scene. `shown` is the current scene of the builder.
   */
  patch(ops: readonly SceneOp[], shown: SceneDocument, show: (scene: SceneDocument) => void): ApplyOutcome | null {
    if (this.#prefabs === null) return null;
    const result = applyOps(this.#base ?? shown, ops, this.registry());
    if (!result.ok) return { ok: false, index: result.index, reason: result.reason };
    show(this.#show(result.doc));
    return { ok: true, inverse: result.inverse, warnings: result.warnings };
  }

  #show(base: SceneDocument): SceneDocument {
    const prefabs = this.#prefabs;
    if (prefabs === null || !hasInstances(base)) {
      this.#base = null;
      return base;
    }
    const assets = prefabs.assets ?? {};
    const resolve = prefabSetResolver(prefabs.set, prefabs.path, (id) => assets[id]);
    const shown = expandPrefabs(base, resolve, this.registry()).doc;
    this.#base = base;
    return shown;
  }
}
