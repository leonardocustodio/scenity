// SPDX-License-Identifier: Apache-2.0
/**
 * The prop and scratch commands of the scene editor. The `prop.*` commands move, lift, turn, nudge and reset a prop
 * place (tune ops of `room.props.<slot>.at.0..2` and `.yaw`). The `scratch.*` commands move, turn, duplicate, remove
 * and promote a scratch prop. They are view commands, because the scratch list is not in the history of the tune
 * values.
 */
import type { Vec3 } from "@scenity/character";
import { placeOf, placePaths, turnPlace, type PropPlace } from "../edit/placeDrag";
import {
  CommandError,
  grid,
  num,
  numberArg,
  textArg,
  type ArgSpec,
  type Args,
  type Command,
  type CommandState,
  type SelectionRule,
  labCommands,
} from "./commandKit";
import type { EditOp } from "./ops";
import { t } from "../../texts";

const DEG = Math.PI / 180;
/** The steps of `prop.nudge`, as the nudge keys of the Tune tab (usePropNudge.ts): 1 cm and 1°. */
const NUDGE = { metres: 0.01, metresGrain: 1e4, radians: DEG, radiansGrain: 1e5 } as const;

/** The prop slots with a tuned place, in the sequence of the registry. */
export function propSlots(defaults: ReadonlyMap<string, number>): string[] {
  return [...defaults.keys()].flatMap((path) => /^room\.props\.([^.]+)\.yaw$/.exec(path)?.[1] ?? []);
}

/** The slot of a prop command (the `prop` argument, else the selected prop) and its current place. */
export function propOf(
  args: Args,
  state: Pick<CommandState, "selection" | "tunes" | "defaults">,
): { readonly slot: string; readonly place: PropPlace } {
  const named = typeof args.prop === "string" ? args.prop : null;
  const slot = named ?? (state.selection?.kind === "prop" ? state.selection.id : null);
  if (slot === null) throw new CommandError(t("commands-prop-select"));
  const place = placeOf(slot, state.tunes, state.defaults);
  if (place === null) {
    throw new CommandError(t("commands-prop-no-place", { slot, props: propSlots(state.defaults).join(", ") }));
  }
  return { slot, place };
}

/** The tune ops of the parts of a place that change. */
export function placeOps(slot: string, before: PropPlace, after: PropPlace): EditOp[] {
  const paths = placePaths(slot);
  const ops: EditOp[] = [];
  paths.at.forEach((path, axis) => {
    const value = after.at[axis] ?? 0;
    if (value !== before.at[axis]) ops.push({ kind: "tune", path, value });
  });
  if (after.yaw !== before.yaw) ops.push({ kind: "tune", path: paths.yaw, value: after.yaw });
  return ops;
}

export const PROP_ARG: ArgSpec = {
  type: "string",
  optional: true,
  description: t("commands-prop-arg-prop"),
};
export const PROP_RULE: SelectionRule = { kinds: ["prop"], orArg: "prop" };
const SCRATCH_RULE: SelectionRule = { kinds: ["scratch"] };

/** The ID of the selected scratch prop (the rule makes sure that one is selected). */
function scratchOf(state: CommandState): string {
  if (state.selection?.kind !== "scratch") throw new CommandError(t("commands-prop-scratch-select"));
  return state.selection.id;
}

export const PROP_COMMANDS: readonly Command[] = labCommands([
  {
    id: "prop.move",
    title: t("commands-prop-move"),
    key: t("commands-prop-move-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      x: { type: "number", optional: true, description: t("commands-prop-arg-x") },
      z: { type: "number", optional: true, description: t("commands-prop-arg-z") },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const x = numberArg(args, "x");
      const z = numberArg(args, "z");
      if (x === undefined && z === undefined) throw new CommandError(t("commands-prop-move-needs"));
      const at: Vec3 = [grid(x ?? place.at[0]), place.at[1], grid(z ?? place.at[2])];
      return {
        kind: "edit",
        title: t("commands-prop-move-edit", { slot, x: num(at[0]), z: num(at[2]) }),
        ops: placeOps(slot, place, { at, yaw: place.yaw }),
      };
    },
  },
  {
    id: "prop.lift",
    title: t("commands-prop-lift"),
    key: t("commands-prop-lift-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      y: { type: "number", min: 0, description: t("commands-prop-lift-arg-y") },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const y = grid(numberArg(args, "y") ?? place.at[1]);
      return {
        kind: "edit",
        title: t("commands-prop-lift-edit", { slot, y: num(y) }),
        ops: placeOps(slot, place, { at: [place.at[0], y, place.at[2]], yaw: place.yaw }),
      };
    },
  },
  {
    id: "prop.turn",
    title: t("commands-prop-turn"),
    key: t("commands-prop-turn-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      degrees: {
        type: "number",
        default: 15,
        description: t("commands-prop-turn-arg-degrees"),
      },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const degrees = numberArg(args, "degrees") ?? 15;
      return {
        kind: "edit",
        title: t("commands-prop-turn-edit", { slot, degrees: num(degrees) }),
        ops: placeOps(slot, place, turnPlace(place, degrees)),
      };
    },
  },
  {
    id: "prop.nudge",
    title: t("commands-prop-nudge"),
    key: t("commands-prop-nudge-key"),
    kind: "edit",
    args: {
      prop: PROP_ARG,
      axis: { type: "string", values: ["x", "y", "z", "yaw"], description: t("commands-prop-nudge-arg-axis") },
      steps: {
        type: "number",
        integer: true,
        default: 1,
        description: t("commands-prop-nudge-arg-steps"),
      },
    },
    selection: PROP_RULE,
    build(args, state) {
      const { slot, place } = propOf(args, state);
      const axis = textArg(args, "axis");
      const steps = numberArg(args, "steps") ?? 1;
      const at: [number, number, number] = [place.at[0], place.at[1], place.at[2]];
      let yaw = place.yaw;
      if (axis === "yaw") yaw = Math.round((yaw + steps * NUDGE.radians) * NUDGE.radiansGrain) / NUDGE.radiansGrain;
      else {
        const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        at[index] = Math.round((at[index] + steps * NUDGE.metres) * NUDGE.metresGrain) / NUDGE.metresGrain;
      }
      return {
        kind: "edit",
        title: t("commands-prop-nudge-edit", { slot, axis, steps: `${steps > 0 ? "+" : ""}${String(steps)}` }),
        ops: placeOps(slot, place, { at, yaw }),
      };
    },
  },
  {
    id: "prop.reset",
    title: t("commands-prop-reset"),
    key: null,
    kind: "edit",
    args: { prop: PROP_ARG },
    selection: PROP_RULE,
    build(args, state) {
      const { slot } = propOf(args, state);
      const paths = placePaths(slot);
      const tuned = [...paths.at, paths.yaw].filter((path) => state.tunes[path] !== undefined);
      return {
        kind: "edit",
        title: t("commands-prop-reset-edit", { slot }),
        ops: tuned.map((path): EditOp => ({ kind: "tune", path, value: null })),
      };
    },
  },
]);

