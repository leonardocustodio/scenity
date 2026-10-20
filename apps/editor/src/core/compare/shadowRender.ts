// SPDX-License-Identifier: Apache-2.0
/**
 * The frames of the compare view that the index does not have. The hidden lab frame (views/shadowLab.ts) loads the
 * take, sets the camera, and seeks. Then it draws the frame of that time, captures it at the size of the index and
 * measures its metrics. Only one draw occurs at a time, because the frame has one clock.
 */
import type { IndexMime } from "@scenity/labs-platform/indexStore";
import type { MetricValue } from "../../plugins";
import { flattenMetrics } from "../graph/series";
import type { ShadowLab } from "../views/shadowLab";
import type { RenderedFrame } from "./compareFrames";
import { COMPARE_HEIGHT, COMPARE_WIDTH } from "./frameInput";

interface Capture {
  readonly simMs: number | null;
  readonly mime: string;
  readonly bytes: ArrayBuffer;
}

function mimeOf(mime: string): IndexMime {
  return mime === "image/jpeg" || mime === "image/png" ? mime : "image/webp";
}

/** The draw function of CompareFrames on a hidden lab frame. */
export function shadowRenderer(shadow: ShadowLab) {
  let loaded: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  async function draw(take: string, timeMs: number, camera: string): Promise<RenderedFrame> {
    if (loaded !== take) {
      await shadow.call("pause");
      await shadow.call("load", take);
      loaded = take;
    }
    await shadow.call("camera", camera);
    await shadow.call("seek", timeMs);
    await shadow.call("frame");
    const shot = await shadow.call<Capture>("capture", COMPARE_WIDTH, null, COMPARE_HEIGHT);
    const values = await shadow.call<MetricValue[]>("measure");
    return {
      bytes: new Uint8Array(shot.bytes),
      mime: mimeOf(shot.mime),
      simMs: shot.simMs,
      metrics: flattenMetrics(values),
    };
  }
  return (take: string, timeMs: number, camera: string): Promise<RenderedFrame> => {
    const next = chain.then(
      () => draw(take, timeMs, camera),
      () => draw(take, timeMs, camera),
    );
    chain = next.catch(() => undefined);
    return next;
  };
}
