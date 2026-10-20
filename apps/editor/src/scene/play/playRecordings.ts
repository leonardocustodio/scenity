// SPDX-License-Identifier: Apache-2.0
/**
 * The input hints and the saved input recordings of the play mode. The hints list each action of the input maps of the
 * project plugins with its keys or its pointer press, so the person knows the keys of the game. The saved recordings
 * are the input of play sessions under a name; the browser storage keeps them for each project (a per-person
 * convenience). A replay of a saved recording gives the frames of its live session. Pure functions, no DOM.
 */
import { INPUT_FORMAT, type InputRecording } from "@scenity/scene/sequence";
import type { InputMap, PointerBinding } from "@scenity/runtime/inputMap";

/** One action of the hints: its keys (labels) and its pointer press, or null. */
export interface InputHint {
  readonly action: string;
  readonly keys: readonly string[];
  readonly pointer: PointerBinding | null;
}

/** The label of a `KeyboardEvent.code` ("ArrowUp" is ↑, "KeyW" is W, "Digit1" is 1). */
export function keyLabel(code: string): string {
  const arrows: Readonly<Record<string, string>> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code] !== undefined) return arrows[code];
  const match = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return match?.[1] ?? code;
}

/** The hints of the input maps: one line for each action, in sorted order. */
export function inputHints(maps: readonly InputMap[]): InputHint[] {
  const out = new Map<string, { keys: string[]; pointer: PointerBinding | null }>();
  for (const map of maps) {
    for (const [action, codes] of Object.entries(map.keys ?? {})) {
      const known = out.get(action) ?? { keys: [], pointer: null };
      out.set(action, { ...known, keys: [...new Set([...known.keys, ...codes.map(keyLabel)])] });
    }
    for (const [action, binding] of Object.entries(map.pointer ?? {})) {
      out.set(action, { keys: out.get(action)?.keys ?? [], pointer: binding });
    }
  }
  return [...out]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([action, value]) => ({ action, keys: value.keys, pointer: value.pointer }));
}

/** A saved recording: its name, the time of the save and the input. */
export interface SavedRecording {
  readonly name: string;
  readonly savedAt: number;
  readonly recording: InputRecording;
}

/** The storage key of the saved recordings of a project. */
export function recordingsKey(project: string): string {
  return `scenity.play.recordings.${project}`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem"> | null;

/** A saved recording of the storage, or null when the value is not one. */
function savedOf(value: unknown): SavedRecording | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Partial<SavedRecording>;
  const recording = item.recording as Partial<InputRecording> | undefined;
  if (typeof item.name !== "string" || typeof item.savedAt !== "number") return null;
  if (recording?.format !== INPUT_FORMAT || !Array.isArray(recording.events)) return null;
  return { name: item.name, savedAt: item.savedAt, recording: recording as InputRecording };
}

/** The saved recordings of a project, the newest first (none: no storage or a value that does not read). */
export function readRecordings(storage: Storage, project: string): SavedRecording[] {
  try {
    const parsed = JSON.parse(storage?.getItem(recordingsKey(project)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((item) => savedOf(item) ?? []) : [];
  } catch {
    return [];
  }
}

/** Keep the saved recordings of a project; false when the storage refuses them (a full storage). */
export function writeRecordings(storage: Storage, project: string, list: readonly SavedRecording[]): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(recordingsKey(project), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** The list with a recording under a name (it replaces a recording with the same name), the newest first. */
export function withRecording(
  list: readonly SavedRecording[],
  name: string,
  recording: InputRecording,
  now: number,
): SavedRecording[] {
  return [{ name, savedAt: now, recording }, ...list.filter((item) => item.name !== name)];
}