export const SCRATCH_COMMANDS: readonly Command[] = labCommands([
  {
    id: "scratch.move",
    title: t("commands-prop-scratch-move"),
    key: t("commands-prop-scratch-move-key"),
    kind: "view",
    args: {
      x: { type: "number", optional: true, description: t("commands-prop-scratch-arg-x") },
      y: { type: "number", optional: true, min: 0, description: t("commands-prop-arg-height") },
      z: { type: "number", optional: true, description: t("commands-prop-scratch-arg-z") },
    },
    selection: SCRATCH_RULE,
    build(args, state) {
      const id = scratchOf(state);
      return {
        kind: "view",
        title: t("commands-prop-scratch-move-edit", { id }),
        run(host) {
          const place = host.scratchPlace(id);
          if (place === null) throw new CommandError(t("commands-prop-scratch-none", { id }));
          const [x, y, z] = [numberArg(args, "x"), numberArg(args, "y"), numberArg(args, "z")];
          host.moveScratch(id, {
            at: [grid(x ?? place.at[0]), grid(y ?? place.at[1]), grid(z ?? place.at[2])],
            yaw: place.yaw,
          });
          return null;
        },
      };
    },
  },
  {
    id: "scratch.turn",
    title: t("commands-prop-scratch-turn"),
    key: t("commands-prop-turn-key"),
    kind: "view",
    args: { degrees: { type: "number", default: 15, description: t("commands-prop-scratch-turn-arg-degrees") } },
    selection: SCRATCH_RULE,
    build(args, state) {
      const id = scratchOf(state);
      const degrees = numberArg(args, "degrees") ?? 15;
      return {
        kind: "view",
        title: t("commands-prop-turn-edit", { slot: id, degrees: num(degrees) }),
        run(host) {
          const place = host.scratchPlace(id);
          if (place === null) throw new CommandError(t("commands-prop-scratch-none", { id }));
          host.moveScratch(id, turnPlace(place, degrees));
          return null;
        },
      };
    },
  },
  {
    id: "scratch.duplicate",
    title: t("commands-prop-scratch-duplicate"),
    key: null,
    kind: "view",
    args: {},
    selection: SCRATCH_RULE,
    build(_args, state) {
      const id = scratchOf(state);
      return {
        kind: "view",
        title: t("commands-prop-scratch-duplicate-edit", { id }),
        run: (host) => host.duplicateScratch(id),
      };
    },
  },
  {
    id: "scratch.remove",
    title: t("commands-prop-scratch-remove"),
    key: null,
    kind: "view",
    args: {},
    selection: SCRATCH_RULE,
    build(_args, state) {
      const id = scratchOf(state);
      return {
        kind: "view",
        title: t("commands-prop-scratch-remove-edit", { id }),
        run(host) {
          host.removeScratch(id);
          return null;
        },
      };
    },
  },
  {
    id: "scratch.promote",
    title: t("commands-prop-scratch-promote"),
    key: null,
    kind: "view",
    args: {
      dry: {
        type: "boolean",
        default: true,
        description: t("commands-prop-scratch-promote-arg-dry"),
      },
    },
    selection: SCRATCH_RULE,
    build(args, state) {
      const id = scratchOf(state);
      const dry = args.dry !== false;
      return {
        kind: "view",
        title: t("commands-prop-scratch-promote-edit", { id, dry: dry ? "yes" : "no" }),
        run: (host) => host.promoteScratch(id, dry),
      };
    },
  },
]);
