// SPDX-License-Identifier: Apache-2.0
/**
 * The scene edit in the lab. A click on the scene picks the item under the pointer and selects it (the outline, the
 * card, `sel=<kind>:<id>` in the URL). A press on the selected prop drags it (scenePointer.ts). The drag changes the
 * tune values of the place of the prop (placeDrag.ts), never the scene. The orbit camera gets no pointer event while a
 * prop drags. Escape clears the selection. R turns the selected prop 15° (with Shift: in the opposite direction; with
 * Alt: 1°). ⌘Z and ⇧⌘Z undo and redo the tune values (tuneHistory.ts). In the lab page, they use the history of the
 * scene editor (editor/editHistory.ts), which also holds the events of edits.
 *
 * A scratch prop drags and turns the same way. Its place is in the scratch list, not in the tune values, so the undo
 * of the tune values does not hold it. In the lab page, the keys R, Escape, ⌘Z and ⇧⌘Z run their commands of the
 * registry (editor/commands.ts). The drag continues to write the tune values directly (one step).
 *
 * ⌘+drag of a prop stages the drag as a proposal of the owner (scenePointer.ts). Its command (`prop.move`, `prop.lift`
 * or `prop.turn`) runs in the mode "propose", and `staged` holds the place of the drag for its ghost.
 *
 * A move drag snaps to the targets of the room (editor/useSnap.ts). Alt during the move disables the snap. A staged
 * move that the snap lifts or turns becomes `prop.place`.
 *
 * M starts the measure tool (editor/useMeasure.ts). Then the next two clicks pick two points, not a selection. Escape
 * stops the picks. Escape without a selection clears the measurements. The editor overlay (editor/useEditorOverlay.ts)
 * draws the snap and the measurements.
 *
 * Other parts of the editor set these hooks: `placeDrag` gets the drag of the place markers of the team, and
 * `overlayExtra` gets their shapes for the editor overlay. `overlayLayers` gets the shapes of the reach spheres and of
 * the walk paths by name. `timedPlace` gets the timed place mode: a staged drag that ends as `prop.placeAt`.
 * `propDrop` gets the drop check of a prop drag (a drop on a hand).
 *
 * `selected` is the list of the selected items, with the item of `selection` (the card) first. Shift+click adds an
 * item or removes it, and `sel=` keeps the list (`sel=prop:cart,prop:pillow`). A drag of a selected prop moves the
 * other selected props with it (scenePointer.ts). ⌘ stages that drag as `group.move`.
 */
import { tunables, type OverlaySpec, type PickCamera, type PickResult, type SelectTarget } from "@scenity/runtime-dev";
import type { InspectReport } from "../../plugins";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from "vue";
import type { StagedDrag } from "../editor/ghosts";
import { useEditorOverlay, type OverlayLayers } from "../editor/useEditorOverlay";
import { useMeasure, type MeasureTool } from "../editor/useMeasure";
import { useSnap, type Snap } from "../editor/useSnap";
import { typingInto } from "../labUi";
import type { LabCamera } from "../useLabCamera";
import type { ViewHandle } from "../useLabStats";
import { placeOf, turnPlace, withPlace, type DragMode, type PropPlace } from "./placeDrag";
import { editorPlugin } from "../plugin";
import { useSelectionState } from "./selectionState";
import {
  draggable,
  ScenePointer,
  type PlaceDrag,
  type PointerDeps,
  type StageHow,
  type TimedDragTool,
} from "./scenePointer";
import { useTuneHistory, type TuneUndo } from "./tuneHistory";

