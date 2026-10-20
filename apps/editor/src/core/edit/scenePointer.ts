// SPDX-License-Identifier: Apache-2.0
/**
 * The pointer of the scene in the lab. A click picks and selects. A press on the selected prop or scratch prop drags
 * it. All other presses go to the orbit camera. The camera gets no event while a prop drags. A prop drag writes the
 * tune values of its place. A scratch prop drag writes its place in the scratch list (scratch/useScratch.ts).
 *
 * ⌘ (Meta) at the press of a prop drag stages the drag as a proposal. Then the drag writes no tune value. The place of
 * the drag shows as a ghost, and the end of the drag makes a proposal of the owner. The keys of the mode stay the same
 * (⌘ alone moves, ⌘+Shift turns, ⌘+Alt lifts).
 *
 * With `snap`, a move drag snaps to the targets of the room (editor/useSnap.ts), and the drag writes the place after
 * the snap. Alt during the move disables the snap. Alt at the press continues to lift. While `picking` is true (the
 * measure tool waits for its picks), a press goes to the camera and a click picks a point. There is no drag.
 *
 * With `places`, while the place markers of the team show, a press on a member or on its
 * marker drags the marker on the floor. The drag snaps to the nearest anchor, and its end is the edit of the place (a
 * `place` event). A press that does not move is a click: it picks and selects.
 *
 * With `timed`, while the timed place mode is active (the key J), a prop drag starts at the
 * place of the prop at the clock time. The drag is staged, and its end runs `prop.placeAt` (a take event) in place of
 * the tune values. With `drop`, the end of a prop drag with Ctrl goes to the drop check. A drop
 * on a hand of a member becomes a prepared Claude change.
 *
 * With `selected` (the list of the selected items), a press on a selected prop drags it, and the other selected props
 * follow (editor/groups.ts `groupPlaces`). The snap and the grid apply to the grabbed prop, and the other props get its
 * move and its turn. The drag stays one step of the undo history. A press with Shift that does not move is a
 * Shift+click. It adds the item to the selection or removes it (`click` with `add`).
 *
 * The pick runs in the core of the scene and answers in a few milliseconds. While it runs, the press and its moves
 * wait. When the pick is not on the selected prop, the camera gets the press and the subsequent moves.
 */
import type { PickCamera, PickResult, SelectTarget } from "@scenity/runtime-dev";
import type { ShallowRef } from "vue";
import type { StagedDrag } from "../editor/ghosts";
import { groupPlaces } from "../editor/groups";
import type { DragSnap } from "../editor/useSnap";
import type { LabCamera } from "../useLabCamera";
import { dragPlace, placeOf, withPlace, type DragMode, type DragStart, type PropPlace } from "./placeDrag";
import type { TuneUndo } from "./tuneHistory";

/** A press that moves less than this (CSS pixels) is a click: it picks. */
export const CLICK_PX = 4;

/** The controls over the scene: a press on them is not a press on the scene. */
const CONTROLS = "button, a, input, select, textarea, label, nav, [data-scene-control]";

export interface PointerDeps {
  readonly camera: Pick<LabCamera, "onDown" | "onMove" | "onUp">;
  readonly selection: ShallowRef<SelectTarget | null>;
  readonly picked: ShallowRef<PickResult | null>;
  /** All selected items (the item of `selection` first). When absent, only `selection`. */
  readonly selected?: ShallowRef<readonly SelectTarget[]>;
  readonly dragging: ShallowRef<DragMode | null>;
  readonly tunes: { value: Record<string, number> };
  readonly defaults: ReadonlyMap<string, number>;
  readonly history: Pick<TuneUndo, "begin" | "end">;
  /** The point of a pointer event on the canvas (CSS pixels). */
  local(event: { clientX: number; clientY: number }): { x: number; y: number };
  /** The pick of the core, or undefined when the renderer has none (the runtime renderer). */
  readonly pick: ((x: number, y: number) => Promise<PickResult | null>) | undefined;
  /** A click on the scene: pick and select. `add` (Shift+click) adds the item or removes it. */
  click(x: number, y: number, add?: boolean): void;
  /** Keep the pointer with the scene (the setPointerCapture of the scene element). */
  capture(pointerId: number): void;
  /** The places of the scratch props. When absent, a scratch prop does not drag. */
  readonly scratch?: {
    placeOf(id: string): PropPlace | null;
    move(id: string, place: PropPlace): void;
  };
  /** A prop drag with ⌘ at the press: the current place and the end of the drag. When absent, no staging. */
  readonly stage?: {
    readonly staged: ShallowRef<StagedDrag | null>;
    /** `how` identifies a timed drag (a `prop.placeAt` event) or a proposal (⌘ at the press). */
    end(drag: StagedDrag, start: PropPlace, how?: StageHow): void;
  };
  /** The tool of the timed place mode (null or absent: no timed drag). */
  readonly timed?: { readonly tool: TimedDragTool | null };
  /** The end of a prop drag with Ctrl (not staged): the prop slot, the pointer and the camera of the drag. */
  readonly drop?: (slot: string, x: number, y: number, camera: PickCamera) => void;
  /** The snap of a drag. When absent, only the grid applies (placeDrag.ts). */
  readonly snap?: DragSnap;
  /** True while a click picks a point for the measure tool (no drag). */
  readonly picking?: () => boolean;
  /** The drag of a place marker of the team (null or absent: no place drag). */
  readonly places?: { readonly drag: PlaceDrag | null };
}

