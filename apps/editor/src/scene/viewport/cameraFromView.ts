// SPDX-License-Identifier: Apache-2.0
/**
 * The camera "from the view" of the Create menu: a document camera at the place of the main view, with the same
 * direction. The command runs the preset `entity.create.camera` with the place, the turn and the tilt of the view.
 * Thus it is one step of the history and one agent command.
 */
import type { Vec3 } from "@scenity/scene/math";
import { t } from "../../texts";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";

const DEGREES = 180 / Math.PI;

/** The turn about Y and the tilt (degrees) of an entity that looks along `forward` (an entity looks along -Z). */
export function turnOfForward(forward: Vec3): { readonly yaw: number; readonly pitch: number } {
  const [x, y, z] = forward;
  const length = Math.hypot(x, y, z) || 1;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return { yaw: round(Math.atan2(-x, -z) * DEGREES), pitch: round(Math.asin(y / length) * DEGREES) };
}

/** The command. `view` gives the current place and direction of the main view, or null. */
export function cameraFromViewCommand(
  view: () => { readonly position: Vec3; readonly forward: Vec3 } | null,
): PageKeyCommandSpec {
  return {
    id: "entity.create.cameraFromView",
    menu: "entity/create",
    title: t("create-camera-from-view"),
    when: () => (view() === null ? t("create-camera-from-view-none") : null),
    run: async () => {
      const now = view();
      if (now === null) return;
      const [x, y, z] = now.position.map((value) => Math.round(value * 1000) / 1000);
      const turn = turnOfForward(now.forward);
      await pageKeys().execute("entity.create.camera", { name: t("create-camera-name"), x, y, z, ...turn });
    },
  };
}
