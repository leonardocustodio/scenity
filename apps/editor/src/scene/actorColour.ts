// SPDX-License-Identifier: Apache-2.0
/**
 * The colour of an actor. An agent session of the studio has a colour token (`agent-1` to `agent-6`,
 * `--sc-color-studio-agent-<n>`). Another actor can have a CSS colour. An actor with no colour gets the accent colour.
 */
import type { Actor } from "@scenity/editor-core";

/** The CSS colour of an actor. */
export function actorColour(actor: Pick<Actor, "colour">): string {
  const colour = actor.colour;
  if (colour === undefined) return "var(--sc-color-accent-brand)";
  return /^agent-\d$/.test(colour) ? `var(--sc-color-studio-${colour})` : colour;
}
