// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of a project: the frames of the plans of the project (`projectPlans` of `@scenity/labs-platform`: one
 * plan for each sequence, one for each scene that no sequence uses), by sequence, camera and time. The times of a plan
 * are 0 ms and its moments (the markers and the key times of the sequence); `step` adds a time each `step` ms. The key
 * of a frame is the frame key of the platform, so a change of a document, an asset or plugin code gives a new key.
 *
 * `scenity frames` draws the frames that have no picture into `.scenity/frames/<key>.png` and writes the list
 * `.scenity/frames/index.json`. The list keeps two pictures of each place (a plan, a camera and a time): the newest
 * one and the one before, so the Frame index panel of the editor can compare them. A frame whose key is not a key of
 * the current project is stale.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { ContentHasher, fsContentReader, projectContent } from "@scenity/labs-platform/contentHash";
import { frameKey, type FrameView } from "@scenity/labs-platform/frameKey";
import { planInput } from "@scenity/labs-platform/indexSource";
import { PROJECT_DOCUMENT, projectPlans } from "@scenity/labs-platform/projectIndex";
import { canonicalJson } from "@scenity/scene/canonical";

/** The folder of the pictures and the list, relative to the project folder. */
export const FRAMES_FOLDER = ".scenity/frames";
/** The list of the frames, relative to the project folder. */
export const FRAMES_FILE = `${FRAMES_FOLDER}/index.json`;
/** The pictures of each place that the list keeps. */
export const KEEP_PER_PLACE = 2;

/** One frame of the current project: its place and its key. */
export interface WantedFrame {
  readonly key: string;
  /** `sequence:<path>` or `scene:<path>`. */
  readonly plan: string;
  readonly scene: string;
  readonly sequence: string | null;
  /** The document camera, or null for the camera of the scene. */
  readonly camera: string | null;
  /** The time in ms (0 for a scene with no sequence). */
  readonly time: number;
  /** True for a marker or a key time of the sequence. */
  readonly moment: boolean;
}

/** One frame with a picture. */
export interface IndexedFrame extends WantedFrame {
  /** The time of the picture (ISO 8601). */
  readonly made: string;
}

/** The list of the frames of a project. */
export interface FrameIndexFile {
  readonly format: "scenity.frame-index/1";
  readonly frames: readonly IndexedFrame[];
}

type Json = Readonly<Record<string, unknown>>;
const record = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

/** The project document and its scene and sequence documents by their path; a file that does not read gives no entry.
 * */
export function projectDocuments(dir: string): { project: Json; files: Record<string, unknown> } {
  const project = record(JSON.parse(fs.readFileSync(join(dir, PROJECT_DOCUMENT), "utf8"))) ?? {};
  const files: Record<string, unknown> = {};
  const paths = [project.scenes, project.sequences].flatMap((list): unknown[] => (Array.isArray(list) ? list : []));
  for (const path of paths.filter((item): item is string => typeof item === "string")) {
    try {
      files[path] = JSON.parse(fs.readFileSync(join(dir, ...path.split("/")), "utf8"));
    } catch {
      // A file that does not read gives no plan.
    }
  }
  return { project, files };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const hashers = new Map<string, ContentHasher>();

/** The content hash of a project folder: its plugin code and assets (a hasher per folder keeps the file digests). */
export function projectContentHash(dir: string, project: Json): string {
  const content = projectContent(project);
  const id = `${dir}\n${JSON.stringify(content.roots)}`;
  let hasher = hashers.get(id);
  if (hasher === undefined) {
    hasher = new ContentHasher(fsContentReader(fs, dir, content), sha256);
    hashers.set(id, hasher);
  }
  return hasher.hash();
}

/** The camera of a view of a plan: a document camera, or null. */
const cameraOf = (view: FrameView): string | null => (typeof view === "string" ? view : null);

/** The current frames of a project. `step` (ms) adds the times of a grid to each sequence. */
export function wantedFrames(
  project: Json,
  files: Readonly<Record<string, unknown>>,
  contentHash: string,
  step = 0,
): WantedFrame[] {
  const frames: WantedFrame[] = [];
  for (const plan of projectPlans(project, files)) {
    const sequence = plan.source.startsWith("sequence:") ? plan.source.slice("sequence:".length) : null;
    const documents = plan.scene?.documents ?? {};
    const scene = Object.keys(documents).find((path) => path !== PROJECT_DOCUMENT) ?? "";
    const times = new Map<number, boolean>([[0, false]]);
    if (step > 0) for (let time = step; time <= plan.durationMs; time += step) times.set(time, false);
    for (const moment of plan.moments) times.set(moment, sequence !== null);
    for (const view of plan.views) {
      for (const [time, moment] of [...times].sort((a, b) => a[0] - b[0])) {
        const key = frameKey(planInput(plan, contentHash, time, view));
        frames.push({ key, plan: plan.source, scene, sequence, camera: cameraOf(view), time, moment });
      }
    }
  }
  return frames;
}

/** The place of a frame: its plan, its camera and its time. */
export const placeOf = (frame: WantedFrame): string => `${frame.plan}|${frame.camera ?? ""}|${String(frame.time)}`;

/** The frames of the list with the new ones: each place keeps its newest `keep` pictures (one per key). */
export function mergeFrames(
  old: readonly IndexedFrame[],
  added: readonly IndexedFrame[],
  keep = KEEP_PER_PLACE,
): IndexedFrame[] {
  const byPlace = new Map<string, IndexedFrame[]>();
  for (const frame of [...added, ...old]) {
    const list = byPlace.get(placeOf(frame)) ?? [];
    if (!list.some((each) => each.key === frame.key)) list.push(frame);
    byPlace.set(placeOf(frame), list);
  }
  return [...byPlace.values()].flatMap((list) => list.sort((a, b) => b.made.localeCompare(a.made)).slice(0, keep));
}

/** The list of a project folder (an empty list when it has none or it does not read). */
export function readFrameIndex(dir: string): FrameIndexFile {
  try {
    const value = record(JSON.parse(fs.readFileSync(join(dir, FRAMES_FILE), "utf8")));
    if (value?.format === "scenity.frame-index/1" && Array.isArray(value.frames)) {
      return { format: "scenity.frame-index/1", frames: value.frames as IndexedFrame[] };
    }
  } catch {
    // No list yet.
  }
  return { format: "scenity.frame-index/1", frames: [] };
}

/** Write the list of a project folder. */
export function writeFrameIndex(dir: string, frames: readonly IndexedFrame[]): void {
  fs.mkdirSync(join(dir, FRAMES_FOLDER), { recursive: true });
  fs.writeFileSync(join(dir, FRAMES_FILE), canonicalJson({ format: "scenity.frame-index/1", frames }));
}

/** The frames of a list with a stale mark: a frame whose key is not a key of the current project. */
export function withStaleMarks(
  frames: readonly IndexedFrame[],
  wanted: readonly WantedFrame[],
): (IndexedFrame & { readonly stale: boolean })[] {
  const keys = new Set(wanted.map((frame) => frame.key));
  return frames.map((frame) => ({ ...frame, stale: !keys.has(frame.key) }));
}
