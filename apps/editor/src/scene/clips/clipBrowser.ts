// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the clip browser: the clips of the model of an entity and of the clip source of its animator, a clip as
 * drag data, and the command that puts a clip on the timeline as an animation key. The key goes on the animation track
 * of the entity; with no such track, a new track starts with the key. Pure functions.
 */
import type { SequenceDocument } from "@scenity/scene/sequence";

/** The drag type of a clip of the clip browser. */
export const CLIP_DRAG_TYPE = "application/x-scenity-clip";

/** A clip of the browser: its asset, its name, its length and where it comes from. */
export interface ClipRow {
  /** The asset of the clip (`asset:<id>`). */
  readonly asset: string;
  readonly name: string;
  /** The length in seconds, or null when the report does not give it. */
  readonly seconds: number | null;
  /** The model of the entity, or the clip source of its animator (the clip plays retargeted). */
  readonly from: "model" | "source";
}

/** A clip in a drag: the entity that plays it, its asset and its name. */
export interface ClipDrag {
  readonly entity: string;
  readonly clip: string;
  readonly name: string;
}

/** The parts of the model of an entity in the inspect report. */
export interface ClipParts {
  readonly clips?: readonly string[];
  readonly clipSeconds?: Readonly<Record<string, number>>;
  readonly sourceClips?: readonly string[];
}

/** The components of an entity that the browser reads. */
export interface ClipComponents {
  readonly model?: unknown;
  readonly animator?: unknown;
}

const assetOf = (value: unknown): string | undefined => {
  const asset = (value as { asset?: unknown } | undefined)?.asset;
  return typeof asset === "string" ? asset : undefined;
};

/** The clips of an entity: the clips of its model, then the clips of the clip source of its animator. */
export function clipRows(components: ClipComponents, parts: ClipParts | undefined): ClipRow[] {
  const model = assetOf(components.model);
  const source = assetOf((components.animator as { clipSource?: unknown } | undefined)?.clipSource);
  const own =
    model === undefined
      ? []
      : (parts?.clips ?? []).map((name) => ({
          asset: model,
          name,
          seconds: parts?.clipSeconds?.[name] ?? null,
          from: "model" as const,
        }));
  const other =
    source === undefined || source === model
      ? []
      : (parts?.sourceClips ?? []).map((name) => ({ asset: source, name, seconds: null, from: "source" as const }));
  return [...own, ...other];
}

/** The drag data of a clip of an entity. */
export function clipDragText(entity: string, row: ClipRow): string {
  return JSON.stringify({ entity, clip: row.asset, name: row.name } satisfies ClipDrag);
}

/** The clip of drag data, or null for data that is not a clip. */
export function readClipDrag(text: string): ClipDrag | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const drag = value as Partial<ClipDrag> | null;
  return typeof drag?.entity === "string" && typeof drag.clip === "string" && typeof drag.name === "string"
    ? { entity: drag.entity, clip: drag.clip, name: drag.name }
    : null;
}

/** A command of the sequencer and its arguments. */
export interface ClipCommand {
  readonly command: "sequence.key.add" | "sequence.track.add";
  readonly args: Readonly<Record<string, unknown>>;
}

/** The command that puts a clip at a time: a key on the animation track of the entity, or a new track with the key. */
export function clipCommand(sequence: SequenceDocument, drag: ClipDrag, t: number): ClipCommand {
  const time = Math.min(Math.max(0, Math.round(t)), sequence.duration);
  const key = { clip: drag.clip, name: drag.name };
  const track = sequence.tracks.findIndex((item) => item.kind === "animation" && item.entity === drag.entity);
  if (track >= 0) return { command: "sequence.key.add", args: { track, t: time, value: JSON.stringify(key) } };
  const keys = JSON.stringify([{ t: time, ...key }]);
  return { command: "sequence.track.add", args: { kind: "animation", entity: drag.entity, keys } };
}