export interface SceneEdit {
  readonly selection: ShallowRef<SelectTarget | null>;
  /** All selected items, with the item of `selection` first (an empty list without a selection). */
  readonly selected: ShallowRef<readonly SelectTarget[]>;
  /** The last pick of the selection (null after a reload until the next pick of it). */
  readonly picked: ShallowRef<PickResult | null>;
  readonly dragging: ShallowRef<DragMode | null>;
  /** The place of a drag that the owner stages as a proposal (⌘+drag), or null. */
  readonly staged: ShallowRef<StagedDrag | null>;
  readonly warnings: ComputedRef<string[]>;
  readonly history: TuneUndo;
  /** The defaults of the tuned numbers (the places of the code). */
  readonly defaults: ReadonlyMap<string, number>;
  /** The snap of the drags and the boxes of the props. */
  readonly snap: Snap;
  /** The measure tool. */
  readonly measure: MeasureTool;
  /** The drag of the place markers of the team, or null (no markers). */
  readonly placeDrag: { drag: PlaceDrag | null };
  /** More shapes of the editor overlay (the place markers), or null. */
  readonly overlayExtra: ShallowRef<OverlaySpec | null>;
  /** The shapes of more parts of the editor overlay by name (the reach spheres, the walk paths). */
  readonly overlayLayers: ShallowRef<OverlayLayers>;
  /** The timed place mode of the drag (another part of the editor sets it), or null. */
  readonly timedPlace: { tool: TimedDragTool | null };
  /** The drop check of a prop drag (another part of the editor sets it), or null. */
  readonly propDrop: { check: ((slot: string, x: number, y: number, camera: PickCamera) => void) | null };
  select(target: SelectTarget | null, picked?: PickResult | null): void;
  /** Select a list of items (the first is the item of the card). An empty list clears the selection. */
  selectAll(targets: readonly SelectTarget[]): void;
  /** Pick at a point of the canvas (CSS pixels) in a pane. Returns null without a pick. */
  pick(x: number, y: number, pane?: number): Promise<PickResult | null>;
  /**
   * Pick at a point of the canvas and select the item there (the floor, the walls or nothing: no selection). `add`
   * (Shift+click) adds the item to the selection or removes it, and a miss keeps the selection.
   */
  pickAndSelect(x: number, y: number, add?: boolean): Promise<PickResult | null>;
  /** Turn the selected prop by degrees. */
  turn(degrees: number): void;
  readonly onDown: (event: PointerEvent) => void;
  readonly onMove: (event: PointerEvent) => void;
  readonly onUp: (event: PointerEvent) => void;
}

export interface SceneEditParts {
  readonly view: ShallowRef<ViewHandle | null>;
  readonly tunes: Ref<Record<string, number>>;
  readonly scene: Ref<HTMLElement | null>;
  readonly camera: LabCamera;
  readonly params: URLSearchParams;
  /** The places of the scratch props (scratch/useScratch.ts). */
  readonly scratch?: {
    placeOf(id: string): PropPlace | null;
    move(id: string, place: PropPlace): void;
  };
  /**
   * The undo and redo of the page (the history of the editor, which also holds the events of edits). Without it, the
   * page uses only the history of the tune values.
   */
  readonly history?: TuneUndo;
  /**
   * Run a command of the registry (editor/commands.ts). The keys R, Escape, ⌘Z and ⇧⌘Z go through it. Without it, the
   * keys call the scene edit directly.
   */
  readonly run?: KeyRun;
}

/**
 * A command run of a key: the ID of the command and its arguments. `propose` stages the edit as a proposal of the
 * owner (a ⌘+drag).
 */
export type KeyRun = (command: string, args?: Readonly<Record<string, number | string>>, propose?: boolean) => void;

const DEG = Math.PI / 180;

/** The command of a staged drag from its start place, or null when the place did not change. */
export function stagedCommand(
  drag: StagedDrag,
  start: PropPlace,
): { readonly command: string; readonly args: Readonly<Record<string, number | string>> } | null {
  const { slot, place } = drag;
  if (drag.mode === "turn") {
    if (place.yaw === start.yaw) return null;
    return { command: "prop.turn", args: { prop: slot, degrees: (place.yaw - start.yaw) / DEG } };
  }
  if (drag.mode === "lift") {
    return place.at[1] === start.at[1] ? null : { command: "prop.lift", args: { prop: slot, y: place.at[1] } };
  }
  // A snap can lift or turn a moved prop. Then the command sets the full place.
  if (place.at[1] !== start.at[1] || place.yaw !== start.yaw) {
    return {
      command: "prop.place",
      args: { prop: slot, x: place.at[0], y: place.at[1], z: place.at[2], yaw: place.yaw },
    };
  }
  if (place.at[0] === start.at[0] && place.at[2] === start.at[2]) return null;
  return { command: "prop.move", args: { prop: slot, x: place.at[0], z: place.at[2] } };
}

/** The point of a pointer event on the canvas of the scene (CSS pixels). */
function canvasPoint(scene: HTMLElement | null, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const canvas = scene?.querySelector('[data-testid="room-3d-canvas"]');
  const box = (canvas ?? scene)?.getBoundingClientRect();
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
}

/** The tune values with a prop slot turned by degrees (unchanged for a slot without a tuned place). */
function turned(
  tunes: Readonly<Record<string, number>>,
  slot: string,
  degrees: number,
  defaults: ReadonlyMap<string, number>,
): Record<string, number> {
  const place = placeOf(slot, tunes, defaults);
  return place === null ? { ...tunes } : withPlace(tunes, slot, turnPlace(place, degrees), defaults);
}