/** The drag of a place marker of the team. */
export interface PlaceDrag {
  /** True while the markers show: a press can grab one. */
  active(): boolean;
  /**
   * Grab the marker of a press (its pick, its canvas point, ⌘ at the press). Returns true when a drag starts. `keys`
   * are Alt and Shift at the press (a handle of a cable or a hand target lifts with Alt).
   */
  grab(hit: PickResult, x: number, y: number, propose: boolean, keys?: DragKeys): boolean;
  /** `keys` are the current Alt and Shift keys (Shift: the coarse grid of a handle). */
  move(x: number, y: number, keys?: DragKeys): void;
  /** The end of the drag. When `moved` is false, it is a click and no edit occurs. */
  end(moved: boolean): void;
}

/** The end of a staged drag: a timed place (`prop.placeAt`) or a prop command, as a proposal or applied. */
export interface StageHow {
  readonly timed: boolean;
  readonly propose: boolean;
}

/** The timed place mode of the drag. */
export interface TimedDragTool {
  /** True while the mode is active. */
  on(): boolean;
  /** The place of a prop at the current clock time: its timed place, else its tuned place. */
  placeNow(slot: string): PropPlace | null;
}

/** The keys of a press or a move of a drag. */
export interface DragKeys {
  readonly alt: boolean;
  readonly shift: boolean;
}

/** True for a kind that a drag moves: a prop (its tune values) or a scratch prop (its place in the list). */
export function draggable(kind: string | undefined): boolean {
  return kind === "prop" || kind === "scratch";
}

/** A press that waits for its pick, or a press of the camera that can be a click. */
interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** The press goes to the camera (no drag). Before the answer of the pick, its moves wait. */
  camera: boolean;
  readonly waiting: PointerEvent[];
  up: boolean;
  moved: boolean;
  /** Shift at the press (a Shift+click adds to the selection). */
  readonly shift: boolean;
}

/** The pointer handlers of the scene element. They are bound, because the template gives them as listeners. */
export class ScenePointer {
  private drag: DragStart | null = null;
  /** The kind of the dragged item: a prop or a scratch prop. */
  private dragKind: string | null = null;
  /** The drag is staged as a proposal (⌘ at the press). */
  private staging = false;
  /** The end of the staged drag (a timed drag, ⌘ at the press). */
  private how: StageHow = { timed: false, propose: true };
  private press: Press | null = null;
  /** The other selected props of a prop drag, and their places at its start. */
  private others: { readonly slot: string; readonly place: PropPlace }[] = [];
  /** The drag moved more than a click (a press with Shift that does not move is a Shift+click). */
  private dragMoved = false;
  private dragShift = false;
  /** The press of a place drag, and true when it moved more than a click. */
  private placing: { readonly x: number; readonly y: number; moved: boolean } | null = null;

  constructor(private readonly deps: PointerDeps) {}

  /** The current place drag, or undefined. */
  private get place(): PlaceDrag | undefined {
    return this.deps.places?.drag ?? undefined;
  }

