// SPDX-License-Identifier: Apache-2.0
/**
 * The key of a frame. A frame is a pure function of its input and the sim time, so a key that holds every input
 * names one picture. The lab page (the strip, the index readers), the host (the index store and the job queue) and
 * the tools use this one module. Thus each part gives the same key for the same frame.
 *
 *   frameKey = hash(take or track, events, time, view or pane views, tune values, renderer options, tier, backend,
 *                   contentHash)
 *
 * `contentHash` (contentHash.ts) is a hash of the working-tree files that a frame depends on, not of the commit: an
 * edit that is not committed changes it. The module is pure (no `node:`, `bun:` or DOM import).
 */
import { sha256Hex } from "./sha256";

/** The renderer backend of a frame. The default is `webgl`. */
export type RendererBackend = "webgl" | "webgpu";
export const DEFAULT_BACKEND: RendererBackend = "webgl";

/** The view of a frame: a named camera, a free view `[x, y, z, tx, ty, tz, fov]`, or the panes of a split screen. */
export type FrameView =
  | string
  | readonly number[]
  | null
  | { readonly panes: readonly (string | readonly number[] | null)[]; readonly layout?: string };

/** Every input of a frame. */
export interface FrameKeyInput {
  /** The source of the scene: `take:<name>` or `track:<name>`. */
  readonly source: string;
  /** The events of the panel (the `rec` of the URL), in their order. */
  readonly events: readonly unknown[];
  /** The sim time in ms; the key uses the time rounded to a whole ms. */
  readonly timeMs: number;
  readonly view: FrameView;
  /** The tune values that are not in the code. */
  readonly tunes: Readonly<Record<string, unknown>> | readonly unknown[];
  /** The renderer options that change pixels: the debug layers, the assets (graybox or not), the fog and others. */
  readonly renderer: Readonly<Record<string, unknown>>;
  /** The quality tier: `ultra`, `high`, `medium` or `low`. */
  readonly tier: string;
  /** The renderer backend; absent means `DEFAULT_BACKEND`. */
  readonly backend?: RendererBackend;
  /** The content hash of the sources and of the asset manifest (contentHash.ts). */
  readonly contentHash: string;
  /**
   * The documents of a frame of a scene project. With this field the key is `sceneFrameKey` (version 2) of
   * these parts and of the time, the view, the renderer, the tier, the backend and the content hash; `events` and
   * `tunes` are then empty. Absent for a frame of a take of the lab (version 1).
   */
  readonly scene?: SceneKeyParts;
}

/** The parts of `SceneFrameKeyInput` that a frame of a scene project adds to a `FrameKeyInput`. */
export type SceneKeyParts = Pick<SceneFrameKeyInput, "documents" | "overrides" | "sequence" | "input">;

/** The `SceneFrameKeyInput` of a frame input with scene parts. */
export function sceneKeyInput(input: FrameKeyInput & { readonly scene: SceneKeyParts }): SceneFrameKeyInput {
  const { documents, overrides, sequence, input: plugin } = input.scene;
  return {
    documents,
    overrides,
    sequence,
    timeMs: input.timeMs,
    input: plugin,
    view: input.view,
    renderer: input.renderer,
    tier: input.tier,
    ...(input.backend === undefined ? {} : { backend: input.backend }),
    contentHash: input.contentHash,
  };
}

/** The length of a key: 32 hex characters (128 bits of the SHA-256). */
export const KEY_LENGTH = 32;
/** The form of a frame key and of a content hash. */
export const KEY_PATTERN = /^[0-9a-f]{32}$/;

/** True for a frame key or a content hash. */
export function isFrameKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

function stableNumber(value: number): string {
  if (!Number.isFinite(value)) return "null";
  // -0 and 0 are the same input.
  return JSON.stringify(value === 0 ? 0 : value);
}

/**
 * JSON text with the keys of each object in sorted order, so two objects with the same entries give the same text in
 * any key order. Arrays keep their order (the order of events is an input). An absent or `undefined` field is left out,
 * as `JSON.stringify` does; `undefined` in an array is `null`.
 */