/** Listen to the keys of the page while the component lives. */
function useKeys(onKey: (event: KeyboardEvent) => void): void {
  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });
}

/** The key run without the registry: the commands of the keys call the scene edit directly. */
function directRun(edit: SceneEdit): KeyRun {
  return (command, args, propose) => {
    // Without the registry, there are no proposals. Thus a staged drag gives no edit.
    if (propose === true) return;
    if (command === "history.undo") edit.history.undo();
    else if (command === "history.redo") edit.history.redo();
    else if (command === "selection.clear") edit.select(null);
    else if (command === "prop.turn" || command === "scratch.turn")
      edit.turn(typeof args?.degrees === "number" ? args.degrees : 15);
    else if (command === "measure.start") edit.measure.start();
    else if (command === "measure.clear") edit.measure.clear();
  };
}

/** The keys of the scene edit: undo and redo, Escape, R, M. Each key runs its command of the registry. */
function editKey(event: KeyboardEvent, edit: SceneEdit, dragging: () => boolean, run: KeyRun): void {
  if (typingInto(event.target)) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.code === "KeyZ") {
    event.preventDefault();
    run(event.shiftKey ? "history.redo" : "history.undo");
  } else if (command && event.code === "KeyY") {
    event.preventDefault();
    run("history.redo");
  } else if (event.code === "Escape" && !dragging() && edit.measure.active.value) {
    // First, Escape stops the picks of a measurement.
    edit.measure.cancel();
  } else if (event.code === "Escape" && edit.selection.value !== null && !dragging()) {
    run("selection.clear");
  } else if (event.code === "Escape" && !dragging() && edit.measure.measurements.value.length > 0) {
    run("measure.clear");
  } else if (event.code === "KeyM" && !command && !event.altKey && !event.shiftKey) {
    // M starts a measurement. A second M stops its picks.
    if (edit.measure.active.value) edit.measure.cancel();
    else run("measure.start");
  } else if (event.code === "KeyR" && !command && draggable(edit.selection.value?.kind)) {
    event.preventDefault();
    const degrees = (event.altKey ? 1 : 15) * (event.shiftKey ? -1 : 1);
    run(edit.selection.value?.kind === "scratch" ? "scratch.turn" : "prop.turn", { degrees });
  }
}

/** The warnings of the place of the selected prop after a drag. */
function dragWarnings(
  target: SelectTarget | null,
  last: PickResult | null,
  tunes: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
): string[] {
  if (target?.kind !== "prop" || last?.kind !== "prop" || last.id !== target.id) return [];
  const place = placeOf(target.id, tunes, defaults);
  return place === null ? [] : editorPlugin().placement.warnings(last.local, place, placeOf(target.id, {}, defaults));
}

/** The stage of a ⌘+drag as a proposal (scenePointer.ts). It needs the registry (its proposals). */
function stageOf(staged: ShallowRef<StagedDrag | null>, run: KeyRun | undefined): Pick<PointerDeps, "stage"> {
  if (run === undefined) return {};
  const end = (drag: StagedDrag, start: PropPlace, how?: StageHow): void => {
    // A staged drag of a selection of props is one `group.move` of all of them.
    if (how?.timed !== true && drag.others !== undefined && drag.others.length > 0) {
      const props = [drag.slot, ...drag.others.map((other) => other.slot)].join(",");
      const [dx, dy, dz] = [0, 1, 2].map((axis) => (drag.place.at[axis] ?? 0) - (start.at[axis] ?? 0));
      const degrees = (drag.place.yaw - start.yaw) / DEG;
      if (dx !== 0 || dy !== 0 || dz !== 0 || degrees !== 0) {
        run("group.move", { props, about: drag.slot, dx: dx ?? 0, dy: dy ?? 0, dz: dz ?? 0, degrees }, true);
      }
      return;
    }
    // A timed drag places the prop from the clock time (a take event). ⌘ makes it a proposal.
    if (how?.timed === true) {
      const { at, yaw } = drag.place;
      const same = at.every((value, axis) => value === start.at[axis]) && yaw === start.yaw;
      if (!same) run("prop.placeAt", { prop: drag.slot, x: at[0], y: at[1], z: at[2], yaw }, how.propose);
      return;
    }
    const staging = stagedCommand(drag, start);
    if (staging !== null) run(staging.command, staging.args, true);
  };
  return { stage: { staged, end } };
}

