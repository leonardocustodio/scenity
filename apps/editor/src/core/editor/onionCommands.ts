// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skin command of the scene editor. `view.onion` shows or hides the onion skin (the key O). It also sets the
 * step, the number of copies on each side and the capture mode. It is a view command: the onion skin is a view of the
 * lab, not an input of a frame, and nothing goes into the history.
 */
import { CommandError, NO_RULE, numberArg, type Command, labCommands } from "./commandKit";
import { ONION_LIMITS, onionWords } from "./onion";
import { t } from "../../texts";

export const ONION_COMMANDS: readonly Command[] = labCommands([
  {
    id: "view.onion",
    title: t("commands-onion"),
    key: "O",
    kind: "view",
    args: {
      on: {
        type: "boolean",
        optional: true,
        description: t("commands-onion-arg-on"),
      },
      step: {
        type: "number",
        optional: true,
        min: ONION_LIMITS.step.min,
        max: ONION_LIMITS.step.max,
        integer: true,
        description: t("commands-onion-arg-step"),
      },
      count: {
        type: "number",
        optional: true,
        min: ONION_LIMITS.count.min,
        max: ONION_LIMITS.count.max,
        integer: true,
        description: t("commands-onion-arg-count"),
      },
      capture: {
        type: "boolean",
        optional: true,
        description: t("commands-onion-arg-capture"),
      },
    },
    selection: NO_RULE,
    build(args) {
      const on = typeof args.on === "boolean" ? args.on : undefined;
      const capture = typeof args.capture === "boolean" ? args.capture : undefined;
      const [step, count] = [numberArg(args, "step"), numberArg(args, "count")];
      const change = {
        ...(on === undefined ? {} : { on }),
        ...(step === undefined ? {} : { step }),
        ...(count === undefined ? {} : { count }),
        ...(capture === undefined ? {} : { capture }),
      };
      const title =
        on === undefined
          ? t("commands-onion-edit")
          : on
            ? t("commands-onion-edit-show")
            : t("commands-onion-edit-hide");
      return {
        kind: "view",
        title,
        run(host) {
          if (host.onion === undefined) throw new CommandError(t("commands-onion-no-host"));
          const state = host.onion.set(change);
          return { ...state, words: onionWords(state) };
        },
      };
    },
  },
]);