export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return stableNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item: unknown) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined && typeof record[key] !== "function")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

/** A short hash of a stable JSON text (`length` hex characters). */
export function shortHash(value: unknown, length = KEY_LENGTH): string {
  return sha256Hex(stableJson(value)).slice(0, length);
}

/** The time of a key: a whole ms. */
export function keyTime(timeMs: number): number {
  return Math.round(timeMs) || 0;
}

/**
 * The key of a frame: 32 hex characters. Equal inputs give equal keys, in any key order of their objects. An input
 * with scene parts gives `sceneFrameKey`.
 */
export function frameKey(input: FrameKeyInput): string {
  if (input.scene !== undefined) return sceneFrameKey(sceneKeyInput({ ...input, scene: input.scene }));
  return shortHash({
    v: 1,
    source: input.source,
    events: input.events,
    time: keyTime(input.timeMs),
    view: input.view,
    tunes: input.tunes,
    renderer: input.renderer,
    tier: input.tier,
    backend: input.backend ?? DEFAULT_BACKEND,
    content: input.contentHash,
  });
}

/**
 * The key of a take in the index (the folder `index/<contentHash>/<take key>/`): every input of the frame except the
 * time, the view and the content hash. 16 hex characters. For a frame of a scene project, the key holds the scene
 * parts with the renderer, the tier and the backend (version 2).
 */
export function takeKeyOf(input: FrameKeyInput): string {
  if (input.scene !== undefined) {
    const { documents, overrides, sequence, input: plugin } = input.scene;
    const backend = input.backend ?? DEFAULT_BACKEND;
    const scene = { documents, overrides, sequence: sequence ?? null, input: plugin ?? null };
    return shortHash({ v: 2, ...scene, renderer: input.renderer, tier: input.tier, backend }, 16);
  }
  return shortHash(
    {
      v: 1,
      source: input.source,
      events: input.events,
      tunes: input.tunes,
      renderer: input.renderer,
      tier: input.tier,
      backend: input.backend ?? DEFAULT_BACKEND,
    },
    16,
  );
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The name of a view in a file name: a named camera as it is, else a hash of 8 hex characters. */
export function viewKeyOf(view: FrameView): string {
  return typeof view === "string" && NAME.test(view) ? view : shortHash(view, 8);
}

/**
 * Every input of a frame of a scene document: a frame is `evaluate(documents, overrides, sequence, t, plugins)`, so
 * the key holds each of them.
 */
export interface SceneFrameKeyInput {
  /** The documents of the frame: the project, the scene and its prefabs, by their path in the project. */
  readonly documents: Readonly<Record<string, unknown>>;
  /** The override layers in the order that they apply (variants, URL values). Proposals are not inputs. */
  readonly overrides: readonly unknown[];
  /** The sequence document, or null for a scene with no time content. */
  readonly sequence: unknown;
  /** The sim time in ms; the key uses the time rounded to a whole ms. */
  readonly timeMs: number;
  /** The plugin input (a live engine, a recorded stream), or null. */
  readonly input: unknown;
  readonly view: FrameView;
  /** The renderer options that change pixels: the debug layers, the view mode and others. */
  readonly renderer: Readonly<Record<string, unknown>>;
  readonly tier: string;
  readonly backend?: RendererBackend;
  /** The content hash of the project files that are not documents: plugin code and assets (contentHash.ts). */
  readonly contentHash: string;
}

/**
 * The key of a frame of a scene document: 32 hex characters. The version field (2) keeps these keys apart from the
 * keys of the takes of a plugin lab (`frameKey`, version 1).
 */
export function sceneFrameKey(input: SceneFrameKeyInput): string {
  return shortHash({
    v: 2,
    documents: input.documents,
    overrides: input.overrides,
    sequence: input.sequence ?? null,
    time: keyTime(input.timeMs),
    input: input.input ?? null,
    view: input.view,
    renderer: input.renderer,
    tier: input.tier,
    backend: input.backend ?? DEFAULT_BACKEND,
    content: input.contentHash,
  });
}
