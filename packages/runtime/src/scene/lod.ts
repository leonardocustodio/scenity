// SPDX-License-Identifier: Apache-2.0
/**
 * The levels of detail of the models. The asset build writes one file for each LOD tier (`<id>.<tier>.glb`), and
 * Manifest 2 lists them in the `lods` of the record. The asset source gives
 * the chain of an asset: the file of the quality tier first (the tier caps the best level), then each coarser level
 * (`AssetSource.lods`).
 *
 * - A model with a `lod` value switches its level by its screen size: the diameter of its sphere over the height of
 *   the view. `lod.screen[i]` is the size under which the model takes the level `i + 1`.
 * - A frame is a function of the documents, the camera and the time. With a fixed camera (a document camera, a seek,
 *   a capture, the frame key path), the level comes only from the screen size. Thus a seek to `t` gives the levels of
 *   a play to `t`. Only a camera under the control of the user (an editor view camera) enables the hysteresis. A
 *   level then changes only when the size passes the threshold by the share `lod.hysteresis`. Thus a model at a
 *   threshold does not change its level at each frame of a camera move.
 * - The switcher acquires each level of a chain when the graph gets the model, so the levels load with the
 *   model and `SceneBuilder.ready()` waits for them. It releases them when the graph removes the model.
 */
import { Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { ModelValue } from "@scenity/scene/components";
import { isModel } from "./assets";
import { localSphere } from "./frameView";
import type { EntityNode } from "./graph";
import { modelTemplate, showModelTemplate } from "./presenters/model";
import type { AssetHandle } from "./types";

/** The share of a threshold that the size must pass before a level changes, when the value gives none. */
export const DEFAULT_HYSTERESIS = 0.1;

const eye = new Vector3();
const center = new Vector3();

/** The LOD state of one model holder. */
interface LodState {
  readonly node: EntityNode;
  readonly holder: Object3D;
  /** The asset references of the coarser levels, best first. */
  readonly refs: readonly string[];
  /** The template of each level after its load. Level 0 is the template of the model presenter. */
  readonly templates: (Object3D | undefined)[];
  /** The level that shows, or -1 before the first pick. */
  level: number;
}

/**
 * The level for a screen size. `screen` holds the thresholds from large to small. `max` is the coarsest level that
 * the chain has. A change from `current` needs a pass of the threshold by the share `hysteresis`.
 */
export function pickLevel(
  size: number,
  screen: readonly number[],
  current: number,
  hysteresis: number,
  max: number,
): number {
  let level = Math.min(Math.max(current, 0), max);
  while (level < max && size < (screen[level] ?? 0) * (1 - hysteresis)) level += 1;
  while (level > 0 && size > (screen[level - 1] ?? Number.POSITIVE_INFINITY) * (1 + hysteresis)) level -= 1;
  return level;
}

/** The screen size of a sphere: its diameter over the height of the view at its distance. */
export function screenSize(at: Vector3, radius: number, camera: PerspectiveCamera): number {
  const distance = at.distanceTo(eye.setFromMatrixPosition(camera.matrixWorld));
  if (distance <= radius) return Number.POSITIVE_INFINITY;
  return (radius * camera.zoom) / (distance * Math.tan((camera.fov * Math.PI) / 360));
}

function lodOf(node: EntityNode, holder: Object3D): ModelValue["lod"] {
  const part = node.parts.get("model");
  return part?.object === holder ? (part.value as ModelValue).lod : undefined;
}

export class LodSwitcher {
  readonly #assets: AssetHandle;
  readonly #track: (work: Promise<unknown>) => void;
  #states = new Map<Object3D, LodState>();

  constructor(assets: AssetHandle, track: (work: Promise<unknown>) => void) {
    this.#assets = assets;
    this.#track = track;
  }

  /**
   * Acquire the levels of each new model with a `lod` value, then release the levels of each removed model. The
   * new acquires come first, so a level that both use stays in the cache.
   */
  prepare(nodes: Iterable<EntityNode>): void {
    const next = new Map<Object3D, LodState>();
    for (const node of nodes) {
      const holder = node.parts.get("model")?.object ?? null;
      const value = holder === null ? undefined : lodOf(node, holder);
      if (holder === null || value === undefined) continue;
      next.set(holder, this.#states.get(holder) ?? this.#start(node, holder));
    }
    for (const [holder, state] of this.#states) if (next.get(holder) !== state) this.#stop(state);
    this.#states = next;
  }

  /**
   * Pick the level of each model for the camera. With `hysteresis` false, the level is a function of only the screen
   * size. True is only for a camera under the control of the user. The result is true when a model shows another
   * template.
   */
  update(camera: PerspectiveCamera, hysteresis = false): boolean {
    let changed = false;
    for (const state of this.#states.values()) {
      const lod = lodOf(state.node, state.holder);
      if (lod === undefined) continue;
      state.templates[0] ??= modelTemplate(state.holder);
      const base = state.templates[0];
      if (base === undefined) continue;
      const sphere = localSphere(base);
      center.copy(sphere.center).applyMatrix4(state.holder.matrixWorld);
      const radius = sphere.radius * state.holder.matrixWorld.getMaxScaleOnAxis();
      const screen = [...lod.screen].sort((a, b) => b - a);
      const max = Math.min(screen.length, state.templates.length - 1);
      // With no hysteresis the pick starts at level 0, so the level of a size does not depend on the frames before.
      const held = hysteresis && state.level >= 0;
      const share = held ? (lod.hysteresis ?? DEFAULT_HYSTERESIS) : 0;
      const level = pickLevel(screenSize(center, radius, camera), screen, held ? state.level : 0, share, max);
      const template = state.templates[level];
      if (level === state.level || template === undefined) continue;
      if (!showModelTemplate(state.holder, template, state.node.ctx)) continue;
      state.level = level;
      changed = true;
    }
    return changed;
  }

  /** The level that each model with a `lod` value shows, by entity ID (for the tests and the stats). */
  levels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const state of this.#states.values()) out[state.node.id] = Math.max(0, state.level);
    return out;
  }

  /** Release each level of each model. */
  clear(): void {
    for (const state of this.#states.values()) this.#stop(state);
    this.#states = new Map();
  }

  #start(node: EntityNode, holder: Object3D): LodState {
    const value = node.parts.get("model")?.value as ModelValue;
    const refs = this.#assets.lods?.(value.asset) ?? [];
    const templates = Array.from({ length: refs.length + 1 }, (): Object3D | undefined => undefined);
    const state: LodState = { node, holder, refs, templates, level: -1 };
    refs.forEach((ref, index) => {
      const load = this.#assets.acquire(ref, "model").then(
        (asset) => {
          if (isModel(asset)) state.templates[index + 1] = asset;
        },
        (error: unknown) => {
          node.ctx.warn(
            `${node.id}: the level "${ref}" did not load: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
      this.#track(load);
    });
    return state;
  }

  /** Show the model again (when its holder stays), then release its levels. */
  #stop(state: LodState): void {
    const base = state.templates[0];
    if (base !== undefined && state.level > 0 && modelTemplate(state.holder) !== undefined) {
      showModelTemplate(state.holder, base, state.node.ctx);
    }
    for (const ref of state.refs) this.#assets.release(ref, "model");
  }
}
