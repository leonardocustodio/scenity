// SPDX-License-Identifier: Apache-2.0
/**
 * The scratch props of the lab page.
 *
 * - **The list** is a lab input: the URL keeps it (`scratch=…`, scratchList.ts), and the key of a frame holds it. A
 *   reload or a link shows the same scratch props.
 * - **The models** come from the workbench host: the `preview.glb` of an import (scratchModels.ts). The workbench page
 *   gives the model of a new import with the bridge call `scratchAdd` (the end of an import by drop). A page that
 *   opens with scratch props asks for their models with the bridge event `scratch`. The workbench page answers with
 *   `scratchModel`. When a model of the list is missing, the scene element has `data-scratch="loading"`. Then
 *   `frame()`, the strip and the frame index wait (the frame of a scratch prop must show it).
 * - **Edits**: a drag or a turn of the selected scratch prop changes its place in the list (not a tune value). A
 *   duplicate adds a copy beside it, and a delete removes it. "Promote to the room" (the bridge event `promote`) asks
 *   the host for the changes (a dry run) or the promote (a project asset and an entity of the scene document).
 *
 * `globalThis.__labScratch` (a lab marker, tools/lab-markers.ts) gives the tools and the bridge the same functions.
 */
import type { PickResult, ScratchUpdate } from "@scenity/runtime-dev";
import type { Vec3 } from "@scenity/character";
import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import type { PropPlace } from "../edit/placeDrag";
import { DEFAULT_POINT } from "../importDrop/previewStore";
import { promoteAnswer, readInfo, type PromoteView, type ScratchInfo } from "./scratchInfo";
import {
  indexOf,
  modelsOf,
  parseScratch,
  placeOfEntry,
  SCRATCH_PARAM,
  scratchId,
  scratchPlaces,
  scratchText,
  withAdded,
  withDuplicate,
  withPlace,
  without,
  type ScratchEntry,
} from "./scratchList";
import { ScratchModels } from "./scratchModels";

/** What the scratch props use of the room view (LabsRoomView). */
export interface ScratchView {
  scratch?(update: ScratchUpdate): void;
  pick?(x: number, y: number, pane?: number): Promise<PickResult | null>;
}

/** A scratch prop for the card and the tools. */
export interface ScratchItem extends ScratchEntry {
  readonly id: string;
  readonly info: ScratchInfo | null;
  /** The model is in the scene (false while it loads or after a failure). */
  readonly loaded: boolean;
  readonly error: string | null;
}

/** The scratch functions of the page (`globalThis.__labScratch`). */
export interface LabScratchApi {
  list(): ScratchItem[];
  /** A new import: its model at a point (the drop point) as a new scratch prop. Returns its ID. */
  add(bytes: ArrayBuffer, info: unknown): Promise<string>;
  /** The model of an import that the page asked for, or (bytes null) the reason of a failure. */
  model(bytes: ArrayBuffer | null, info: unknown): Promise<void>;
  place(id: string, at: Vec3, turnDeg: number): void;
  duplicate(id: string): string | null;
  remove(id: string): void;
  /** True when every model of the list is in the scene, or failed. */
  ready(): boolean;
  promote(id: string, dry: boolean): boolean;
  promoteResult(value: unknown): void;
}

declare global {
  // The scratch props of the lab page: the tools and the workbench bridge call them.
  var __labScratch: LabScratchApi | undefined;
}

export interface Scratch {
  readonly list: ShallowRef<ScratchEntry[]>;
  /** The URL text of the list ("" for none): an input of the frame key (frameInput.ts `rendererOptions`). */
  readonly text: ComputedRef<string>;
  readonly items: ComputedRef<ScratchItem[]>;
  /** A model of the list is missing: the frames wait (`data-scratch="loading"`). */
  readonly loading: ComputedRef<boolean>;
  readonly promotion: ShallowRef<PromoteView | null>;
  readonly api: LabScratchApi;
  /** The place of a scratch prop for a drag, or null. */
  placeOf(id: string): PropPlace | null;
  move(id: string, place: PropPlace): void;
}

export interface ScratchParts {
  readonly view: () => ScratchView | null;
  readonly params: URLSearchParams;
  /** A new scratch prop of an import: the page selects it. */
  readonly added?: (id: string) => void;
}

