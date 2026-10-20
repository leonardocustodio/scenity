// SPDX-License-Identifier: Apache-2.0
/**
 * The light commands (`light.*`) of the scene editor. Each edit gives tune ops of `light` (model/light.ts). "Save
 * placement" writes them with `labs tune-apply`.
 *
 * - `light.move` (an edit): put the key light (or the fill light) at a place. The drag of the key light handle
 *   (editor/useLight.ts) writes the same values. With ⌘ at the press, the drag runs this command as a proposal.
 * - `light.aim` (an edit): the point that the key light lights.
 * - `light.intensity` and `light.colour` (edits): the sliders and the colour fields of the Light section.
 * - `light.reset` (an edit): return the tuned values of one light, or of the whole light, to the values of the code.
 * - `light.show` (a view command, the key I): show or hide the key light handle.
 */
import type { Vec3 } from "@scenity/character";
import {
  CommandError,
  NO_RULE,
  num,
  numberArg,
  textArg,
  type Args,
  type Command,
  type CommandState,
  labCommands,
} from "./commandKit";
import {
  COLOUR_PARTS,
  colourOps,
  hexOf,
  intensityOps,
  LIGHT_PARTS,
  lightOf,
  lightResetOps,
  moveOps,
  parseColour,
  PLACED_PARTS,
  type ColourPart,
  type LightPart,
  type LightView,
  type PlacedPart,
} from "./lightEdit";
import type { TuneOp } from "./ops";
import { t } from "../../texts";

/** The light of a command state. Throws an error when the runtime has no light tunables. */
function viewOf(state: CommandState): LightView {
  const view = lightOf(state.tunes, state.defaults);
  if (view === null) throw new CommandError(t("commands-light-no-tunables"));
  return view;
}

/** The ops that change something, or an error with the words of `same`. */
function changed(ops: readonly TuneOp[], state: CommandState, same: string): TuneOp[] {
  const now = (path: string): number | undefined => state.tunes[path] ?? state.defaults.get(path);
  if (ops.every((op) => op.value === now(op.path))) throw new CommandError(same);
  return [...ops];
}

const POINT_ARGS = {
  x: { type: "number", optional: true, description: t("commands-light-arg-x") },
  y: { type: "number", optional: true, description: t("commands-light-arg-y") },
  z: { type: "number", optional: true, description: t("commands-light-arg-z") },
} as const;

/** A point from the x, y and z arguments. A missing part comes from `now`. */
function pointOf(args: Args, now: Vec3, command: string): Vec3 {
  const [x, y, z] = [numberArg(args, "x"), numberArg(args, "y"), numberArg(args, "z")];
  if (x === undefined && y === undefined && z === undefined)
    throw new CommandError(t("commands-light-needs", { command }));
  return [x ?? now[0], y ?? now[1], z ?? now[2]];
}

export const LIGHT_COMMANDS: readonly Command[] = labCommands([
  {
    id: "light.move",
    title: t("commands-light-move"),
    key: t("commands-light-move-key"),
    kind: "edit",
    args: {
      part: { type: "string", default: "key", values: PLACED_PARTS, description: t("commands-light-move-arg-part") },
      ...POINT_ARGS,
    },
    selection: NO_RULE,
    build(args, state) {
      const view = viewOf(state);
      const part = textArg(args, "part") as PlacedPart;
      const at = pointOf(args, view[part].at, "light.move");
      const ops = changed(moveOps(part, at), state, t("commands-light-move-same", { part }));
      return { kind: "edit", title: t("commands-light-move-edit", { part, at: at.map(num).join(", ") }), ops };
    },
  },
  {
    id: "light.aim",
    title: t("commands-light-aim"),
    key: null,
    kind: "edit",
    args: POINT_ARGS,
    selection: NO_RULE,
    build(args, state) {
      const view = viewOf(state);
      const at = pointOf(args, view.key.aim, "light.aim");
      const ops = changed(moveOps("aim", at), state, t("commands-light-aim-same"));
      return { kind: "edit", title: t("commands-light-aim-edit", { at: at.map(num).join(", ") }), ops };
    },
  },
  {
    id: "light.intensity",
    title: t("commands-light-intensity"),
    key: t("commands-light-section-key"),
    kind: "edit",
    args: {
      part: {
        type: "string",
        default: "key",
        values: LIGHT_PARTS,
        description: t("commands-light-intensity-arg-part"),
      },
      value: { type: "number", min: 0, max: 20, description: t("commands-light-intensity-arg-value") },
    },
    selection: NO_RULE,
    build(args, state) {
      viewOf(state);
      const part = textArg(args, "part") as LightPart;
      const value = numberArg(args, "value") ?? 0;
      const ops = changed(intensityOps(part, value), state, t("commands-light-intensity-same", { part }));
      return { kind: "edit", title: t("commands-light-intensity-edit", { part, value: num(value) }), ops };
    },
  },
  {
    id: "light.colour",
    title: t("commands-light-colour"),
    key: t("commands-light-section-key"),
    kind: "edit",
    args: {
      part: {
        type: "string",
        default: "key",
        values: COLOUR_PARTS,
        description: t("commands-light-colour-arg-part"),
      },
      colour: { type: "string", description: t("commands-light-colour-arg-colour") },
    },
    selection: NO_RULE,
    build(args, state) {
      viewOf(state);
      const part = textArg(args, "part") as ColourPart;
      const rgb = parseColour(textArg(args, "colour"));
      if (rgb === null) throw new CommandError(t("commands-light-colour-bad"));
      const ops = changed(colourOps(part, rgb), state, t("commands-light-colour-same", { part, hex: hexOf(rgb) }));
      return { kind: "edit", title: t("commands-light-colour-edit", { part, hex: hexOf(rgb) }), ops };
    },
  },
  {
    id: "light.reset",
    title: t("commands-light-reset"),
    key: null,
    kind: "edit",
    args: {
      part: {
        type: "string",
        optional: true,
        values: LIGHT_PARTS,
        description: t("commands-light-reset-arg-part"),
      },
    },
    selection: NO_RULE,
    build(args, state) {
      const part = textArg(args, "part");
      const ops = lightResetOps(state.tunes, part === "" ? null : (part as LightPart));
      if (ops.length === 0) throw new CommandError(t("commands-light-reset-none"));
      return {
        kind: "edit",
        title: part === "" ? t("commands-light-reset-edit") : t("commands-light-reset-edit-part", { part }),
        ops,
      };
    },
  },
  {
    id: "light.show",
    title: t("commands-light-show"),
    key: "I",
    kind: "view",
    args: { on: { type: "boolean", optional: true, description: t("commands-light-show-arg-on") } },
    selection: NO_RULE,
    build(args) {
      const on = typeof args.on === "boolean" ? args.on : null;
      return {
        kind: "view",
        title: on === false ? t("commands-light-hide-edit") : t("commands-light-show"),
        run(host) {
          if (host.light === undefined) throw new CommandError(t("commands-light-no-host"));
          return { shown: host.light.show(on) };
        },
      };
    },
  },
]);
