// SPDX-License-Identifier: Apache-2.0
/**
 * The split screen of the lab page: 1 to 4 panes on one canvas, each with its camera. The main pane (pane 0) has the
 * camera of the page (useLabCamera, the `camera` and `view` URL values). The panes 1 to 3 have their own cameras.
 *
 * - Layouts: 1, 2 side by side, 2 stacked, 3 (one large and two small), 2 × 2. The keys are ⌥1 to ⌥4 (⌥2 again: the
 *   other 2-pane layout). The URL keeps them (`panes`, `cams`, paneUrl.ts). The lab page alone also keeps the last
 *   layout of its checkout in the browser storage.
 * - A press on a pane focuses it (a focus ring). The drag, the wheel and the camera keys act on the focused pane.
 * - "Swap to main" changes the camera of a pane with the camera of the main pane. A double click shows a pane at full
 *   size, and a second double click shows the layout again.
 * - The cards and the hit tests use the main pane: a press outside the main pane does not pick.
 */
import {
  LAYOUT_SHARES,
  paneAt,
  paneCount,
  parsePaneLayout,
  type PaneLayout,
  type PaneShare,
  type PaneViews,
} from "@scenity/runtime-dev";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from "vue";
import { cameraView, type CameraName } from "../cameras";
import { typingInto } from "../labUi";
import type { LabCamera, PaneCameraTarget } from "../useLabCamera";
import { camsText, checkoutKey, defaultCams, parseCams, readSaved, writeSaved, type PaneCam } from "./paneUrl";

export interface LabPanes {
  readonly layout: Ref<PaneLayout>;
  /** The cameras of the panes 1 to 3; the main pane has the camera of the page. */
  readonly others: ShallowRef<readonly PaneCam[]>;
  /** The focused pane: the camera keys and the orbit act on it. */
  readonly focus: Ref<number>;
  /** The pane at full size, or null for the layout. */
  readonly full: Ref<number | null>;
  /** The panes that hide the debug layers, by pane. */
  readonly hideDebug: Ref<readonly boolean[]>;
  /**
   * The own tune values of each pane (a layout variant), or null for the page. They are a view of the lab, not an
   * input of the page (a compare of layout variants sets them). A pane at full size shows the page.
   */
  readonly paneTunes: ShallowRef<readonly (Readonly<Record<string, number>> | null)[]>;
  /** The camera of each pane of the layout, the main pane first. */
  readonly cams: ComputedRef<readonly PaneCam[]>;
  /** The panes that the renderer draws: the layout, or one pane at full size. */
  readonly drawn: ComputedRef<PaneViews>;
  /** The pane of each drawn box and its share of the scene. */
  readonly boxes: ComputedRef<readonly { readonly pane: number; readonly share: PaneShare }[]>;
  setLayout(layout: PaneLayout): void;
  setCamera(pane: number, name: CameraName): void;
  swap(pane: number): void;
  toggleFull(pane: number): void;
  focusPane(pane: number): void;
  toggleDebug(pane: number): void;
  /** A press on the scene: focus the pane under it. True when the press is on the drawn main pane (it can pick). */
  onDown(event: PointerEvent): boolean;
  onDouble(event: MouseEvent): void;
}

/** The controls over the scene: a press on them is not a press on a pane. */
const CONTROLS = "button, a, input, select, textarea, label, nav, [data-scene-control]";
/** The keys ⌥1 to ⌥4 and their layouts. */
const LAYOUT_KEYS: Readonly<Record<string, PaneLayout>> = { Digit1: "1", Digit2: "2h", Digit3: "3", Digit4: "2x2" };

interface PaneParts {
  readonly camera: LabCamera;
  readonly scene: Ref<HTMLElement | null>;
  readonly params: URLSearchParams;
  /** A fixed frame of the visual tests: the URL only, no storage and no URL writes. */
  readonly frozen: boolean;
}

