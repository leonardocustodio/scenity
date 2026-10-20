// SPDX-License-Identifier: Apache-2.0
/**
 * The tour of the editor window: six steps over the main panels (the Scene view, the hierarchy, the inspector, the
 * Project panel, the timeline and the search box). The first open of the editor shows it. After a skip or the last
 * step, the browser keeps `scenity.tour.done`. Help → Take the tour shows it again. A page under automation (a test)
 * does not show it automatically, so the specs and the gallery frames stay the same.
 */
import { shallowRef } from "vue";

/** One step: the panel (or the part of the window) that the step shows, and the Fluent IDs of its texts. */
export interface TourStep {
  readonly id: string;
  /** A CSS selector of the part of the window that the step marks. */
  readonly target: string;
  /** The panel that the step opens first, or null. */
  readonly panel: string | null;
  readonly title: string;
  readonly text: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "view",
    target: '[data-panel="scene.view"]',
    panel: "scene.view",
    title: "tour-view-title",
    text: "tour-view-text",
  },
  {
    id: "hierarchy",
    target: '[data-panel="hierarchy"]',
    panel: "hierarchy",
    title: "tour-hierarchy-title",
    text: "tour-hierarchy-text",
  },
  {
    id: "inspector",
    target: '[data-panel="inspector"]',
    panel: "inspector",
    title: "tour-inspector-title",
    text: "tour-inspector-text",
  },
  {
    id: "project",
    target: '[data-panel="project"]',
    panel: "project",
    title: "tour-project-title",
    text: "tour-project-text",
  },
  {
    id: "timeline",
    target: '[data-panel="timeline"]',
    panel: "timeline",
    title: "tour-timeline-title",
    text: "tour-timeline-text",
  },
  { id: "search", target: ".studio-menubar", panel: null, title: "tour-search-title", text: "tour-search-text" },
];

/** The browser storage key of a done tour. */
export const TOUR_KEY = "scenity.tour.done";

/** The index of the step that shows, or null when the tour does not show. */
export const tourStep = shallowRef<number | null>(null);

function stored(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** True when the person skipped the tour or saw its last step. */
export function tourDone(): boolean {
  try {
    return stored()?.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}

/** Start the tour at its first step. */
export function startTour(): void {
  tourStep.value = 0;
}

/** Go to the next step; after the last step the tour ends and is done. */
export function nextStep(): void {
  const now = tourStep.value;
  if (now === null) return;
  if (now + 1 < TOUR_STEPS.length) tourStep.value = now + 1;
  else endTour();
}

/** Go to the step before. */
export function backStep(): void {
  const now = tourStep.value;
  if (now !== null && now > 0) tourStep.value = now - 1;
}

/** End the tour (a skip or the last step): the browser keeps that it is done. */
export function endTour(): void {
  tourStep.value = null;
  try {
    stored()?.setItem(TOUR_KEY, "1");
  } catch {
    // No storage: the tour shows again at the next open.
  }
}

/** The first open of the editor: the tour starts when it is not done and the page is not under automation. */
export function startTourOnce(automated = typeof navigator !== "undefined" && navigator.webdriver): void {
  if (!automated && !tourDone()) startTour();
}
