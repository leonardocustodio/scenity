// SPDX-License-Identifier: Apache-2.0
/**
 * The tutorials of the editor window: the first scene, a prefab and a sequence. A tutorial is a list of steps. Each
 * step names a part of the window for its callout (a target of `ui_highlight`: a panel, a test ID, a field or a
 * command). Each step also has a check: a query of the scene, the selection, the save state and the sequence. The
 * person does each step, and the step is done when its check passes. The texts are the Fluent messages
 * `tutorial-<tutorial>-title` and `tutorial-<tutorial>-<step>` of `src/i18n/en-US/tutorials.ftl`.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";

/** What a check reads of the window. */
export interface TutorialView {
  readonly doc: SceneDocument;
  readonly selection: readonly string[];
  readonly dirty: boolean;
  /** The open sequence, or null. */
  readonly sequence: SequenceDocument | null;
  readonly playing: boolean;
}

/** The state of the window at the start of a tutorial. */
export interface TutorialStart {
  readonly entities: number;
}

/** One step: the part of the window of its callout, and its check. */
export interface TutorialStep {
  readonly id: string;
  readonly target: string;
  done(view: TutorialView, start: TutorialStart): boolean;
}

/** One tutorial. */
export interface Tutorial {
  /** The ID of the tutorial (the command `tutorial.start.<id>`). */
  readonly id: string;
  readonly steps: readonly TutorialStep[];
}

/** The components of the entities with a name. */
function named(doc: SceneDocument, name: string): Record<string, unknown>[] {
  return Object.values(doc.entities)
    .filter((entity) => entity.name === name)
    .map((entity) => entity.components);
}

/** The height of the place of the first entity with a name, or null. */
function heightOf(doc: SceneDocument, name: string): number | null {
  const transform = named(doc, name)[0]?.transform as { position?: unknown } | undefined;
  const position = transform?.position;
  return Array.isArray(position) && typeof position[1] === "number" ? position[1] : null;
}

/** The count of the prefab instances of the scene. */
function instances(doc: SceneDocument): number {
  return Object.values(doc.entities).filter((entity) => entity.components.prefab !== undefined).length;
}

/** The most keys of one track of the sequence. */
function mostKeys(sequence: SequenceDocument | null): number {
  return Math.max(0, ...(sequence?.tracks ?? []).map((track) => track.keys.length));
}

/** The name that the first tutorial gives its entity (the texts of each locale ask for this name). */
export const LAMP = "Lamp";

const save: TutorialStep = { id: "save", target: "scene-save", done: (view) => !view.dirty };

export const TUTORIALS: readonly Tutorial[] = [
  {
    id: "firstScene",
    steps: [
      { id: "add", target: "hierarchy", done: (view, start) => Object.keys(view.doc.entities).length > start.entities },
      { id: "name", target: "hierarchy", done: (view) => named(view.doc, LAMP).length > 0 },
      { id: "light", target: "inspector-add", done: (view) => named(view.doc, LAMP).some((each) => "light" in each) },
      { id: "place", target: "transform.position", done: (view) => (heightOf(view.doc, LAMP) ?? 0) >= 1 },
      save,
    ],
  },
  {
    id: "prefab",
    steps: [
      { id: "select", target: "hierarchy", done: (view) => view.selection.length > 0 },
      { id: "make", target: "menu-entity", done: (view) => instances(view.doc) > 0 },
      { id: "copy", target: "hierarchy", done: (view) => instances(view.doc) > 1 },
      save,
    ],
  },
  {
    id: "sequence",
    steps: [
      { id: "new", target: "menu-sequence", done: (view) => view.sequence !== null },
      { id: "select", target: "hierarchy", done: (view) => view.selection.length > 0 },
      { id: "key", target: "field-transform-position-row-key", done: (view) => mostKeys(view.sequence) > 0 },
      { id: "second", target: "timeline", done: (view) => mostKeys(view.sequence) > 1 },
      { id: "play", target: "timeline", done: (view) => view.playing },
    ],
  },
];

/** The tutorial of an ID. */
export function tutorialOf(id: string): Tutorial | undefined {
  return TUTORIALS.find((tutorial) => tutorial.id === id);
}

/** The first step from `step` whose check does not pass (the count of steps when all checks pass). */
export function nextOpenStep(tutorial: Tutorial, step: number, view: TutorialView, start: TutorialStart): number {
  let at = step;
  while (at < tutorial.steps.length && tutorial.steps[at]?.done(view, start) === true) at += 1;
  return at;
}
