// SPDX-License-Identifier: Apache-2.0
/**
 * The card of a tutorial: what the card shows, and the actions of its buttons. The tutorial runner of the edit mode
 * (scene/tutorials/startTutorials.ts) fills it. The shell shows TutorialCard.vue.
 */
import { shallowRef } from "vue";

/** What the card shows. */
export interface TutorialShown {
  readonly tutorial: string;
  readonly title: string;
  /** The current step (from 0), or the count of steps when each step is done. */
  readonly step: number;
  readonly stepId: string;
  readonly count: number;
  readonly text: string;
}

/** The actions of the buttons of the card. */
export interface TutorialActions {
  /** Put the callout on the part of the window of the step again. */
  showMe(): void;
  /** Move to the next step with no check. */
  skip(): void;
  end(): void;
}

/** The tutorial that shows, or null. */
export const tutorialShown = shallowRef<TutorialShown | null>(null);

let actions: TutorialActions | null = null;

/** Give the card the actions of the runner. */
export function setTutorialActions(next: TutorialActions | null): void {
  actions = next;
}

/** Run an action of the card. */
export function tutorialAction(name: keyof TutorialActions): void {
  actions?.[name]();
}
