// SPDX-License-Identifier: Apache-2.0
/**
 * The boxes of the props that the snap of the scene editor reads: the box of each prop in the frame of its place, from
 * the labs core (`propBoxes`). The page keeps the last answer here, as the tune API keeps the defaults of the tuned
 * numbers (`tunables()`). useSnap.ts asks again after the first frame, at each selection and at each drag. The command
 * `prop.snap` and the drag read the same boxes. A box is model data. It does not change with the tune values, so the
 * snap stays a pure function of the place values and the boxes.
 */
import type { PropBox } from "@scenity/runtime-dev";

let kept: ReadonlyMap<string, PropBox> = new Map();
/** The functions that a change of the boxes calls (for example, the layout checks compute again). */
const listeners = new Set<() => void>();

/** Call a function at each change of the kept boxes. The result is a function that removes the listener. */
export function onBoxes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Keep the boxes of the props (an answer of the core). A prop that the answer does not name keeps its box. */
export function keepBoxes(boxes: Readonly<Record<string, PropBox>>): void {
  const entries = Object.entries(boxes).map(([slot, box]): [string, PropBox] => [slot, structuredClone(box)]);
  kept = new Map([...kept, ...entries]);
  changed();
}

/** The current boxes of the props of the page. */
export function keptBoxes(): ReadonlyMap<string, PropBox> {
  return kept;
}

/** Forget the boxes (the tests). */
export function forgetBoxes(): void {
  kept = new Map();
  changed();
}
