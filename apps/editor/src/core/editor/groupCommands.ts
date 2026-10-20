// SPDX-License-Identifier: Apache-2.0
/**
 * The multi-select and group commands of the scene editor:
 *
 * - `selection.add` (a view command, Shift+click): add an item to the selection, or remove it when it is there.
 * - `selection.group` (a view command, Alt+G): select the named group of the selected prop (groups.ts), or a named
 *   group.
 * - `group.move` (an edit): move props together (default: the selected props). Each prop gets the move and the turn
 *   of the `about` prop, so their places stay the same relative to each other. A drag of a selected prop gives the same
 *   tune values. ⌘ at the press of the drag stages this command as a proposal.
 * - `group.save`, `group.remove`, `group.list` (view commands): the groups of the owner in the URL (`groups=`).
 */
import { parseSelection, selectText, type SelectTarget } from "@scenity/runtime-dev";
import { placeOf } from "../edit/placeDrag";
import {
  CommandError,
  NO_RULE,
  num,
  numberArg,
  textArg,
  type Command,
  type CommandHost,
  type CommandState,
  type GroupsHost,
  labCommands,
} from "./commandKit";
import { allGroups, builtInGroups, followPlace, groupNamed, groupOf, type PropGroup } from "./groups";
import type { EditOp } from "./ops";
import { placeOps, propSlots } from "./propCommands";
import { t } from "../../texts";

const DEG = Math.PI / 180;

/** The current selected items: the list of the state, else the one selected item. */
export function selectedOf(state: Pick<CommandState, "selection" | "selected">): SelectTarget[] {
  if (state.selected !== undefined && state.selected.length > 0) return [...state.selected];
  return state.selection === null ? [] : [state.selection];
}

/** The named groups of a state: the groups of the page, else the built-in groups. */
export function groupsOf(state: Pick<CommandState, "selection" | "groups">): readonly PropGroup[] {
  return state.groups?.() ?? builtInGroups();
}

/** The selection after a toggle of an item. The item goes out when it is in the list, else it goes to the end. */
export function toggled(list: readonly SelectTarget[], item: SelectTarget): SelectTarget[] {
  const inside = list.some((entry) => entry.kind === item.kind && entry.id === item.id);
  return inside ? list.filter((entry) => entry.kind !== item.kind || entry.id !== item.id) : [...list, item];
}

/** Select a list on the host: the whole list, or its first item on a host without `selectAll`. */
function selectList(host: CommandHost, list: readonly SelectTarget[]): void {
  if (host.selectAll !== undefined) host.selectAll(list);
  else host.select(list[0] ?? null);
}

function groupsHost(host: CommandHost): GroupsHost {
  if (host.groups === undefined) throw new CommandError(t("commands-group-no-host"));
  return host.groups;
}

/** The prop slots of a command: the `props` text (a list), else the selected props. */
function propsOf(args: Readonly<Record<string, unknown>>, state: CommandState): string[] {
  const text = typeof args.props === "string" ? args.props : "";
  const named = text === "" ? [] : text.split(/[,+\s]+/).filter((slot) => slot !== "");
  const slots = named.length > 0 ? named : selectedOf(state).flatMap((item) => (item.kind === "prop" ? item.id : []));
  return [...new Set(slots)];
}

const PROPS_ARG = {
  type: "string",
  optional: true,
  description: t("commands-group-arg-props"),
} as const;

