// SPDX-License-Identifier: Apache-2.0
/**
 * The editor overlay of the lab page. The shapes of the snap of a drag and of the measurements (editorOverlay.ts) go
 * to the room view at each change, and a new view gets them again. The view gives them to the labs core. The core
 * draws them in each pane and hides them in its pictures (`overlay.ts` of `@scenity/runtime-dev`).
 *
 * The script API gets `editorOverlay()`: the overlay as the core draws it (the counts and the label texts).
 * `extra` adds the shapes of the place markers of the team. `layers` adds the shapes of more parts by name, for
 * example the reach spheres and the walk paths of the clearance overlay. `setOverlayLayer` sets the shapes of one part.
 */
import type { OverlaySpec, OverlayView } from "@scenity/runtime-dev";
import { computed, watch, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import type { ViewHandle } from "../useLabStats";
import { overlaySpec } from "./editorOverlay";
import type { Snapped } from "./snapPlace";
import { waitingPoint, type MeasureTool } from "./useMeasure";

/** The overlay methods of the script API. */
export interface LabOverlayApi {
  /** The editor overlay as the core draws it, or null (no overlay yet, or the runtime renderer). */
  editorOverlay(): Promise<OverlayView | null>;
}

export interface OverlayParts {
  readonly view: ShallowRef<Pick<ViewHandle, "overlay" | "overlayView"> | null>;
  readonly snapped: ShallowRef<Snapped | null>;
  readonly measure: Pick<MeasureTool, "measurements" | "waiting">;
  /** More shapes (the place markers of the team), or null. */
  readonly extra?: ShallowRef<OverlaySpec | null>;
  /** The shapes of more parts by name (the reach spheres, the walk paths). */
  readonly layers?: ShallowRef<OverlayLayers>;
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

/** The shapes of the parts of the overlay by name. */
export type OverlayLayers = Readonly<Record<string, OverlaySpec>>;

/** Set the shapes of one part of the overlay (null removes the part). The other parts stay. */
export function setOverlayLayer(layers: ShallowRef<OverlayLayers>, name: string, spec: OverlaySpec | null): void {
  const others = Object.entries(layers.value).filter(([key]) => key !== name);
  layers.value = Object.fromEntries(spec === null ? others : [...others, [name, spec]]);
}

/** The shapes of many specs together, in their sequence. */
function joined(specs: readonly OverlaySpec[]): OverlaySpec {
  return {
    lines: specs.flatMap((spec) => spec.lines),
    dots: specs.flatMap((spec) => spec.dots),
    labels: specs.flatMap((spec) => spec.labels),
  };
}

export function useEditorOverlay(parts: OverlayParts): void {
  const spec = computed((): OverlaySpec => {
    const made = overlaySpec(parts.snapped.value, parts.measure.measurements.value, waitingPoint(parts.measure));
    const extra = parts.extra?.value ?? null;
    // The parts by name, in the sequence of their names, under the snap and the measurements.
    const layers = parts.layers?.value ?? {};
    const more = Object.keys(layers)
      .sort()
      .map((name) => layers[name])
      .filter((item): item is OverlaySpec => item !== undefined);
    return joined([...(extra === null ? [] : [extra]), ...more, made]);
  });
  // A plain copy, because the worker message cannot hold the reactive values of the page.
  const send = (): void => parts.view.value?.overlay?.(structuredClone(spec.value));
  watch(() => JSON.stringify(spec.value), send);
  watch(parts.view, send);
  if (parts.api !== false) {
    const api: LabOverlayApi = { editorOverlay: async () => (await parts.view.value?.overlayView?.()) ?? null };
    installApi(api);
  }
}
