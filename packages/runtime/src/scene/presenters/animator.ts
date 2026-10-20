// SPDX-License-Identifier: Apache-2.0
/**
 * The `animator` presenter: an empty holder group that keeps the component value for the animator driver
 * (`scene/animate.ts`). The driver poses the skinned model of the same entity at a time. The presenter has no time.
 * A change of only the parameter values (the values of a sequence at a time) keeps the revision: the parameter source
 * of the driver gives these values. Each other change makes a new revision, and the driver binds the model again.
 *
 * An animator with a `clipSource` also loads that model asset. The driver retargets its clips onto the model of the
 * entity (`@scenity/character/characterRig`). `SceneBuilder.ready()` waits for the load.
 */
import { Group, type Object3D } from "three";
import type { AnimatorValue } from "@scenity/scene/components";
import { isModel } from "../assets";
import type { Presenter, PresenterContext } from "../types";

/** The value of an animator holder and its revision. */
export interface AnimatorHolder {
  readonly entity: string;
  value: AnimatorValue;
  revision: number;
  /** The loaded model of the clip source, after the end of its load. */
  source?: Object3D;
  /** True when the clip source did not load: the animator plays the clips of its own model. */
  sourceFailed?: boolean;
  disposed?: boolean;
}

const holders = new WeakMap<Object3D, AnimatorHolder>();

/** The value without its parameter values, for the compare of two values. */
function withoutParameters(value: AnimatorValue): string {
  return JSON.stringify({ ...value, parameters: null });
}

/** Start the load of the clip source of an animator. */
function loadSource(state: AnimatorHolder, ctx: PresenterContext): void {
  const ref = state.value.clipSource?.asset;
  if (ref === undefined) return;
  const load = ctx.assets.acquire(ref, "model").then(
    (asset) => {
      if (state.disposed === true) return;
      if (isModel(asset)) {
        state.source = asset;
      } else {
        state.sourceFailed = true;
        ctx.warn(`${ctx.id}: the clip source "${ref}" is not a model`);
      }
      state.revision += 1;
    },
    (error: unknown) => {
      state.sourceFailed = true;
      state.revision += 1;
      ctx.warn(
        `${ctx.id}: the clip source "${ref}" did not load: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );
  ctx.track(load);
}

export const animatorPresenter: Presenter<AnimatorValue, Group> = {
  id: "animator",
  create(value, ctx) {
    const holder = new Group();
    holder.name = "animator";
    const state: AnimatorHolder = { entity: ctx.id, value, revision: 0 };
    holders.set(holder, state);
    loadSource(state, ctx);
    return holder;
  },
  update(holder, value, previous) {
    const state = holders.get(holder);
    if (state === undefined || value.clipSource?.asset !== previous.clipSource?.asset) return false;
    state.value = value;
    if (withoutParameters(value) !== withoutParameters(previous)) state.revision += 1;
    return true;
  },
  dispose(holder, ctx) {
    const state = holders.get(holder);
    holders.delete(holder);
    if (state === undefined) return;
    state.disposed = true;
    const ref = state.value.clipSource?.asset;
    if (ref !== undefined) ctx.assets.release(ref, "model");
  },
};

/** The animator value of a holder object, or undefined for another object. */
export function animatorHolder(object: Object3D): AnimatorHolder | undefined {
  return holders.get(object);
}