/** Keep the list in the URL. */
function keepUrl(text: string): void {
  const url = new URL(globalThis.location.href);
  if (text === "") url.searchParams.delete(SCRATCH_PARAM);
  else url.searchParams.set(SCRATCH_PARAM, text);
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

/** Remove the quick preview of a drop (the scratch prop takes its place). */
function dropPreviewOf(drop: unknown): void {
  const previews = globalThis.__labImport;
  if (typeof drop !== "string" || previews === undefined) return;
  for (const item of previews.list()) if (item.drop === drop) previews.clear(item.id);
}

/** The point of a value of `scratchAdd`, else the default point (previewStore.ts). */
function pointOf(value: unknown): Vec3 {
  const point = (value as { point?: unknown } | null)?.point;
  return Array.isArray(point) && point.length === 3 ? (point as unknown as Vec3) : DEFAULT_POINT;
}

/** The functions of `globalThis.__labScratch` on the state of the page. */
function scratchApi(
  scratch: Omit<Scratch, "api">,
  models: ScratchModels,
  added: ((id: string) => void) | undefined,
): LabScratchApi {
  const { list, promotion } = scratch;
  return {
    list: () => scratch.items.value,
    async add(bytes, value) {
      const info = readInfo(value);
      if (info === null) throw new Error("scratchAdd needs the facts of an import record.");
      await models.add(info.import, bytes, info);
      list.value = withAdded(list.value, info.import, pointOf(value));
      dropPreviewOf((value as { drop?: unknown }).drop);
      const id = scratchId(list.value.length - 1);
      added?.(id);
      return id;
    },
    model: (bytes, value) => models.receive(bytes, value),
    place: (id, at, turnDeg) => {
      scratch.move(id, { at, yaw: (turnDeg * Math.PI) / 180 });
    },
    duplicate: (id) => {
      const before = list.value.length;
      list.value = withDuplicate(list.value, id);
      return list.value.length > before ? scratchId(list.value.length - 1) : null;
    },
    remove: (id) => {
      list.value = without(list.value, id);
    },
    ready: () => !scratch.loading.value,
    promote: (id, dry) => {
      const item = list.value[indexOf(list.value, id)];
      const bridge = globalThis.__workbench;
      if (item === undefined || bridge === undefined) return false;
      promotion.value = {
        ...{ id, dry, status: "running", refused: null, changes: [] },
        ...{ asset: null, entity: null, rights: "", followUp: [] },
      };
      bridge.emit({ event: "promote", import: item.model, scratch: id, at: item.at, turnDeg: item.turnDeg, dry });
      return true;
    },
    promoteResult: (value) => {
      promotion.value = promoteAnswer(promotion.value?.id ?? "", value);
    },
  };
}

/** Give the core the places at each change, and the models when they change (a new view gets both again). */
function useApply(list: ShallowRef<ScratchEntry[]>, models: ScratchModels, view: () => ScratchView | null): void {
  let sentModels = "";
  const apply = (): void => {
    const loaded = models.all();
    const key = loaded.map((model) => model.id).join(",");
    const places = scratchPlaces(list.value);
    view()?.scratch?.(key === sentModels ? { places } : { models: loaded, places });
    sentModels = key;
  };
  watch(list, apply);
  watch(models.version, apply);
  watch(view, () => {
    sentModels = "";
    apply();
  });
}

export function useScratch(parts: ScratchParts): Scratch {
  // A shallow ref: the entries stay plain objects, so the worker message can carry their places (no Vue proxy).
  const list = shallowRef<ScratchEntry[]>(parseScratch(parts.params.get(SCRATCH_PARAM)));
  const models = new ScratchModels();
  const text = computed(() => scratchText(list.value));
  const loading = computed(() => {
    // The models are not reactive: their version is.
    if (models.version.value < 0) return true;
    return models.waiting(modelsOf(list.value));
  });
  const items = computed(() =>
    list.value.map((item, index) => ({
      ...item,
      id: scratchId(index),
      info: models.infos.value.get(item.model) ?? null,
      loaded: models.version.value >= 0 && models.has(item.model),
      error: models.failures.value.get(item.model) ?? null,
    })),
  );
  watch(
    text,
    (next) => {
      keepUrl(next);
      models.ask(modelsOf(list.value));
    },
    { immediate: true },
  );
  useApply(list, models, parts.view);
  const state: Omit<Scratch, "api"> = {
    list,
    text,
    items,
    loading,
    promotion: shallowRef<PromoteView | null>(null),
    placeOf: (id) => {
      const item = list.value[indexOf(list.value, id)];
      return item === undefined ? null : placeOfEntry(item);
    },
    move: (id, place) => {
      list.value = withPlace(list.value, id, place);
    },
  };
  const api = scratchApi(state, models, parts.added);
  globalThis.__labScratch = api;
  return { ...state, api };
}
