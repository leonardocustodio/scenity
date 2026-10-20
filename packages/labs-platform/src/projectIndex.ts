// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of a scene project: the plans of the index from the documents of the project
 * (`scenity.project/1`), with the key of a scene frame (`sceneFrameKey`).
 *
 * - Each sequence of the project gives one plan: `sequence:<path>`, over its scene, from 0 to its duration, with its
 *   markers and the times of its keys as the moments.
 * - Each scene that no sequence uses gives one still plan: `scene:<path>` at time 0.
 * - The views of a plan are the document cameras of its scene (the entities with a `camera` component), in the order
 *   of their IDs; a scene with no camera gives the default view (null).
 *
 * The documents of a frame are the project document and the scene document by their path in the project; the sequence
 * document is the `sequence` part. The order of the plans follows the scenes of the project, and the sequences of a
 * scene follow the sequences of the project. The module reads the documents as plain JSON (no schema), so it stays
 * pure and needs no other package.
 */
import { DEFAULT_BACKEND, type FrameView, type RendererBackend } from "./frameKey";
import type { IndexPlan } from "./indexSource";

/** The project document in a project folder. */
export const PROJECT_DOCUMENT = "scenity.project.json";

/** The parts of a project document that give the plans. */
export interface ProjectIndexDocument {
  readonly scenes?: readonly string[] | undefined;
  readonly sequences?: readonly string[] | undefined;
}

/** The options of the frames of a project: the tier, the backend and the renderer options of the scene page. */
export interface ProjectPlanOptions {
  readonly tier?: string;
  readonly backend?: RendererBackend;
  readonly renderer?: Readonly<Record<string, unknown>>;
}

/** The tier of the scene page (apps/editor `src/scene/main.ts`). */
export const PROJECT_TIER = "high";

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The IDs of the document cameras of a scene, sorted; `[null]` (the default view) for a scene with no camera. */
export function documentCameras(scene: unknown): FrameView[] {
  const entities = record(record(scene)?.entities) ?? {};
  const ids = Object.keys(entities)
    .filter((id) => record(record(entities[id])?.components)?.camera !== undefined)
    .sort();
  return ids.length === 0 ? [null] : ids;
}

/** The moments of a sequence: its markers and the times of its keys inside the duration, sorted, each once. */
export function sequenceMoments(sequence: unknown): number[] {
  const doc = record(sequence) ?? {};
  const duration = typeof doc.duration === "number" ? doc.duration : 0;
  const times = new Set<number>();
  for (const value of Object.values(record(doc.markers) ?? {})) if (typeof value === "number") times.add(value);
  for (const track of Array.isArray(doc.tracks) ? doc.tracks : []) {
    const keys = record(track)?.keys;
    for (const key of Array.isArray(keys) ? keys : []) {
      const t = record(key)?.t;
      if (typeof t === "number") times.add(t);
    }
  }
  return [...times].filter((time) => time >= 0 && time <= duration).sort((a, b) => a - b);
}

/**
 * The plans of the frame index of a project. `files` holds the parsed scene and sequence documents by their path in
 * the project; a path without a document (a file that does not read) gives no plan.
 */
export function projectPlans(
  project: ProjectIndexDocument,
  files: Readonly<Record<string, unknown>>,
  options: ProjectPlanOptions = {},
): IndexPlan[] {
  const common = {
    events: [],
    tunes: {},
    renderer: options.renderer ?? {},
    tier: options.tier ?? PROJECT_TIER,
    ...(options.backend === undefined || options.backend === DEFAULT_BACKEND ? {} : { backend: options.backend }),
  };
  const sequences = (project.sequences ?? []).filter((path) => record(files[path]) !== null);
  const plans: IndexPlan[] = [];
  for (const scenePath of project.scenes ?? []) {
    const scene = record(files[scenePath]);
    if (scene === null) continue;
    const documents = { [PROJECT_DOCUMENT]: project, [scenePath]: scene };
    const views = documentCameras(scene);
    const own = sequences.filter((path) => record(files[path])?.scene === scene.id);
    for (const path of own) {
      const sequence = files[path];
      const duration = record(sequence)?.duration;
      plans.push({
        ...common,
        source: `sequence:${path}`,
        durationMs: typeof duration === "number" ? duration : 0,
        moments: sequenceMoments(sequence),
        views,
        scene: { documents, overrides: [], sequence, input: null },
      });
    }
    if (own.length > 0) continue;
    plans.push({
      ...common,
      source: `scene:${scenePath}`,
      durationMs: 0,
      moments: [0],
      views,
      scene: { documents, overrides: [], sequence: null, input: null },
    });
  }
  return plans;
}
