// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index on the scene page: the bridge calls that let a frame of the scene page draw the jobs of the host
 * queue (the plans of the scenes and sequences of a project, `projectPlans` of `@scenity/labs-platform`). The workbench
 * page sends the jobs to the shadow frame of the index surface (apps/workbench `index/useShadowIndexer.ts`).
 *
 * - `indexJob` [input, size]: the frame of a job: the page checks that the job is a frame of its scene file as the disk
 *   holds it (no unsaved edit), moves the clock to the time of a sequence, and takes the camera preview of the view of
 *   the job at the size. The page refuses a job of another scene, of a free view or of an edited page (the host gives
 *   it to another frame or drops it).
 * - `indexPlan`: no plans (the host plans the project); `indexChanged` and `indexInput`: nothing to do.
 */
import { canonicalJson } from "@scenity/scene/canonical";
import { encodeBitmap } from "./scenePicture";

/** The parts of the page that the index jobs use. */
export interface IndexPagePort {
  /** A picture of a document camera (null: the camera of the page) at a width (px), or null. */
  preview(camera: string | null, width: number, at?: number | null): Promise<ImageBitmap | null>;
  /** The path of the open scene file in the project. */
  readonly scenePath: string;
  /** The text of the scene file on the disk at the load of the page. */
  readonly diskText: string;
}

/** The parts of a job input that the page reads. */
interface JobInput {
  readonly timeMs: number;
  readonly view: unknown;
  readonly scene?: { readonly documents?: Readonly<Record<string, unknown>>; readonly sequence?: unknown };
}

function jobInput(value: unknown): JobInput {
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof input.timeMs !== "number" || typeof input.scene !== "object" || input.scene === null) {
    throw new Error("indexJob: the scene page draws only the frames of a scene project.");
  }
  return input as unknown as JobInput;
}

/** True when the job is a frame of the scene file of the page as the disk holds it, with no unsaved edit. */
function sameScene(port: IndexPagePort, input: JobInput): boolean {
  const doc = input.scene?.documents?.[port.scenePath];
  if (doc === undefined || globalThis.__scenity?.file().dirty === true) return false;
  try {
    return canonicalJson(doc) === canonicalJson(JSON.parse(port.diskText));
  } catch {
    return false;
  }
}

/** Draw one job: its time and its view at the size. */
export async function sceneIndexJob(port: IndexPagePort, value: unknown, size: unknown): Promise<unknown> {
  const started = performance.now();
  const input = jobInput(value);
  if (typeof size !== "number" || !Number.isInteger(size) || size < 16) throw new Error("indexJob needs a size.");
  if (!sameScene(port, input)) throw new Error(`indexJob: the job is not a frame of ${port.scenePath} as saved.`);
  if (input.view !== null && typeof input.view !== "string") throw new Error("indexJob: a free view is not drawn.");
  const api = globalThis.__scenity;
  if ((input.scene?.sequence ?? null) !== null) {
    if (api?.seek === undefined) throw new Error("indexJob: the page has no sequence.");
    await api.seek(input.timeMs);
  }
  const bitmap = await port.preview(input.view, size);
  if (bitmap === null) throw new Error("indexJob: the page gave no picture.");
  const picture = await encodeBitmap(bitmap);
  return { simMs: input.timeMs, ...picture, metrics: null, reads: null, ms: performance.now() - started };
}

type Call = (args: readonly unknown[]) => unknown;

/** The index calls of the scene page. */
export function sceneIndexCalls(port: IndexPagePort): Readonly<Record<string, Call>> {
  return {
    indexJob: (args) => sceneIndexJob(port, args[0], args[1]),
    indexPlan: () => [],
    indexInput: () => null,
    indexChanged: () => null,
  };
}
