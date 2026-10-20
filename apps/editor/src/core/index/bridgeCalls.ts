// SPDX-License-Identifier: Apache-2.0
/**
 * The bridge calls of the frame index. The workbench page and the host call them on a lab frame through the workbench
 * bridge (workbenchBridge.ts).
 *
 * - `indexPlan` → the plan of the open take (`IndexTakePlan[]`): the workbench page sends it to the host (`index.plan`).
 * - `indexJob` [input, size] → `{ simMs, width, height, mime, bytes, metrics, reads, ms }`: the shadow frame renders one
 *   job of the host queue without a seek. The bytes move to the workbench page, and the page sends the binary index
 *   frame.
 * - `indexInput` [target] → the `FrameKeyInput` of a frame of the page state at `t` and `camera`, or null. The host
 *   tools make the key of a call with it (`lab_frame`, `lab_sheet` on an index hit).
 * - `indexChanged` → the store of the host changed: the readers of the page read the open take again.
 */
import type { FrameView } from "@scenity/labs-platform/frameKey";
import { activeLabIndex } from "./activeIndex";

type Call = (args: readonly unknown[]) => unknown;

function need() {
  const index = activeLabIndex();
  if (index === null) throw new Error("The lab page has no frame index now.");
  return index;
}

/** The view of an `indexInput` target: a camera name, seven numbers, or the camera of the page. */
function viewArg(value: unknown): FrameView | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (Array.isArray(value) && value.length === 7 && value.every((item) => typeof item === "number")) return value;
  return undefined;
}

export const INDEX_BRIDGE_CALLS: Readonly<Record<string, Call>> = {
  indexPlan: () => need().plan(),
  indexJob: async (args) => {
    const [input, size] = args;
    if (typeof input !== "object" || input === null || typeof size !== "number") {
      throw new Error("indexJob needs a frame input and a size.");
    }
    return need().job(input as Parameters<ReturnType<typeof need>["job"]>[0], size);
  },
  indexInput: (args) => {
    const target = (args[0] ?? {}) as { t?: unknown; camera?: unknown };
    const index = need();
    const time = typeof target.t === "number" && Number.isFinite(target.t) ? target.t : 0;
    const view = viewArg(target.camera);
    return view === undefined ? index.pageInput(time) : index.pageInput(time, view);
  },
  indexChanged: () => {
    activeLabIndex()?.reader.value?.changed();
    return null;
  },
};
