// SPDX-License-Identifier: Apache-2.0
/**
 * The ghosts of the changes that wait in the Scene view. A change set of an agent that waits can move an entity. Each
 * such entity gets a faint copy at its new place, in the colour of the session (ghostCopies.ts of the dev core). An
 * entity that a set adds or removes has only its pin (changePins.ts). A Preview of a change set draws the full
 * document after the change, so it shows no ghost. The page sends a new spec only when the ghosts change.
 */
import type { ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";
import type { GhostCopy, GhostSpec } from "@scenity/runtime-dev/document/ghostCopies";
import { actorColour } from "../actorColour";
import { proposedDoc } from "../review/reviewModel";
import type { ReviewState } from "../review/reviewState";

/** The hex colour of a CSS colour of an actor. The page gives the value of a token, and another value stays. */
export function hexColour(css: string, read: (token: string) => string = tokenValue): string {
  const token = /^var\((--[\w-]+)\)$/.exec(css)?.[1];
  const value = token === undefined ? css : read(token).trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : "#7c3aed";
}

function tokenValue(token: string): string {
  return typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(token);
}

/** The last ghosts of each document, with their change sets. A frame with the same change sets uses them again. */
const LAST = new WeakMap<SceneDocument, { sets: unknown; spec: GhostSpec }>();

/** The ghosts of the change sets that wait: one for each entity at a new place. */
export function changeGhosts(
  review: Pick<ReviewState, "sets">,
  doc: SceneDocument,
  registry: ComponentRegistry,
  colour: (css: string) => string = hexColour,
): GhostSpec {
  const last = LAST.get(doc);
  if (last?.sets === review.sets.value) return last.spec;
  const copies: GhostCopy[] = [];
  for (const set of review.sets.value) {
    const after = proposedDoc(doc, set, registry);
    if (after === null) continue;
    for (const id of Object.keys(after.entities)) {
      if (doc.entities[id] === undefined || after.entities[id] === doc.entities[id]) continue;
      const before = worldTransform(doc, id)?.matrix;
      const now = worldTransform(after, id)?.matrix;
      if (before === undefined || now === undefined || now.every((value, at) => value === before[at])) continue;
      copies.push({ entity: id, matrix: [...now], colour: colour(actorColour(set.actor)) });
    }
  }
  const spec = { copies };
  LAST.set(doc, { sets: review.sets.value, spec });
  return spec;
}

/** The sender of the ghosts of a viewport. It sends a spec when it is different from the last spec. */
export function ghostSender(send: (spec: GhostSpec | null) => void): (spec: GhostSpec) => void {
  let last = "";
  return (spec) => {
    const key = JSON.stringify(spec.copies);
    if (key === last) return;
    last = key;
    send(spec.copies.length === 0 ? null : spec);
  };
}
