// SPDX-License-Identifier: Apache-2.0
/**
 * The presenters that change only the entity object: `transform` (the local position, rotation and scale)
 * and `visibility`. They make no child object.
 */
import type { Transform, VisibilityValue } from "@scenity/scene/components";
import type { Presenter } from "../types";

/** The local transform of the entity: position, quaternion rotation `[x, y, z, w]` and scale. */
export const transformPresenter: Presenter<Transform, null> = {
  id: "transform",
  create(value, ctx) {
    ctx.entity.position.fromArray(value.position);
    ctx.entity.quaternion.fromArray(value.rotation);
    ctx.entity.scale.fromArray(value.scale);
    return null;
  },
  update(_object, value, _previous, ctx) {
    this.create(value, ctx);
    return true;
  },
  dispose(_object, ctx) {
    ctx.entity.position.set(0, 0, 0);
    ctx.entity.quaternion.identity();
    ctx.entity.scale.set(1, 1, 1);
  },
};

/** The visibility of the entity and its subtree. With no component, the entity is visible. */
export const visibilityPresenter: Presenter<VisibilityValue, null> = {
  id: "visibility",
  create(value, ctx) {
    ctx.entity.visible = value.visible !== false;
    return null;
  },
  update(_object, value, _previous, ctx) {
    ctx.entity.visible = value.visible !== false;
    return true;
  },
  dispose(_object, ctx) {
    ctx.entity.visible = true;
  },
};
