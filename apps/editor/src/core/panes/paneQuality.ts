// SPDX-License-Identifier: Apache-2.0
/**
 * The adaptive quality of the split screen. The view of the runtime (Room3DView) measures the frames and moves down
 * its ladder: first the render scale (1, 0.85, 0.7), then the tier. With two or more panes, the panes share the frame
 * budget, and each pane is small. Thus a lower render scale gives little. The split screen first decreases the tier
 * by one step, then moves down the ladder of that tier.
 *
 * The lab does not change the runtime view. It maps each step that the view asks for to the step of the ladder of the
 * pane count (`paneLevel`). It does this on the renderer that it gives the view (`adaptToPanes`). The view keeps its
 * windows, its rules against fast changes and its still poses.
 */
import type { Room3DRenderer } from "../../plugins";
import type { Tier } from "@scenity/runtime/protocol";
import { qualityLadder, TIER_ORDER, type QualityLevel } from "@scenity/runtime/adapt";

/** The quality ladder for a pane count: one pane is the ladder of the runtime; more panes drop the tier first. */
export function paneLadder(first: Tier, panes: number): QualityLevel[] {
  const base = qualityLadder(first);
  const next = TIER_ORDER[TIER_ORDER.indexOf(first) + 1];
  if (panes <= 1 || next === undefined || base[0] === undefined) return base;
  return [base[0], ...qualityLadder(next)];
}

/**
 * The level for the pane count of the level that the view asks for: the same step of the ladder of the pane count.
 * Null for a level that is not on the ladder of the view (the view sets the tier and the scale one after the other).
 */
export function paneLevel(first: Tier, asked: QualityLevel, panes: number): QualityLevel | null {
  const step = qualityLadder(first).findIndex((level) => level.tier === asked.tier && level.scale === asked.scale);
  if (step < 0) return null;
  const ladder = paneLadder(first, panes);
  return ladder[Math.min(step, ladder.length - 1)] ?? null;
}

/** The quality of a renderer with panes: the level that the view asked for and the level that the renderer has. */
export interface PaneQuality {
  /** The current level of the renderer. */
  level(): QualityLevel;
  /** Apply the level again after a change of the pane count. */
  update(): void;
}

/**
 * Put the pane ladder between the view and the renderer. Then `setTier` and `setScale` of the renderer use the level
 * of the pane count. `panes` gives the current pane count.
 */
export function adaptToPanes(renderer: Room3DRenderer, first: Tier, panes: () => number): PaneQuality {
  const setTier = renderer.setTier.bind(renderer);
  const setScale = renderer.setScale.bind(renderer);
  let asked: QualityLevel = { tier: first, scale: 1 };
  let applied: QualityLevel = asked;
  const update = (): void => {
    const level = paneLevel(first, asked, panes());
    if (level === null) return;
    if (level.tier !== applied.tier) setTier(level.tier);
    if (level.scale !== applied.scale) setScale(level.scale);
    applied = level;
  };
  renderer.setTier = (tier) => {
    asked = { ...asked, tier };
    update();
  };
  renderer.setScale = (scale) => {
    asked = { ...asked, scale };
    update();
  };
  return { level: () => applied, update };
}
