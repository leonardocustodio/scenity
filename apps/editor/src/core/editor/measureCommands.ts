// SPDX-License-Identifier: Apache-2.0
/**
 * The measure commands (`measure.*`) of the scene editor. They start the two picks of the measure tool (the key M),
 * measure between two ends, and clear the measurements. The ends are points or items. Claude uses the tool
 * `lab_measure` and `scene_command`. They are view commands: a measurement is a readout, not an input of the scene,
 * and not a step of the edit history.
 */
import {
  CommandError,
  NO_RULE,
  textArg,
  type Command,
  type CommandHost,
  type MeasureHost,
  labCommands,
} from "./commandKit";
import { endForms } from "./measure";
import { t } from "../../texts";

/** The measure tool of the host, or a command error on a page without one. */
function measureOf(host: CommandHost): MeasureHost {
  if (host.measure === undefined) throw new CommandError(t("commands-measure-no-host"));
  return host.measure;
}

// The forms of an end name the ends of the plugin. The command reads them when a command list asks for the words.
const END = (which: "first" | "second"): { readonly type: "string"; readonly description: string } => ({
  type: "string",
  get description() {
    return t("commands-measure-arg-end", { which, forms: endForms() });
  },
});

export const MEASURE_COMMANDS: readonly Command[] = labCommands([
  {
    id: "measure.start",
    title: t("commands-measure-start"),
    key: "M",
    kind: "view",
    args: {},
    selection: NO_RULE,
    build: () => ({ kind: "view", title: t("commands-measure-start-edit"), run: (host) => measureOf(host).start() }),
  },
  {
    id: "measure.between",
    title: t("commands-measure-between"),
    key: null,
    kind: "view",
    args: { from: END("first"), to: END("second") },
    selection: NO_RULE,
    build(args) {
      const [from, to] = [textArg(args, "from"), textArg(args, "to")];
      return {
        kind: "view",
        title: t("commands-measure-between-edit", { from, to }),
        run: (host) => measureOf(host).between(from, to),
      };
    },
  },
  {
    id: "measure.clear",
    title: t("commands-measure-clear"),
    key: t("commands-measure-clear-key"),
    kind: "view",
    args: {},
    selection: NO_RULE,
    build: () => ({ kind: "view", title: t("commands-measure-clear"), run: (host) => measureOf(host).clear() }),
  },
]);
