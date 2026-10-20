// SPDX-License-Identifier: Apache-2.0
/**
 * The ghosts of the proposals: what the lab draws for each proposal that waits.
 *
 * - **A prop ghost**: a proposal with tune ops of a prop place (`room.props.<slot>.at.0..2`, `.yaw`; the commands
 *   `prop.move`, `prop.lift`, `prop.turn`, `prop.nudge`, `prop.reset`). The place of the ghost comes from the proposed
 *   tune values (the current tune values with the tune ops of the proposal, `applyTuneOps`). `placeOf` gives the place
 *   of the prop for these tune values. Thus the ghost is where Accept puts the prop.
 * - **A marker**: a team place event (`place`, `members.<id>.home`) gets a ring on the floor at the first slot of its
 *   target anchor. The member itself does not show as a ghost.
 * - **A timed prop ghost**: a `prop` event with a place gets a prop ghost at that place.
 * - **The card only**: the other ops (other tune paths, other events, source ops).
 *
 * A ghost reads the proposed inputs and the place code. It keeps no state between frames. It is a view of the lab, not
 * an input of a frame: it is not in the URL and not in `frameKey` (the core hides it in its pictures). No Vue import:
 * the tests read it.
 */
import type { GhostSpec } from "@scenity/runtime-dev";
import type { RoomKit } from "../../plugins";
import { placeOf, type DragMode, type PropPlace } from "../edit/placeDrag";
import { editorRoom } from "../sceneSource";
import { applyTuneOps, type Edit, type EditOp } from "./ops";
import { t } from "../../texts";

/** A drag that the owner stages as a proposal (⌘+drag): the current place of the drag. */
export interface StagedDrag {
  readonly slot: string;
  readonly mode: DragMode;
  readonly place: PropPlace;
  /** The other selected props that follow the grabbed prop, at their current places of the drag. */
  readonly others?: readonly { readonly slot: string; readonly place: PropPlace }[];
}

/** The ID of the proposal of a staged drag in the ghost list. */
export const STAGED = "staged";

/** The prop slot of a tune path of a prop place, or null. */
export function placeSlot(path: string): string | null {
  return /^room\.props\.([^.]+)\.(?:at\.[012]|yaw)$/.exec(path)?.[1] ?? null;
}

/** How the lab shows an op: a prop ghost, a marker on the floor, or only a line of the card. */
export type OpShown = "ghost" | "marker" | "card";

export function opShown(op: EditOp, kit: RoomKit = editorRoom().kit): OpShown {
  if (op.kind === "tune") return placeSlot(op.path) === null ? "card" : "ghost";
  if (op.kind === "event" && op.event.kind === "place")
    return editorRoom().anchorPoint(kit, op.event.to) === null ? "card" : "marker";
  // A timed prop place shows a prop ghost at its place.
  if (op.kind === "event" && op.event.kind === "prop") return op.event.place === null ? "card" : "ghost";
  return "card";
}

/** The text of an op for the card. */
export function opText(op: EditOp): string {
  if (op.kind === "tune") {
    return op.value === null ? t("palette-op-tune-default", { path: op.path }) : `${op.path} = ${String(op.value)}`;
  }
  if (op.kind === "source") return t("palette-op-source", { tool: op.tool });
  const { event } = op;
  const at = String(event.at);
  if (event.kind === "place") return t("palette-op-place", { member: event.member, to: event.to, at });
  if (event.kind === "prop") {
    if (event.place === null) return t("palette-op-prop-tuned", { slot: event.slot, at });
    return t("palette-op-prop", { slot: event.slot, where: event.place.at.map(String).join(", "), at });
  }
  return t("palette-op-event", { kind: event.kind, at });
}

/** The ghosts of one edit on the current tune values: a prop ghost per changed prop slot, a marker per place event. */
export function editGhosts(
  proposal: string,
  edit: Pick<Edit, "ops">,
  tunes: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
  kit: RoomKit = editorRoom().kit,
): GhostSpec[] {
  const proposed = applyTuneOps(tunes, edit.ops, defaults);
  const slots = [...new Set(edit.ops.flatMap((op) => (op.kind === "tune" ? (placeSlot(op.path) ?? []) : [])))];
  const props = slots.flatMap((slot): GhostSpec[] => {
    const place = placeOf(slot, proposed, defaults);
    if (place === null) return [];
    return [{ id: `${proposal}:${slot}`, proposal, kind: "prop", slot, at: [...place.at], yaw: place.yaw }];
  });
  const markers = edit.ops.flatMap((op): GhostSpec[] => {
    if (op.kind !== "event" || op.event.kind !== "place") return [];
    const at = editorRoom().anchorPoint(kit, op.event.to);
    if (at === null) return [];
    const id = `${proposal}:place:${op.event.member}`;
    return [{ id, proposal, kind: "marker", slot: null, at: [at[0], 0, at[1]], yaw: 0 }];
  });
  // A timed prop place: a prop ghost at the place of the event.
  const timed = edit.ops.flatMap((op): GhostSpec[] => {
    if (op.kind !== "event" || op.event.kind !== "prop" || op.event.place === null) return [];
    const { slot, place } = op.event;
    return [{ id: `${proposal}:timed:${slot}`, proposal, kind: "prop", slot, at: [...place.at], yaw: place.yaw }];
  });
  return [...props, ...markers, ...timed];
}

/** The ghosts of the proposals that wait, and of the current drag that the owner stages. */
export function proposalGhosts(
  proposals: readonly { readonly id: string; readonly edit: Pick<Edit, "ops"> }[],
  tunes: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
  staged: StagedDrag | null = null,
): GhostSpec[] {
  const specs = proposals.flatMap((proposal) => editGhosts(proposal.id, proposal.edit, tunes, defaults));
  if (staged === null) return specs;
  // A ghost for the grabbed prop and for each prop that follows it.
  const moved = [{ slot: staged.slot, place: staged.place }, ...(staged.others ?? [])];
  return [
    ...specs,
    ...moved.map(({ slot, place }): GhostSpec => ({
      id: `${STAGED}:${slot}`,
      proposal: STAGED,
      kind: "prop",
      slot,
      at: [...place.at],
      yaw: place.yaw,
    })),
  ];
}
