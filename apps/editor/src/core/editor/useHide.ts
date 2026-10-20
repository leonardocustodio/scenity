// SPDX-License-Identifier: Apache-2.0
/**
 * Solo and hide in the panes of the lab page. H hides the selected items in the focused pane. Shift+H shows only the
 * selected items, and Shift+H again on the same items shows all items. Alt+H shows all items of the focused pane
 * again, and H without a selection does the same. The commands `view.hide`, `view.solo` and `view.showAll` do the
 * same, and their argument `all` applies to all panes.
 *
 * The hide is a render flag of the lab, kept for each pane. It is not an input of a frame, not in the URL or
 * `frameKey`, and never a step of the undo history. The labs core hides the items for the render of each pane and for
 * its pick (hiding.ts of `@scenity/runtime-dev`). A capture shows all items, except when it asks for the hide
 * (`lab.capture({ hidden: true })`, `lab_frame { hidden: true }`). The pictures of the frame index never hide items.
 *
 * The script API (`globalThis.__room3dLab`) gets `hidden()`: the hide of each pane of the page and of the core.
 */
import { hidesAny, NO_HIDE, plainHide, type HideSpec, type PaneHide, type SelectTarget } from "@scenity/runtime-dev";
import { getCurrentInstance, onBeforeUnmount, onMounted, shallowRef, watch, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import type { KeyRun } from "../edit/useSceneEdit";
import { typingInto } from "../labUi";
import type { HideHost } from "./commandKit";

/** The maximum number of panes of the split screen. */
const PANES = 4;

/** The data of the split screen that the hide reads: the focused pane, the pane at full size and the pane count. */
export interface HidePanes {
  readonly focus: { readonly value: number };
  readonly full: { readonly value: number | null };
  /** The panes of the layout (1 to 4). */
  count(): number;
}

/** The parts of the room view (LabsRoomView) that the hide uses. */
export interface HideView {
  hide?(spec: HideSpec): void;
  hiddenView?(): Promise<HideSpec | null>;
}

export interface HideParts {
  /** The split screen. Without it, there is one pane. */
  readonly panes?: HidePanes;
  readonly view: () => HideView | null;
  /** The selected items (the keys hide them). */
  readonly selected: () => readonly SelectTarget[];
  readonly run: KeyRun;
  /** Add the method to the script API and listen to the keys (default: true). The tests set false. */
  readonly api?: boolean;
}

export interface HideTool {
  /** The hide of each pane of the layout (pane 0 first). */
  readonly state: ShallowRef<readonly (PaneHide | null)[]>;
  readonly host: HideHost;
  /** The spec for the panes that the renderer draws. One pane at full size gets the hide of that pane. */
  drawn(): HideSpec;
}

/** The methods of the script API. */
export interface LabHideApi {
  hidden(): Promise<{ readonly panes: readonly (PaneHide | null)[]; readonly core: HideSpec | null }>;
}

const same = (a: SelectTarget, b: SelectTarget): boolean => a.kind === b.kind && a.id === b.id;

/** A pane hide with more hidden items. */
export function withHidden(pane: PaneHide | null, items: readonly SelectTarget[]): PaneHide {
  const hidden = [...(pane?.hidden ?? [])];
  for (const item of items) if (!hidden.some((entry) => same(entry, item))) hidden.push({ ...item });
  // Remove a hidden item from the solo list.
  const solo = pane?.solo == null ? null : pane.solo.filter((entry) => !items.some((item) => same(entry, item)));
  return { hidden, solo };
}

/** A pane hide that shows only the items. Shift+H again on the same items shows all items (null). */
export function withSolo(pane: PaneHide | null, items: readonly SelectTarget[]): PaneHide | null {
  const now = pane?.solo ?? null;
  const again = now !== null && now.length === items.length && now.every((entry) => items.some((i) => same(entry, i)));
  if (again) return pane?.hidden.length === 0 ? null : { hidden: [...(pane?.hidden ?? [])], solo: null };
  return { hidden: [], solo: items.map((item) => ({ ...item })) };
}

function useHideKeys(parts: HideParts): void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyH" || event.repeat || event.metaKey || event.ctrlKey || typingInto(event.target)) return;
    event.preventDefault();
    if (event.altKey || parts.selected().length === 0) parts.run("view.showAll");
    else parts.run(event.shiftKey ? "view.solo" : "view.hide");
  };
  if (getCurrentInstance() === null) return;
  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });
}

export function useHide(parts: HideParts): HideTool {
  const state = shallowRef<readonly (PaneHide | null)[]>([]);
  const focus = (): number => parts.panes?.focus.value ?? 0;
  /** The panes of a command: the focused pane, or all panes. */
  const panesOf = (all: boolean): number[] => (all ? Array.from({ length: PANES }, (_, i) => i) : [focus()]);
  const change = (all: boolean, next: (pane: PaneHide | null) => PaneHide | null): HideSpec => {
    const panes = Array.from({ length: PANES }, (_, index) => state.value[index] ?? null);
    for (const index of panesOf(all)) {
      const value = next(panes[index] ?? null);
      panes[index] = value !== null && hidesAny(value) ? value : null;
    }
    state.value = panes.some((pane) => pane !== null) ? panes : [];
    return plainHide({ panes: state.value });
  };
  const drawn = (): HideSpec => {
    const full = parts.panes?.full.value ?? null;
    if (state.value.length === 0) return NO_HIDE;
    if (full !== null) return plainHide({ panes: [state.value[full] ?? null] });
    const count = parts.panes?.count() ?? 1;
    return plainHide({ panes: state.value.slice(0, count) });
  };
  const send = (): void => parts.view()?.hide?.(drawn());
  watch(() => JSON.stringify(drawn()), send);
  watch(parts.view, send);
  const host: HideHost = {
    hide: (targets, all) => change(all, (pane) => withHidden(pane, targets)),
    solo: (targets, all) => change(all, (pane) => withSolo(pane, targets)),
    showAll: (all) => change(all, () => null),
  };
  if (parts.api !== false) {
    const api: LabHideApi = {
      hidden: async () => ({
        panes: plainHide({ panes: state.value }).panes,
        core: (await parts.view()?.hiddenView?.()) ?? null,
      }),
    };
    installApi(api);
    useHideKeys(parts);
  }
  return { state, host, drawn };
}
