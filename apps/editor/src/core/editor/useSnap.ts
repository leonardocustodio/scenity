// SPDX-License-Identifier: Apache-2.0
/**
 * The snap of a drag in the lab page. At the start of a move drag, the page makes the current snap targets of the room
 * (snapTypes.ts) and the dragged prop. Then each move of the pointer gives the place after the snap (snapPlace.ts
 * `snapDrag`). `snapped` holds the snap result for the overlay (useEditorOverlay.ts). The end of the drag clears it.
 * The drag writes the place (scenePointer.ts): the tune values of a prop, or the place of a scratch prop.
 *
 * The boxes of the props come from the labs core (`propBoxes`). The page asks after the first frame of a view, at each
 * selection and at each drag. It keeps the answer (sceneBoxes.ts) for the drag and the command `prop.snap`. The script
 * API gets `snapTargets()`: the current targets, after a new answer of the boxes.
 */
import type { PropBox } from "@scenity/runtime-dev";
import { shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import { editorRoom } from "../sceneSource";
import type { DragStart, PropPlace } from "../edit/placeDrag";
import type { ViewHandle } from "../useLabStats";
import { keepBoxes, keptBoxes } from "./sceneBoxes";
import { snapDrag, snapProp, type SnapProp, type Snapped } from "./snapPlace";
import { snapTargets, type SnapScene, type SnapTarget } from "./snapTypes";

/** The snap of the drags of the scene pointer (scenePointer.ts `PointerDeps.snap`). */
export interface DragSnap {
  /** The start of a drag: the current targets and the dragged prop with its box (from the pick, else the kept box). */
  begin(drag: DragStart, box: PropBox | null): void;
  /** The place of the drag for the current pointer and keys: with the snap of a move, else the grid. */
  place(drag: DragStart, x: number, y: number, keys: { readonly shift: boolean; readonly alt: boolean }): PropPlace;
  /** The end of a drag: no snap shows. */
  end(): void;
}

export interface Snap extends DragSnap {
  /** The snap result of the current drag (the overlay shows it), or null. */
  readonly snapped: ShallowRef<Snapped | null>;
  /** Ask the core for the boxes of the props again. */
  refresh(): Promise<void>;
  /** The current snap targets (with the boxes that the page keeps). */
  targets(): SnapTarget[];
}

/** The snap methods of the script API. */
export interface LabSnapApi {
  /** The current snap targets of the room: the ID, the kind, the words and the data of each target. */
  snapTargets(): Promise<SnapTarget[]>;
}

export interface SnapParts {
  readonly view: ShallowRef<Partial<Pick<ViewHandle, "mark" | "propBoxes">> | null>;
  readonly tunes: Ref<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

/** The number of tries for the first boxes of a view (one try each second). */
const FIRST_TRIES = 20;

export function useSnap(parts: SnapParts): Snap {
  const snapped = shallowRef<Snapped | null>(null);
  let session: { readonly targets: readonly SnapTarget[]; readonly prop: SnapProp } | null = null;
  const scene = (): SnapScene => ({
    kit: editorRoom().kit,
    tunes: parts.tunes.value,
    defaults: parts.defaults,
    boxes: keptBoxes(),
  });
  const refresh = async (): Promise<void> => {
    const boxes = await parts.view.value?.propBoxes?.();
    if (boxes !== undefined) keepBoxes(boxes);
  };
  // Ask for the boxes after the first frame of each view, when the props of the scene exist. A renderer that starts
  // gives no boxes. Thus the page asks again each second, at most FIRST_TRIES times.
  const first = (view: SnapParts["view"]["value"], tries: number): void => {
    if (view === null || tries <= 0 || parts.view.value !== view) return;
    void (view.mark?.() ?? Promise.resolve(null)).then(refresh).then(() => {
      if (keptBoxes().size === 0) setTimeout(() => first(view, tries - 1), 1000);
    });
  };
  watch(parts.view, (view) => first(view, FIRST_TRIES), { immediate: true });
  const snap: Snap = {
    snapped,
    refresh,
    targets: () => snapTargets(scene()),
    begin: (drag, box) => {
      const now = scene();
      session = { targets: snapTargets(now), prop: snapProp(now, drag.slot, box) };
      snapped.value = null;
      void refresh();
    },
    place: (drag, x, y, keys) => {
      if (session === null) return snapDrag(drag, x, y, { ...keys, alt: true }, [], snapProp(scene(), drag.slot)).place;
      const result = snapDrag(drag, x, y, keys, session.targets, session.prop);
      snapped.value = result.target === null && result.surface === null ? null : result;
      return result.place;
    },
    end: () => {
      session = null;
      snapped.value = null;
    },
  };
  if (parts.api !== false) {
    const api: LabSnapApi = {
      snapTargets: async () => {
        await refresh();
        return structuredClone(snap.targets());
      },
    };
    installApi(api);
  }
  return snap;
}