/** The state of the split screen, its derived values and its URL. */
type PaneState = Pick<
  LabPanes,
  "layout" | "others" | "focus" | "full" | "hideDebug" | "paneTunes" | "cams" | "drawn" | "boxes"
> & {
  /** The pane of each drawn box: the full-size pane, else the panes in order. */
  readonly shown: ComputedRef<readonly number[]>;
  /** Keep the split screen: the URL, and the storage of the lab page alone. */
  readonly keep: () => void;
  readonly setOther: (pane: number, cam: PaneCam) => void;
};

/** The start of the split screen: the URL, else (the lab page alone) the saved layout of the checkout. */
function startPanes(params: URLSearchParams, frozen: boolean): { layout: PaneLayout; cams: (PaneCam | null)[] } {
  const fromUrl = parsePaneLayout(params.get("panes"));
  const alone = !frozen && !params.has("workbench");
  const saved = fromUrl === null && alone ? readSaved(checkoutKey()) : null;
  return {
    layout: fromUrl ?? saved?.layout ?? "1",
    cams: parseCams(params.get("cams") ?? saved?.cams ?? null),
  };
}

/** The views of the drawn panes: one pane at full size, else the panes of the layout. */
function drawnPanes(
  layout: PaneLayout,
  cams: readonly PaneCam[],
  full: number | null,
  hidden: readonly boolean[],
  tunes: readonly (Readonly<Record<string, number>> | null)[] = [],
): PaneViews {
  const one = full === null ? undefined : cams[full];
  if (one !== undefined && full !== null) return { layout: "1", views: [one.view], hideDebug: [hidden[full] === true] };
  const views = {
    layout,
    views: cams.map((cam) => cam.view),
    hideDebug: cams.map((_, index) => hidden[index] === true),
  };
  // Add the own tune values of the panes only when a pane has them (the views of the other pages stay the same).
  const own = cams.map((_, index) => tunes[index] ?? null);
  return own.some((set) => set !== null) ? { ...views, tunes: own } : views;
}

function paneState(parts: PaneParts): PaneState {
  const { camera, params, frozen } = parts;
  const start = startPanes(params, frozen);
  const layout = ref<PaneLayout>(start.layout);
  const others = shallowRef<readonly PaneCam[]>(defaultCams().map((cam, index) => start.cams[index + 1] ?? cam));
  const main = start.cams[0];
  if (main != null && !params.has("camera") && !params.has("view")) {
    if (main.name !== null) camera.setCamera(main.name);
    else camera.setView(main.view);
  }
  const full = ref<number | null>(null);
  const hideDebug = ref<readonly boolean[]>([false, false, false, false]);
  const paneTunes = shallowRef<readonly (Readonly<Record<string, number>> | null)[]>([]);
  const cams = computed<readonly PaneCam[]>(() => {
    const first: PaneCam = { name: camera.name.value, view: camera.view.value };
    return [first, ...others.value].slice(0, paneCount(layout.value));
  });
  const drawn = computed(() => drawnPanes(layout.value, cams.value, full.value, hideDebug.value, paneTunes.value));
  const shown = computed(() =>
    drawn.value.layout === "1" && full.value !== null ? [full.value] : cams.value.map((_, index) => index),
  );
  const boxes = computed(() =>
    LAYOUT_SHARES[drawn.value.layout].map((share, index) => ({ pane: shown.value[index] ?? index, share })),
  );
  const saves = !frozen && !params.has("workbench");
  const keep = (): void => {
    if (frozen) return;
    const url = new URL(globalThis.location.href);
    const text = camsText(cams.value);
    url.searchParams.delete("panes");
    url.searchParams.delete("cams");
    if (layout.value !== "1") {
      url.searchParams.set("panes", layout.value);
      url.searchParams.set("cams", text);
    }
    globalThis.history.replaceState(globalThis.history.state, "", url);
    if (saves) writeSaved(checkoutKey(), { layout: layout.value, cams: text });
  };
  const setOther = (pane: number, cam: PaneCam): void => {
    if (pane < 1) return;
    const next = [...others.value];
    next[pane - 1] = cam;
    others.value = next;
  };
  return { layout, others, focus: ref(0), full, hideDebug, paneTunes, cams, drawn, shown, boxes, keep, setOther };
}

