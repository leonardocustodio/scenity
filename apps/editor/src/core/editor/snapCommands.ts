// SPDX-License-Identifier: Apache-2.0
/**
 * The snap commands of the scene editor:
 *
 * - `prop.snap` snaps a prop to a named target or to the nearest target, with the rules of snapPlace.ts. The snap
 *   targets come from the plugin (`surface:cart`, `wall:head`, `socket:wall_outlet`, …). Claude uses it through
 *   `scene_command`: "put it on the cart" is `prop.snap { prop: "pillow", target: "surface:cart" }`.
 * - `prop.place` sets the full place of a prop (x, y, z and the turn). A drag of the owner becomes this command when a
 *   snap lifts or turns the prop and the owner stages the drag as a proposal (⌘+drag).
 *
 * Both commands give tune ops of the place (`room.props.<slot>.at.*`, `.yaw`), as the other prop commands do.
 */
import { editorRoom } from "../sceneSource";
import { CommandError, grid, num, numberArg, textArg, type Command, labCommands } from "./commandKit";
import { placeOps, propOf, PROP_ARG, PROP_RULE } from "./propCommands";
import { keptBoxes } from "./sceneBoxes";
import { nearestSnap, snapProp, snapToTarget, SNAP_RADIUS } from "./snapPlace";
import { snapTargets, targetNamed, type SnapScene } from "./snapTypes";
import { t } from "../../texts";

/** The snap scene of a command state: the room kit, the tune values and the boxes that the page keeps. */
export function commandScene(
  tunes: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
): SnapScene {
  return { kit: editorRoom().kit, tunes, defaults, boxes: keptBoxes() };
}

export const SNAP_COMMANDS: readonly Command[] = labCommands([
  {
    id: "prop.snap",
    title: t("commands-snap-prop"),
    key: t("commands-snap-prop-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      target: {
        type: "string",
        default: "nearest",
        description: t("commands-snap-prop-arg-target"),
      },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const scene = commandScene(state.tunes, state.defaults);
      const targets = snapTargets(scene);
      const prop = snapProp(scene, slot);
      const name = textArg(args, "target");
      let snapped;
      if (name === "nearest") snapped = nearestSnap(place, targets, prop);
      else {
        const target = targetNamed(targets, name);
        if (target === undefined) {
          throw new CommandError(
            t("commands-snap-no-target", { name, targets: targets.map((item) => item.id).join(", ") }),
          );
        }
        try {
          snapped = snapToTarget(place, target, prop);
        } catch (error) {
          throw new CommandError(error instanceof Error ? error.message : String(error));
        }
      }
      const radius = String(SNAP_RADIUS * 100);
      const { target, surface } = snapped;
      const title =
        target !== null
          ? t("commands-snap-prop-edit", { slot, label: target.label, id: target.id })
          : surface !== null
            ? t("commands-snap-prop-edit-surface", { slot, label: surface.label, id: surface.id, radius })
            : t("commands-snap-prop-edit-none", { slot, radius });
      return { kind: "edit", title, ops: placeOps(slot, place, snapped.place) };
    },
  },
  {
    id: "prop.place",
    title: t("commands-snap-place"),
    key: t("commands-snap-place-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      x: { type: "number", optional: true, description: t("commands-prop-arg-x") },
      y: { type: "number", optional: true, min: 0, description: t("commands-prop-arg-height") },
      z: { type: "number", optional: true, description: t("commands-prop-arg-z") },
      yaw: {
        type: "number",
        optional: true,
        description: t("commands-snap-place-arg-yaw"),
      },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const [x, y, z, yaw] = [numberArg(args, "x"), numberArg(args, "y"), numberArg(args, "z"), numberArg(args, "yaw")];
      if (x === undefined && y === undefined && z === undefined && yaw === undefined) {
        throw new CommandError(t("commands-snap-place-needs"));
      }
      const at = [grid(x ?? place.at[0]), grid(y ?? place.at[1]), grid(z ?? place.at[2])] as const;
      const turn = grid(yaw ?? place.yaw);
      return {
        kind: "edit",
        title: t("commands-snap-place-edit", { slot, x: num(at[0]), y: num(at[1]), z: num(at[2]), turn: num(turn) }),
        ops: placeOps(slot, place, { at: [...at], yaw: turn }),
      };
    },
  },
]);
