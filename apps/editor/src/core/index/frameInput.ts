// SPDX-License-Identifier: Apache-2.0
/**
 * The input of a frame of the lab for the frame index: the `FrameKeyInput` of `@scenity/labs-platform` from the state
 * of the lab. These parts make the input with these functions: the page (the plan of the index, the readers), the
 * bridge call `indexInput` (the host tools) and the `labs` tools (`labs sheet --index`, the stills). Thus each part
 * gives the same key for the same frame.
 *
 * - `source`: `take:<name>` (`take:idle` without a take) or `track:<name>`;
 * - `events`: every event of the live take (the events of the take, of `team=0` and of the panel), in their order;
 * - `view`: the name of a named camera, else the seven numbers of a free view;
 * - `renderer`: the options that change pixels: the debug layers, the assets (graybox or not), the reduced motion,
 *   and the scratch props of the checkout (the text of the `scratch` URL parameter). The `scratch` option is absent
 *   without scratch props, thus a frame without scratch props keeps the key that it had before this option.
 *
 * No Vue import: the tools read it.
 */
import type { CameraView } from "@scenity/runtime/framing";
import {
  DEFAULT_BACKEND,
  stableJson,
  type FrameKeyInput,
  type FrameView,
  type RendererBackend,
} from "@scenity/labs-platform/frameKey";
import { cameraView, isCameraName } from "../cameras";
import type { LabEvent } from "../sequence";

/** The sizes of the index: 160 and 640 px wide; 1280 px only on demand. The aspect is 16:10. */
export const INDEX_SIZES = [160, 640] as const;
export const INDEX_ASPECT = 16 / 10;
/** The steps of the time line: 100 ms for the strip and the hover preview, 1 s for the overview. */
export const STEP_MS = 100;
export const OVERVIEW_MS = 1000;

/** The height of an index picture of a width (16:10). */
export function indexHeight(width: number): number {
  return Math.max(1, Math.round(width / INDEX_ASPECT));
}

/** What a frame of the lab depends on, besides the time and the content hash. */
export interface LabKeyState {
  /** The take (null: no take, the idle room). */
  readonly take: string | null;
  /** The view track of a case of the engine, or null. */
  readonly track: string | null;
  readonly events: readonly LabEvent[];
  readonly tunes: Readonly<Record<string, number>>;
  readonly debug: readonly string[];
  readonly assets: boolean;
  readonly reduced: boolean;
  readonly tier: string;
  readonly backend?: RendererBackend | null;
  /** The scratch props (scratchList.ts `scratchText`); absent or "" for none. */
  readonly scratch?: string;
}

/** The source of a frame: the track, else the take. */
export function sourceOf(take: string | null, track: string | null): string {
  return track === null ? `take:${take ?? "idle"}` : `track:${track}`;
}

/** The view of a frame: a camera name, the numbers of a free view, or "overview" for the framing. */
export function frameViewOfCamera(name: string | null, view: CameraView | null): FrameView {
  if (name !== null) return name;
  if (view === null) return "overview";
  return [...view.position, ...view.target, view.fov];
}

/** The camera view of a frame view (null: the framing of the room kit), or undefined for an unknown name. */
export function cameraOfFrameView(view: FrameView): CameraView | null | undefined {
  if (view === null || view === "overview") return null;
  if (typeof view === "string") return isCameraName(view) ? cameraView(view) : undefined;
  if (!Array.isArray(view) || view.length !== 7) return undefined;
  const [x = 0, y = 0, z = 0, tx = 0, ty = 0, tz = 0, fov = 45] = view as readonly number[];
  return { position: [x, y, z], target: [tx, ty, tz], fov };
}

/** The renderer options of a key: the sorted debug layers, the assets, the reduced motion and the scratch props. */
export function rendererOptions(
  state: Pick<LabKeyState, "debug" | "assets" | "reduced" | "scratch">,
): Record<string, unknown> {
  const options = { debug: [...state.debug].sort(), assets: state.assets, reduced: state.reduced };
  return state.scratch === undefined || state.scratch === "" ? options : { ...options, scratch: state.scratch };
}

/** The input of the frame of a lab state at a time and a view. */
export function labFrameInput(state: LabKeyState, timeMs: number, view: FrameView, contentHash: string): FrameKeyInput {
  return {
    source: sourceOf(state.take, state.track),
    events: state.events,
    timeMs,
    view,
    tunes: state.tunes,
    renderer: rendererOptions(state),
    tier: state.tier,
    backend: state.backend ?? DEFAULT_BACKEND,
    contentHash,
  };
}

/** True when the page can draw a frame of the input: the same scene options (tunes, renderer, tier, backend). */
export function samePageOptions(input: FrameKeyInput, page: FrameKeyInput): boolean {
  const text = (value: unknown): string => stableJson(value);
  return (
    text(input.tunes) === text(page.tunes) &&
    text(input.renderer) === text(page.renderer) &&
    input.tier === page.tier &&
    (input.backend ?? DEFAULT_BACKEND) === (page.backend ?? DEFAULT_BACKEND) &&
    input.contentHash === page.contentHash
  );
}
