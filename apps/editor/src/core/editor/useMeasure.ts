// SPDX-License-Identifier: Apache-2.0
/**
 * The measure tool of the lab page. `M` (the command `measure.start`) starts a measurement. The next two clicks on the
 * main pane pick two points of the scene (the pick of the labs core). The page keeps the measurement between them
 * (measure.ts): the distance and its horizontal and vertical parts. The measurements stay in the frame (the editor
 * overlay, in each pane) until the owner clears them (Escape without a selection, or the command `measure.clear`).
 * `measure.between` measures between two points or items for Claude.
 *
 * A measurement is a readout of the lab, not an input. It is not in the URL or `frameKey`, and the captures hide it.
 * The context packet of the workbench gets the measurements (the script API `measurements()`).
 */
import type { Vec3 } from "@scenity/character";
import type { InspectReport } from "../../plugins";
import type { PickResult } from "@scenity/runtime-dev";
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import { CommandError, type MeasureHost } from "./commandKit";
import { measureBetween, resolveEnd, type MeasureEnd, type Measurement } from "./measure";
import { t } from "../../texts";

export interface MeasureTool extends MeasureHost {
  readonly measurements: ShallowRef<readonly Measurement[]>;
  /** The first pick of a measurement while the second waits, or null. */
  readonly waiting: ShallowRef<MeasureEnd | null>;
  /** True while the clicks on the scene pick the points of a measurement (no selection, no drag). */
  readonly active: Ref<boolean>;
  /** The words of the last step (for the card and the tools), or null. */
  readonly status: Ref<string | null>;
  start(): boolean;
  /** Stop the picks of a measurement. The measurements stay. */
  cancel(): void;
  /** A click on the scene while the tool is active: pick the point at the click. */
  clickAt(x: number, y: number): Promise<Measurement | null>;
  /** Add one end. The second end gives the measurement. */
  addEnd(end: MeasureEnd): Measurement | null;
  between(from: string, to: string): Promise<Measurement>;
  clear(): number;
}

/** The measure methods of the script API. No name is `measure`, because `measure` gives the metrics of the frame. */
export interface LabMeasureApi {
  /** The measurements of the page, oldest first. */
  measurements(): Measurement[];
  /** Measure between two ends: `x,y,z` or an item (`prop:cart`, `member:cy.wrist_r`, `point:<name>`). */
  measureBetween(from: string, to: string): Promise<Measurement>;
  /** Start the two picks (as the key M). */
  startMeasure(): boolean;
  /** Clear the measurements. Returns their number. */
  clearMeasurements(): number;
}

export interface MeasureParts {
  /** The pick of the main pane (useSceneEdit.ts `pick`). */
  readonly pick: (x: number, y: number) => Promise<PickResult | null>;
  /** The inspect report of the last frame (the members and the work points), or null. */
  readonly inspect: () => Promise<InspectReport | null>;
  readonly tunes: Ref<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

/** The name of the item of a pick: `prop:cart`, `member:cy.hand_r`, `room:<part>`. */
function pickedWhat(hit: PickResult): string {
  const bone = hit.kind === "member" && hit.bone !== null ? `.${hit.bone}` : "";
  return `${hit.kind}:${hit.id}${bone}`;
}

export function useMeasure(parts: MeasureParts): MeasureTool {
  const measurements = shallowRef<readonly Measurement[]>([]);
  const waiting = shallowRef<MeasureEnd | null>(null);
  const active = ref(false);
  const status = ref<string | null>(null);
  let count = 0;
  const add = (from: MeasureEnd, to: MeasureEnd): Measurement => {
    count += 1;
    const made = measureBetween(`m${String(count)}`, from, to);
    measurements.value = [...measurements.value, made];
    return made;
  };
  const tool: MeasureTool = {
    measurements,
    waiting,
    active,
    status,
    start: () => {
      active.value = true;
      waiting.value = null;
      status.value = t("commands-measure-status-first");
      return true;
    },
    cancel: () => {
      active.value = false;
      waiting.value = null;
      status.value = null;
    },
    addEnd: (end) => {
      const first = waiting.value;
      if (first === null) {
        waiting.value = end;
        status.value = t("commands-measure-status-second");
        return null;
      }
      waiting.value = null;
      active.value = false;
      const made = add(first, end);
      status.value = null;
      return made;
    },
    clickAt: async (x, y) => {
      const hit = await parts.pick(x, y);
      if (hit === null) {
        status.value = t("commands-measure-status-miss");
        return null;
      }
      return tool.addEnd({ at: hit.point, what: pickedWhat(hit) });
    },
    between: async (from, to) => {
      const report = await parts.inspect();
      const facts = { tunes: parts.tunes.value, defaults: parts.defaults, report };
      try {
        return add(resolveEnd(from, facts), resolveEnd(to, facts));
      } catch (error) {
        throw new CommandError(error instanceof Error ? error.message : String(error));
      }
    },
    clear: () => {
      const gone = measurements.value.length;
      measurements.value = [];
      tool.cancel();
      return gone;
    },
  };
  if (parts.api !== false) {
    const api: LabMeasureApi = {
      measurements: () => structuredClone([...measurements.value]),
      measureBetween: async (from, to) => structuredClone(await tool.between(from, to)),
      startMeasure: () => tool.start(),
      clearMeasurements: () => tool.clear(),
    };
    installApi(api);
  }
  return tool;
}

/** The point of the first pick that waits, for the overlay. */
export function waitingPoint(tool: Pick<MeasureTool, "waiting">): Vec3 | null {
  return tool.waiting.value?.at ?? null;
}