/** The camera of a pane of the panes 1 to 3 for the keys and the orbit (useLabCamera). */
function paneTarget(state: PaneState, scene: Ref<HTMLElement | null>, pane: number): PaneCameraTarget {
  return {
    view: () => state.others.value[pane - 1]?.view ?? null,
    set: (view, name) => {
      state.setOther(pane, { name, view });
    },
    keep: state.keep,
    box: () => {
      const rect = scene.value?.getBoundingClientRect();
      const box = state.boxes.value.find((item) => item.pane === pane);
      if (rect === undefined || box === undefined) return null;
      return { width: rect.width * box.share.width, height: rect.height * box.share.height };
    },
  };
}

/** The drawn box under a pointer event (its index in the drawn layout), or -1. */
function drawnAt(state: PaneState, scene: Ref<HTMLElement | null>, event: { clientX: number; clientY: number }) {
  const rect = scene.value?.getBoundingClientRect();
  if (rect === undefined) return -1;
  return paneAt(state.drawn.value.layout, rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top);
}

const onControl = (event: Event): boolean => event.target instanceof Element && event.target.closest(CONTROLS) !== null;

export function usePanes(parts: PaneParts): LabPanes {
  const { camera, scene } = parts;
  const state = paneState(parts);
  const { layout, others, focus, full, hideDebug, keep } = state;

  function focusPane(pane: number): void {
    focus.value = pane >= 0 && pane < state.cams.value.length ? pane : 0;
    camera.focusOn(focus.value > 0 ? paneTarget(state, scene, focus.value) : null);
  }
  function setLayout(next: PaneLayout): void {
    layout.value = next;
    full.value = null;
    focusPane(focus.value);
    keep();
  }
  function toggleFull(pane: number): void {
    full.value = full.value === null && paneCount(layout.value) > 1 ? pane : null;
    focusPane(full.value ?? pane);
  }
  function swap(pane: number): void {
    const other = others.value[pane - 1];
    if (pane < 1 || other === undefined) return;
    state.setOther(pane, { name: camera.name.value, view: camera.view.value });
    if (other.name !== null) camera.setCamera(other.name);
    else camera.setView(other.view);
    keep();
  }
  function onKey(event: KeyboardEvent): void {
    const next = LAYOUT_KEYS[event.code];
    if (next === undefined || !event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
    event.preventDefault();
    setLayout(next === "2h" && layout.value === "2h" ? "2v" : next);
  }
  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });
  if (layout.value !== "1") keep();
  // The main camera after a move or a new camera: its entry of `cams`.
  watch(
    () => camera.settled.value,
    () => {
      if (layout.value !== "1") keep();
    },
  );
  return {
    ...state,
    setLayout,
    setCamera: (pane, name) => {
      if (pane === 0) camera.setCamera(name);
      else state.setOther(pane, { name, view: cameraView(name) });
      keep();
    },
    swap,
    toggleFull,
    focusPane,
    toggleDebug: (pane) => {
      hideDebug.value = hideDebug.value.map((hidden, index) => (index === pane ? !hidden : hidden));
    },
    onDown: (event) => {
      if (onControl(event)) return true;
      const index = drawnAt(state, scene, event);
      const pane = state.shown.value[index];
      if (pane !== undefined && pane !== focus.value) focusPane(pane);
      return index <= 0;
    },
    onDouble: (event) => {
      const pane = onControl(event) ? undefined : state.shown.value[drawnAt(state, scene, event)];
      if (pane !== undefined) toggleFull(pane);
    },
  };
}
