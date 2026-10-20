// SPDX-License-Identifier: Apache-2.0
/**
 * The named groups of props of the scene editor: props that move together.
 *
 * - **The built-in groups** are the props that stand on another prop in the room kit. The plugin gives them
 *   (`EditorPlugin.placement.groups`). The snap surfaces of its snap targets give the same pairs.
 * - **The groups of the owner** are in the URL (`groups=<name>:<slot>,<slot>;…`), a view option of the lab. They are
 *   not an input of a frame and not in `frameKey`. The parser also accepts a `+` or a space between the slots.
 *
 * A group move keeps the places of the props relative to each other. Each prop gets the move and the turn of the first
 * prop (the grabbed prop of a drag), as a carried prop on its carrier (`groupPlaces`). A timed place (`prop.placeAt`)
 * of a prop of a named group writes one event for each prop of the group.
 *
 * No Vue import: the commands and the tests read it.
 */
import type { PropPlace } from "../edit/placeDrag";
import { editorPlugin } from "../plugin";
import { frameAt, inFrame } from "./snapTypes";
import { t } from "../../texts";

/** A named group: its name and its prop slots (the first is the main prop, for example the crash cart). */
export interface PropGroup {
  readonly name: string;
  readonly props: readonly string[];
  /** True for a group of the room kit; false for a group of the owner (the URL). */
  readonly builtIn: boolean;
}

/** The built-in groups (the carried props of the room kit of the plugin). */
export function builtInGroups(): readonly PropGroup[] {
  return editorPlugin().placement.groups;
}

/** The URL parameter of the groups of the owner. */
export const GROUPS_PARAM = "groups";

/** The form of a group name and of a prop slot. */
const NAME = /^[a-z][a-z0-9_-]{0,23}$/;
const SLOT = /^[a-z][a-z0-9_]{0,23}$/;

/** The groups of the owner from the URL text. The function ignores a part that is not a group. */
export function parseGroups(text: string | null): PropGroup[] {
  if (text === null || text === "") return [];
  const out: PropGroup[] = [];
  for (const part of text.split(";")) {
    const [name = "", list = ""] = part.trim().split(":");
    const props = [...new Set(list.split(/[,+\s]+/).map((slot) => slot.trim()))].filter((slot) => SLOT.test(slot));
    if (NAME.test(name) && props.length >= 2 && !out.some((group) => group.name === name)) {
      out.push({ name, props, builtIn: false });
    }
  }
  return out;
}

/** The URL text of the groups of the owner ("" for none). */
export function groupsText(groups: readonly PropGroup[]): string {
  return groups
    .filter((group) => !group.builtIn)
    .map((group) => `${group.name}:${group.props.join(",")}`)
    .join(";");
}

/** The groups of the owner with a new or changed group. A problem throws an error with its words. */
export function withGroup(groups: readonly PropGroup[], name: string, props: readonly string[]): PropGroup[] {
  if (!NAME.test(name)) throw new Error(t("commands-group-bad-name", { name }));
  if (builtInGroups().some((group) => group.name === name)) throw new Error(t("commands-group-built-in", { name }));
  const slots = [...new Set(props)];
  if (slots.length < 2 || !slots.every((slot) => SLOT.test(slot))) {
    throw new Error(t("commands-group-few-slots"));
  }
  const own = groups.filter((group) => !group.builtIn && group.name !== name);
  return [...own, { name, props: slots, builtIn: false }];
}

/** Every group: the built-in groups, then the groups of the owner. */
export function allGroups(own: readonly PropGroup[]): PropGroup[] {
  return [...builtInGroups(), ...own.filter((group) => !group.builtIn)];
}

/** The first group that holds a prop slot (a group of the owner before a built-in group), or null. */
export function groupOf(slot: string, groups: readonly PropGroup[]): PropGroup | null {
  const own = groups.filter((group) => !group.builtIn);
  const ordered = [...own, ...groups.filter((group) => group.builtIn)];
  return ordered.find((group) => group.props.includes(slot)) ?? null;
}

/** The group of a name, or null. */
export function groupNamed(name: string, groups: readonly PropGroup[]): PropGroup | null {
  return groups.find((group) => group.name === name) ?? null;
}

/** The precision of the places of a group move: 0.1 mm and 4 decimals of a turn, as `labs tune-apply` writes them. */
const GRAIN = 1e4;
const round = (value: number): number => Math.round(value * GRAIN) / GRAIN || 0;

/**
 * The place of a prop of a group when the main prop goes from `from` to `to`: the same place relative to the main prop
 * (the place in the frame of `from` taken to the frame of `to`), on the grid of 0.1 mm.
 */
export function followPlace(place: PropPlace, from: PropPlace, to: PropPlace): PropPlace {
  const local = inFrame(from, place.at);
  const at = frameAt(to, local);
  return { at: [round(at[0]), round(at[1]), round(at[2])], yaw: round(place.yaw + to.yaw - from.yaw) };
}

/** The places of the other props of a group when the main prop goes from `from` to `to`. */
export function groupPlaces(
  others: readonly { readonly slot: string; readonly place: PropPlace }[],
  from: PropPlace,
  to: PropPlace,
): { slot: string; place: PropPlace }[] {
  return others.map(({ slot, place }) => ({ slot, place: followPlace(place, from, to) }));
}
