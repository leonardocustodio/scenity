// SPDX-License-Identifier: Apache-2.0
/**
 * The solo and hide commands (`view.*`) of the scene editor: view commands, not edits. The hide is a render flag of the
 * lab per pane (editor/useHide.ts), not an input of a frame. The URL, the tune values and `frameKey` do not hold it. It
 * is never a step of the undo history.
 *
 * - `view.hide` (H): hide the selected items (or `target`) in the focused pane; `all: true` hides them in every pane.
 * - `view.solo` (Shift+H): show only the selected items (or `target`) in the focused pane, or in every pane.
 * - `view.showAll` (Alt+H): show every item again in the focused pane, or in every pane.
 */
import { parseSelection, type SelectTarget } from "@scenity/runtime-dev";
import { CommandError, NO_RULE, type Command, type CommandState, type HideHost, labCommands } from "./commandKit";
import { selectedOf } from "./groupCommands";
import { t } from "../../texts";

const ALL_ARG = {
  type: "boolean",
  default: false,
  description: t("commands-hide-arg-all"),
} as const;

const TARGET_ARG = {
  type: "string",
  optional: true,
  description: t("commands-hide-arg-target"),
} as const;

function hideHost(host: { readonly hide?: HideHost }): HideHost {
  if (host.hide === undefined) throw new CommandError(t("commands-hide-no-host"));
  return host.hide;
}

/** The items of a hide command: the `target` text, else the selected items. */
function targetsOf(args: Readonly<Record<string, unknown>>, state: CommandState): SelectTarget[] {
  const text = typeof args.target === "string" ? args.target : "";
  const items = text === "" ? selectedOf(state) : parseSelection(text);
  const shown = items.filter((item) => item.kind !== "room");
  if (shown.length === 0) {
    throw new CommandError(text === "" ? t("commands-hide-select") : t("commands-hide-no-item", { text }));
  }
  return shown;
}

export const HIDE_COMMANDS: readonly Command[] = labCommands([
  {
    id: "view.hide",
    title: t("commands-hide-hide"),
    key: "H",
    kind: "view",
    args: { target: TARGET_ARG, all: ALL_ARG },
    selection: { kinds: "any", orArg: "target" },
    build(args, state) {
      const targets = targetsOf(args, state);
      const all = args.all === true;
      return {
        kind: "view",
        title: t("commands-hide-hide-edit", { count: String(targets.length), all: all ? "yes" : "no" }),
        run: (host) => hideHost(host).hide(targets, all),
      };
    },
  },
  {
    id: "view.solo",
    title: t("commands-hide-solo"),
    key: "Shift+H",
    kind: "view",
    args: { target: TARGET_ARG, all: ALL_ARG },
    selection: { kinds: "any", orArg: "target" },
    build(args, state) {
      const targets = targetsOf(args, state);
      const all = args.all === true;
      return {
        kind: "view",
        title: t("commands-hide-solo-edit", {
          items: targets.map((item) => `${item.kind}:${item.id}`).join(", "),
          all: all ? "yes" : "no",
        }),
        run: (host) => hideHost(host).solo(targets, all),
      };
    },
  },
  {
    id: "view.showAll",
    title: t("commands-hide-show-all"),
    key: "Alt+H",
    kind: "view",
    args: { all: ALL_ARG },
    selection: NO_RULE,
    build(args) {
      const all = args.all === true;
      return {
        kind: "view",
        title: t("commands-hide-show-all-edit", { all: all ? "yes" : "no" }),
        run: (host) => hideHost(host).showAll(all),
      };
    },
  },
]);
