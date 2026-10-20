// SPDX-License-Identifier: Apache-2.0
/**
 * The URL of the lab frame of the indexer window for a job.
 *
 * The lab draws a job only with its own scene options (apps/editor `lab/index/renderJob.ts`: the tunes, the renderer
 * options, the tier, the backend and a view track must be those of the page). The host gives the URL of the built lab
 * (`SurfaceState.indexerUrl`); the indexer page adds the options of the job as URL parameters of the lab
 * (Room3DLab.vue: `tier`, `backend`, `debug`, `assets`, `motion`, `tune`, `source`, `scratch`) and loads the frame
 * again only when they change. The events, the time and the view of a job need no reload: the bridge call
 * `indexJob` draws them.
 */
import { DEFAULT_BACKEND, stableJson, type FrameKeyInput } from "@scenity/labs-platform/frameKey";

/** The scene options of a job that the URL of the lab frame carries. */
export interface FrameSpec {
  readonly tier: string;
  readonly backend: string;
  readonly debug: readonly string[];
  readonly assets: boolean;
  readonly reduced: boolean;
  readonly tunes: Readonly<Record<string, number>>;
  /** `track:<name>` for a view track, else null. */
  readonly track: string | null;
  /** The scratch props of the job (the text of the `scratch` URL parameter), "" for none. */
  readonly scratch: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function tunesOf(value: FrameKeyInput["tunes"]): Record<string, number> {
  if (Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [path, amount] of Object.entries(value)) if (typeof amount === "number") out[path] = amount;
  return out;
}

/** The scene options of a job input. */
export function specOf(input: FrameKeyInput): FrameSpec {
  const renderer = input.renderer;
  return {
    tier: input.tier,
    backend: input.backend ?? DEFAULT_BACKEND,
    debug: [...strings(renderer.debug)].sort(),
    assets: renderer.assets !== false,
    reduced: renderer.reduced === true,
    tunes: tunesOf(input.tunes),
    track: input.source.startsWith("track:") ? input.source : null,
    scratch: typeof renderer.scratch === "string" ? renderer.scratch : "",
  };
}

/** The key of a spec: two jobs with the same key draw in the same frame without a reload. */
export function specKey(spec: FrameSpec): string {
  return stableJson(spec);
}

/** The text of the `tune` parameter of the lab (`path:value,path:value`, room3d-labs `tuneText`). */
export function tuneText(tunes: Readonly<Record<string, number>>): string {
  return Object.entries(tunes)
    .map(([path, value]) => `${path}:${String(value)}`)
    .join(",");
}

/** The URL of the lab frame for a spec, from the URL of the built lab that the host gives. */
export function frameUrl(base: string, spec: FrameSpec): string {
  const url = new URL(base);
  const params = url.searchParams;
  params.set("tier", spec.tier);
  params.set("backend", spec.backend);
  const set = (name: string, value: string | null): void => {
    if (value === null || value === "") params.delete(name);
    else params.set(name, value);
  };
  set("debug", spec.debug.join(","));
  set("assets", spec.assets ? null : "0");
  set("motion", spec.reduced ? "reduced" : null);
  set("tune", tuneText(spec.tunes));
  set("source", spec.track);
  set("scratch", spec.scratch);
  return url.toString();
}
