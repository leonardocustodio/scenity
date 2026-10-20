// SPDX-License-Identifier: Apache-2.0
/**
 * The tutorial runner of the edit mode. Help → Tutorials starts a tutorial (`tutorial.start.<id>`). The runner shows
 * the step on the card and puts a callout on its part of the window. It reads the checks a few times each second. A
 * step whose check passes is done, and the card shows the next step. The browser keeps the tutorial and its step for
 * this tab (`scenity.tutorial` in the session storage). Thus a reload of the window continues at the same step. (A
 * new sequence opens with a reload.)
 */
import type { SequenceDocument } from "@scenity/scene/sequence";
import { setTutorialActions, tutorialShown } from "../../studio/tutorials/tutorialCard";
import { messageIdOf, t } from "../../texts";
import type { ScenePageEditor } from "../sceneEditor";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";
import { uiHighlight } from "../uiCalls";
import { nextOpenStep, tutorialOf, TUTORIALS, type Tutorial, type TutorialStart, type TutorialView } from "./tutorials";

/** What the runner reads of the window. */
export interface TutorialParts {
  readonly editor: ScenePageEditor;
  selection(): readonly string[];
  /** The open sequence, or null. */
  sequence(): SequenceDocument | null;
  playing(): boolean;
}

/** The tutorial that runs: its ID, its step and the state of the window at its start. */
interface Running {
  readonly id: string;
  step: number;
  readonly start: TutorialStart;
}

export const TUTORIAL_KEY = "scenity.tutorial";
/** How often the runner reads the checks (ms). */
const CHECK_MS = 250;

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function saved(): Running | null {
  try {
    const value = JSON.parse(storage()?.getItem(TUTORIAL_KEY) ?? "null") as Running | null;
    return value !== null && tutorialOf(value.id) !== undefined ? value : null;
  } catch {
    return null;
  }
}

function keep(running: Running | null): void {
  try {
    if (running === null) storage()?.removeItem(TUTORIAL_KEY);
    else storage()?.setItem(TUTORIAL_KEY, JSON.stringify(running));
  } catch {
    // No storage: a reload ends the tutorial.
  }
}

/** The message ID of a text of a tutorial. */
const textId = (tutorial: string, part: string): string => `${messageIdOf("tutorial", tutorial)}-${part}`;

/**
 * The prompt box of the Hub opens the window with `tutorial=<id>`. The result is that tutorial, or null. The address
 * loses the parameter, so the result is the tutorial only one time.
 */
function askedTutorial(): string | null {
  const url = new URL(location.href);
  const asked = url.searchParams.get("tutorial");
  if (asked === null) return null;
  url.searchParams.delete("tutorial");
  history.replaceState(history.state, "", url);
  return tutorialOf(asked) === undefined ? null : asked;
}

/** Start the tutorials of the window. The result stops the runner. */
export function startTutorials(parts: TutorialParts): () => void {
  let running = saved();
  const view = (): TutorialView => ({
    doc: parts.editor.doc,
    selection: parts.selection(),
    dirty: parts.editor.dirty,
    sequence: parts.sequence(),
    playing: parts.playing(),
  });
  const show = (tutorial: Tutorial, highlight: boolean): void => {
    if (running === null) return;
    const step = tutorial.steps[running.step];
    const done = step === undefined;
    const text = t(done ? "tutorial-finished-text" : textId(tutorial.id, step.id));
    tutorialShown.value = {
      tutorial: tutorial.id,
      title: t(textId(tutorial.id, "title")),
      step: running.step,
      stepId: step?.id ?? "done",
      count: tutorial.steps.length,
      text,
    };
    if (highlight && step !== undefined) uiHighlight({ target: step.target, text });
  };
  const check = (): void => {
    const tutorial = running === null ? undefined : tutorialOf(running.id);
    if (running === null || tutorial === undefined) return;
    const next = nextOpenStep(tutorial, running.step, view(), running.start);
    if (next === running.step && tutorialShown.value?.tutorial === tutorial.id) return;
    running.step = next;
    keep(running);
    show(tutorial, true);
  };
  const begin = (id: string): void => {
    running = { id, step: 0, start: { entities: Object.keys(parts.editor.doc.entities).length } };
    tutorialShown.value = null;
    check();
  };
  const end = (): void => {
    running = null;
    keep(null);
    tutorialShown.value = null;
  };
  setTutorialActions({
    showMe: () => {
      const tutorial = running === null ? undefined : tutorialOf(running.id);
      if (tutorial !== undefined) show(tutorial, true);
    },
    skip: () => {
      const tutorial = running === null ? undefined : tutorialOf(running.id);
      if (running === null || tutorial === undefined) return;
      running.step = Math.min(running.step + 1, tutorial.steps.length);
      keep(running);
      show(tutorial, true);
    },
    end,
  });
  const commands: PageKeyCommandSpec[] = TUTORIALS.map((tutorial) => ({
    id: `tutorial.start.${tutorial.id}`,
    title: t(textId(tutorial.id, "title")),
    menu: "help/tutorials",
    run: () => {
      begin(tutorial.id);
    },
  }));
  const stopCommands = pageKeys().register(commands);
  const asked = askedTutorial();
  if (asked !== null) begin(asked);
  const timer = setInterval(check, CHECK_MS);
  check();
  return () => {
    clearInterval(timer);
    stopCommands();
    setTutorialActions(null);
    tutorialShown.value = null;
  };
}