/** The snap, the measure tool and the editor overlay of the scene edit, and their pointer parts. */
function editTools(
  parts: SceneEditParts,
  pick: SceneEdit["pick"],
  selection: ShallowRef<SelectTarget | null>,
  defaults: ReadonlyMap<string, number>,
): {
  readonly state: Pick<
    SceneEdit,
    "snap" | "measure" | "placeDrag" | "overlayExtra" | "overlayLayers" | "timedPlace" | "propDrop"
  >;
  pointer(
    select: (x: number, y: number, add?: boolean) => unknown,
  ): Pick<PointerDeps, "snap" | "picking" | "click" | "places" | "timed" | "drop">;
} {
  const { view, tunes } = parts;
  const snap = useSnap({ view, tunes, defaults });
  const inspect = async (): Promise<InspectReport | null> => (await view.value?.inspect()) ?? null;
  const measure = useMeasure({ pick: (x, y) => pick(x, y), inspect, tunes, defaults });
  const overlayExtra = shallowRef<OverlaySpec | null>(null);
  const overlayLayers = shallowRef<OverlayLayers>({});
  const placeDrag: { drag: PlaceDrag | null } = { drag: null };
  const timedPlace: { tool: TimedDragTool | null } = { tool: null };
  const propDrop: SceneEdit["propDrop"] = { check: null };
  useEditorOverlay({ view, snapped: snap.snapped, measure, extra: overlayExtra, layers: overlayLayers });
  // A new selection asks for the boxes of the props again (a model can replace its graybox part after a load).
  watch(selection, () => void snap.refresh());
  return {
    state: { snap, measure, placeDrag, overlayExtra, overlayLayers, timedPlace, propDrop },
    // While the measure tool waits, a click picks its point. Else the click selects.
    pointer: (select) => ({
      snap,
      // The holder of the place drag. Another part of the editor sets it after the start.
      places: placeDrag,
      // The holders of the timed drag and of the drop check. Other parts of the editor set them.
      timed: timedPlace,
      drop: (slot, x, y, camera) => {
        propDrop.check?.(slot, x, y, camera);
      },
      picking: () => measure.active.value,
      click: (x, y, add) => {
        if (measure.active.value) void measure.clickAt(x, y);
        else select(x, y, add);
      },
    }),
  };
}

export function useSceneEdit(parts: SceneEditParts): SceneEdit {
  const { view, tunes, scene } = parts;
  const defaults = new Map(tunables().map((item) => [item.path, item.default]));
  const dragging = shallowRef<DragMode | null>(null);
  const staged = shallowRef<StagedDrag | null>(null);
  const history = parts.history ?? useTuneHistory(tunes);

  const pick = async (x: number, y: number, pane = 0): Promise<PickResult | null> =>
    (await view.value?.pick?.(x, y, pane)) ?? null;
  // The list of the selected items (the URL `sel=`), the select functions and the click (selectionState.ts).
  const { selection, selected, picked, select, selectAll, pickAndSelect } = useSelectionState(parts.params, pick);
  const warnings = computed(() => dragWarnings(selection.value, picked.value, tunes.value, defaults));
  const tools = editTools(parts, pick, selection, defaults);

  const pointer = new ScenePointer({
    camera: parts.camera,
    selection,
    selected,
    picked,
    dragging,
    tunes,
    defaults,
    history,
    local: (event) => canvasPoint(scene.value, event),
    get pick() {
      return view.value?.pick === undefined ? undefined : pick;
    },
    // tools.pointer gives the click (the measure tool, else pickAndSelect).
    capture: (id) => {
      scene.value?.setPointerCapture(id);
    },
    ...(parts.scratch === undefined ? {} : { scratch: parts.scratch }),
    ...stageOf(staged, parts.run),
    ...tools.pointer(pickAndSelect),
  });

  const edit: SceneEdit = {
    selection,
    selected,
    picked,
    dragging,
    staged,
    warnings,
    history,
    defaults,
    ...tools.state,
    select,
    selectAll,
    pick,
    pickAndSelect,
    turn: (degrees) => {
      const target = selection.value;
      if (target?.kind === "prop") tunes.value = turned(tunes.value, target.id, degrees, defaults);
      const place = target?.kind === "scratch" ? (parts.scratch?.placeOf(target.id) ?? null) : null;
      if (target?.kind === "scratch" && place !== null) parts.scratch?.move(target.id, turnPlace(place, degrees));
    },
    onDown: pointer.onDown,
    onMove: pointer.onMove,
    onUp: pointer.onUp,
  };
  const run = parts.run ?? directRun(edit);
  useKeys((event) => {
    editKey(event, edit, () => pointer.dragging, run);
  });
  return edit;
}