export const GROUP_COMMANDS: readonly Command[] = labCommands([
  {
    id: "selection.add",
    title: t("commands-group-add"),
    key: t("commands-group-add-key"),
    kind: "view",
    args: {
      target: {
        type: "string",
        description: t("commands-group-add-arg-target"),
      },
    },
    selection: NO_RULE,
    build(args, state) {
      const text = textArg(args, "target");
      const [item] = parseSelection(text);
      if (item === undefined || item.kind === "room") throw new CommandError(t("commands-group-not-item", { text }));
      const next = toggled(selectedOf(state), item);
      return {
        kind: "view",
        title: t("commands-group-add-edit", {
          out: next.length < selectedOf(state).length ? "yes" : "no",
          item: selectText(item),
        }),
        run(host) {
          selectList(host, next);
          return next.map(selectText);
        },
      };
    },
  },
  {
    id: "selection.group",
    title: t("commands-group-select"),
    key: "Alt+G",
    kind: "view",
    args: {
      group: {
        type: "string",
        optional: true,
        description: t("commands-group-select-arg-group"),
      },
    },
    selection: { kinds: ["prop"], orArg: "group" },
    build(args, state) {
      const groups = groupsOf(state);
      const name = textArg(args, "group");
      const prop = state.selection?.kind === "prop" ? state.selection.id : "";
      const group = name === "" ? groupOf(prop, groups) : groupNamed(name, groups);
      if (group === null) {
        const known = groups.map((item) => item.name).join(", ");
        throw new CommandError(
          name === "" ? t("commands-group-none-of", { prop, known }) : t("commands-group-unknown", { name, known }),
        );
      }
      // The selected prop stays the item of the card.
      const slots = group.props.includes(prop) ? [prop, ...group.props.filter((slot) => slot !== prop)] : group.props;
      const list = slots.map((id): SelectTarget => ({ kind: "prop", id }));
      return {
        kind: "view",
        title: t("commands-group-select-edit", { name: group.name }),
        run(host) {
          selectList(host, list);
          return { group: group.name, props: [...slots] };
        },
      };
    },
  },
  {
    id: "group.move",
    title: t("commands-group-move"),
    key: t("commands-group-move-key"),
    kind: "edit",
    args: {
      props: PROPS_ARG,
      about: {
        type: "string",
        optional: true,
        description: t("commands-group-move-arg-about"),
      },
      dx: { type: "number", default: 0, description: t("commands-group-move-arg-dx") },
      dy: { type: "number", default: 0, description: t("commands-group-move-arg-dy") },
      dz: { type: "number", default: 0, description: t("commands-group-move-arg-dz") },
      degrees: { type: "number", default: 0, description: t("commands-group-move-arg-degrees") },
    },
    selection: { kinds: ["prop"], orArg: "props" },
    build(args, state) {
      const slots = propsOf(args, state);
      const named = textArg(args, "about");
      const about = named === "" ? (slots[0] ?? "") : named;
      if (!slots.includes(about)) slots.unshift(about);
      const from = placeOf(about, state.tunes, state.defaults);
      if (from === null || slots.length === 0) {
        throw new CommandError(
          t("commands-prop-no-place", { slot: about, props: propSlots(state.defaults).join(", ") }),
        );
      }
      const [dx, dy, dz] = [numberArg(args, "dx") ?? 0, numberArg(args, "dy") ?? 0, numberArg(args, "dz") ?? 0];
      const degrees = numberArg(args, "degrees") ?? 0;
      const to = { at: [from.at[0] + dx, from.at[1] + dy, from.at[2] + dz] as const, yaw: from.yaw + degrees * DEG };
      const ops = slots.flatMap((slot): EditOp[] => {
        const place = placeOf(slot, state.tunes, state.defaults);
        if (place === null) throw new CommandError(t("commands-group-move-no-place", { slot }));
        return placeOps(slot, place, followPlace(place, from, to));
      });
      const move = { props: slots.join(", "), dx: num(dx), dy: num(dy), dz: num(dz), degrees: num(degrees) };
      const title = degrees === 0 ? t("commands-group-move-edit", move) : t("commands-group-move-edit-turn", move);
      return { kind: "edit", title, ops };
    },
  },
  {
    id: "group.save",
    title: t("commands-group-save"),
    key: null,
    kind: "view",
    args: {
      name: { type: "string", description: t("commands-group-save-arg-name") },
      props: PROPS_ARG,
    },
    selection: NO_RULE,
    build(args, state) {
      const name = textArg(args, "name");
      const props = propsOf(args, state);
      if (props.length < 2) throw new CommandError(t("commands-group-save-few"));
      return {
        kind: "view",
        title: t("commands-group-save-edit", { name }),
        run: (host) => groupsHost(host).save(name, props),
      };
    },
  },
  {
    id: "group.remove",
    title: t("commands-group-remove"),
    key: null,
    kind: "view",
    args: { name: { type: "string", description: t("commands-group-remove-arg-name") } },
    selection: NO_RULE,
    build(args) {
      const name = textArg(args, "name");
      return {
        kind: "view",
        title: t("commands-group-remove-edit", { name }),
        run: (host) => groupsHost(host).remove(name),
      };
    },
  },
  {
    id: "group.list",
    title: t("commands-group-list"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    build(_args, state) {
      const groups = allGroups(groupsOf(state));
      return { kind: "view", title: t("commands-group-list"), run: () => groups.map((group) => ({ ...group })) };
    },
  },
]);