  readonly onDown = (event: PointerEvent): void => {
    const { deps } = this;
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(CONTROLS) !== null)) {
      deps.camera.onDown(event);
      return;
    }
    const at = deps.local(event);
    const shift = event.shiftKey;
    const current: Press = { id: event.pointerId, ...at, camera: true, waiting: [], up: false, moved: false, shift };
    this.press = current;
    const pick = deps.pick;
    const grabs = this.selectedItems().some((item) => draggable(item.kind)) || this.place?.active() === true;
    if (!grabs || pick === undefined || deps.picking?.() === true) {
      deps.camera.onDown(event);
      return;
    }
    // A press on the selected prop drags it. The pointer stays with the scene, and the camera waits for the pick.
    current.camera = false;
    deps.capture(event.pointerId);
    void pick(current.x, current.y).then((hit) => {
      this.answered(current, hit, event);
    });
  };

  readonly onMove = (event: PointerEvent): void => {
    if (this.placing !== null) {
      const at = this.deps.local(event);
      if (Math.hypot(at.x - this.placing.x, at.y - this.placing.y) > CLICK_PX) this.placing.moved = true;
      this.place?.move(at.x, at.y, { alt: event.altKey, shift: event.shiftKey });
      return;
    }
    if (this.drag !== null) {
      this.moveDrag(event);
      return;
    }
    const current = this.press;
    if (current?.id === event.pointerId) {
      const at = this.deps.local(event);
      if (Math.hypot(at.x - current.x, at.y - current.y) > CLICK_PX) current.moved = true;
      if (!current.camera) {
        current.waiting.push(event);
        return;
      }
    }
    this.deps.camera.onMove(event);
  };

  readonly onUp = (event: PointerEvent): void => {
    if (this.placing !== null) {
      const { x, y, moved } = this.placing;
      this.placing = null;
      this.place?.end(moved);
      if (!moved) this.deps.click(x, y);
      return;
    }
    if (this.drag !== null) {
      const { place: start, slot, camera, x: startX, y: startY } = this.drag;
      this.drag = null;
      this.deps.dragging.value = null;
      const stage = this.staging ? this.deps.stage : undefined;
      // A press on a selected item that does not move is a click. With Shift, it adds or removes the item. Without
      // Shift, in a selection of many items, it selects only that item.
      const click = !this.dragMoved && (this.dragShift || this.selectedItems().length > 1);
      if (stage === undefined) {
        this.deps.snap?.end();
        this.deps.history.end();
        // A prop drop with Ctrl is a drop on a hand. Without Ctrl, a drop near a hand stays a move.
        const at = this.deps.local(event);
        if (this.dragKind === "prop" && event.ctrlKey) this.deps.drop?.(slot, at.x, at.y, camera);
        if (click) this.deps.click(startX, startY, this.dragShift);
        return;
      }
      const draft = stage.staged.value;
      this.deps.snap?.end();
      stage.staged.value = null;
      if (click) {
        this.deps.click(startX, startY, this.dragShift);
        return;
      }
      if (draft !== null) stage.end(draft, start, this.how);
      return;
    }
    const current = this.press;
    if (current?.id !== event.pointerId) {
      this.deps.camera.onUp(event);
      return;
    }
    if (!current.camera) {
      current.up = true;
      return;
    }
    this.finishPress(current, event);
  };

  /** The selected items (the list, else the one selected item). */
  private selectedItems(): readonly SelectTarget[] {
    const list = this.deps.selected?.value;
    if (list !== undefined && list.length > 0) return list;
    const one = this.deps.selection.value;
    return one === null ? [] : [one];
  }

  private startDrag(event: PointerEvent, hit: PickResult): void {
    const { deps } = this;
    // The grabbed item of the selection (a selected item that a drag moves).
    const target = this.selectedItems().find((item) => item.kind === hit.kind && item.id === hit.id) ?? null;
    // In the timed place mode, a prop drag starts at the place of the prop at the clock time.
    const timed = target?.kind === "prop" && deps.stage !== undefined ? (deps.timed?.tool ?? null) : null;
    const timedOn = timed?.on() === true;
    const place =
      target === null
        ? null
        : target.kind === "scratch"
          ? (deps.scratch?.placeOf(target.id) ?? null)
          : timedOn
            ? timed.placeNow(target.id)
            : placeOf(target.id, deps.tunes.value, deps.defaults);
    if (target === null || place === null) return;
    this.dragKind = target.kind;
    this.dragMoved = false;
    this.dragShift = event.shiftKey;
    // The other selected props follow a prop drag. This is not true for a timed drag, because its event moves a named
    // group.
    this.others =
      target.kind !== "prop" || timedOn
        ? []
        : this.selectedItems().flatMap((item) => {
            const other =
              item.kind === "prop" && item.id !== target.id ? placeOf(item.id, deps.tunes.value, deps.defaults) : null;
            return other === null ? [] : [{ slot: item.id, place: other }];
          });
    const at = deps.local(event);
    const mode: DragMode = event.altKey ? "lift" : event.shiftKey ? "turn" : "move";
    this.drag = { slot: target.id, mode, place, grab: hit.point, camera: hit.camera, x: at.x, y: at.y };
    deps.snap?.begin(this.drag, hit.local);
    deps.dragging.value = mode;
    deps.picked.value = hit;
    this.staging = (event.metaKey || timedOn) && target.kind === "prop" && deps.stage !== undefined;
    this.how = { timed: timedOn, propose: event.metaKey };
    if (this.staging && deps.stage !== undefined)
      deps.stage.staged.value = this.stagedOf(target.id, mode, place, place);
    else deps.history.begin();
  }

  /** The staged drag of the grabbed prop at a place, with the other selected props that follow it. */
  private stagedOf(slot: string, mode: DragMode, start: PropPlace, place: PropPlace): StagedDrag {
    if (this.others.length === 0) return { slot, mode, place };
    return { slot, mode, place, others: groupPlaces(this.others, start, place) };
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null) return;
    const at = this.deps.local(event);
    const keys = { shift: event.shiftKey, alt: event.altKey };
    if (Math.hypot(at.x - drag.x, at.y - drag.y) > CLICK_PX) this.dragMoved = true;
    const next = this.deps.snap?.place(drag, at.x, at.y, keys) ?? dragPlace(drag, at.x, at.y, keys);
    if (this.dragKind === "scratch") this.deps.scratch?.move(drag.slot, next);
    else if (this.staging && this.deps.stage !== undefined)
      this.deps.stage.staged.value = this.stagedOf(drag.slot, drag.mode, drag.place, next);
    else {
      // The grabbed prop and the props that follow it get one change of the tune values (one undo step).
      let tunes = withPlace(this.deps.tunes.value, drag.slot, next, this.deps.defaults);
      for (const other of groupPlaces(this.others, drag.place, next)) {
        tunes = withPlace(tunes, other.slot, other.place, this.deps.defaults);
      }
      this.deps.tunes.value = tunes;
    }
  }

  /** The end of a camera press: the camera stops its orbit, and a click picks (Shift+click adds). */
  private finishPress(current: Press, event: PointerEvent): void {
    this.press = null;
    this.deps.camera.onUp(event);
    if (!current.moved) this.deps.click(current.x, current.y, current.shift);
  }

  /** The pick of a press on the selected prop answered. Start a drag, or send the press and its moves to the camera. */
  private answered(current: Press, hit: PickResult | null, event: PointerEvent): void {
    if (this.press !== current) return;
    // A press on a selected item that a drag moves.
    const same = hit !== null && this.selectedItems().some((item) => item.kind === hit.kind && item.id === hit.id);
    if (!current.up && same && draggable(hit.kind)) {
      this.press = null;
      this.startDrag(event, hit);
      for (const moved of current.waiting) this.moveDrag(moved);
      return;
    }
    // A press on a member or on its place marker drags the marker.
    const keys = { alt: event.altKey, shift: event.shiftKey };
    if (!current.up && hit !== null && this.place?.grab(hit, current.x, current.y, event.metaKey, keys) === true) {
      this.press = null;
      this.placing = { x: current.x, y: current.y, moved: false };
      for (const moved of current.waiting) this.onMove(moved);
      return;
    }
    current.camera = true;
    this.deps.camera.onDown(event);
    for (const moved of current.waiting) this.deps.camera.onMove(moved);
    current.waiting.length = 0;
    if (current.up) this.finishPress(current, event);
  }

  /** True while a prop or a place marker drags. At that time, the keys do not clear the selection. */
  get dragging(): boolean {
    return this.drag !== null || this.placing !== null;
  }
}
