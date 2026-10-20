// SPDX-License-Identifier: Apache-2.0
/**
 * The play mode of the scene page in the edit mode. The edit state and the play state are separate (`PlaySession` of
 * `@scenity/editor-core`, through the page editor):
 *
 * - Play keeps the edit state (the scene, the sequence, the view state; the time of the clock, the selection and the
 *   record mode), then plays the sequence from 0 ms on the play state. The core runs the animators, the walks and the
 *   sounds from the start (a seek with a new seek count), and the audio player follows the clock.
 * - An edit in the play mode (the gizmo, the inspector, a command) changes only the play state.
 * - Stop restores the edit state exactly: the documents, the steps of the history, the time, the selection and the
 *   record mode. The file stays as it was, and the dirty state too.
 * - Keep stops and applies the chosen changes to the edit state as one step of the history.
 * - Play in a window opens the play page (@scenity/player) with the current documents. The edit view does not change.
 *   With an input recording, the window replays it.
 * - In the play mode, the keys and the pointer give the input events of the project plugins (playInput.ts). The
 *   session records them. A play with a recording (`startPlay(recording)`) replays them in place of the input.
 *
 * The body has `data-play="1"` while the play mode runs (the tint of play.css). No Vue.
 */
import type { PlayChange } from "@scenity/editor-core";
import type { InputRecording } from "@scenity/scene/sequence";
import { HANDOFF_FORMAT, readHandoff, writeHandoff, type HandoffStorage } from "../../player/handoff";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSequence, PageTime } from "../sequencer/pageSequence";
import type { PlayInput } from "./playInput";

/** What the play mode reads of the page. */
export interface PlayParts {
  readonly editor: ScenePageEditor;
  /** The name of the project and the camera of the page (null: the first camera), for the play window. */
  readonly project: string;
  camera(): string | null;
  /** The clock of the page as the sequencer drives it, or null with no sequence. */
  readonly time: PageTime | null;
  /** The open sequence, or null. */
  readonly sequence: PageSequence | null;
  /** The selection of the page. */
  readonly selection?: { readonly ids: readonly string[]; set(ids: readonly string[]): void };
  /** Open a window at a URL; null when the browser refuses it (default: `window.open`). */
  open?(url: string): unknown;
  /** The input of the play mode; absent: no input events. */
  readonly input?: PlayInput;
}

/** A change of the play state as the script API gives it (no ops). */
export type PlayChangeInfo = Omit<PlayChange, "ops">;

/** The current state of the play mode. */
export interface PlayModeInfo {
  readonly active: boolean;
  /** The parts of the play state that differ from the edit state (empty in the edit mode). */
  readonly changes: readonly PlayChangeInfo[];
}

/**
 * The options of a start of the play mode. `view` is the view in front during the play: the Game view (the default) or
 * the Scene view, where the person (or a test) plays in the edit view.
 */
export interface PlayStartOptions {
  readonly view?: "game" | "scene";
}

/** The play part of the script API of the scene page. */
export interface PlayApi {
  playMode(): PlayModeInfo;
  /**
   * Start the play mode and wait for a frame; the reason of a refusal, or null. With a recording, the play replays its
   * input events in place of the live input.
   */
  startPlay(replay?: InputRecording, options?: PlayStartOptions): Promise<string | null>;
  /** The input recording of the current play session, else of the last one; null before the first play. */
  playRecording(): InputRecording | null;
  /** Stop the play mode and wait for the frame of the edit state. */
  stopPlay(): Promise<void>;
  /** Stop and keep the changes with the IDs (all with no IDs) as one step; true when a step was made. */
  keepPlay(ids?: readonly string[]): Promise<boolean>;
  /** Open the play window with the current documents; false when the browser refuses a window. */
  playWindow(): boolean;
}

/** The page state that the play mode keeps at its start. */
interface Saved {
  readonly t: number;
  readonly playing: boolean;
  readonly ids: readonly string[];
  readonly record: boolean;
}

/** The local storage of the page; a storage that refuses each write when the browser blocks it. */
function localStore(): HandoffStorage {
  try {
    return globalThis.localStorage;
  } catch {
    const refuse = (): never => {
      throw new Error("the browser blocks the local storage");
    };
    return { getItem: () => null, setItem: refuse, removeItem: refuse };
  }
}

/** The recording field of a handoff: a recording with events, else no field (the window takes the live input). */
function recordingOf(recording: InputRecording | null): { recording?: InputRecording } {
  return recording === null || recording.events.length === 0 ? {} : { recording };
}

export class PagePlay {
  readonly parts: PlayParts;
  readonly #listeners = new Set<(active: boolean) => void>();
  #saved: Saved | null = null;
  #count = 0;
  /** The start of the input of the play mode. */
  #input: Promise<void> = Promise.resolve();
  /** The view in front during the current play. */
  #view: "game" | "scene" = "game";

  constructor(parts: PlayParts) {
    this.parts = parts;
  }

  get active(): boolean {
    return this.parts.editor.play.active;
  }

  /** The view in front during the current play (the Game view by default). */
  get view(): "game" | "scene" {
    return this.#view;
  }

  /** Call `listener` after a start or an end of the play mode; the result stops it. */
  listen(listener: (active: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The current changes of the play state. */
  changes(): PlayChange[] {
    return this.parts.editor.play.changes();
  }

  /** Start the play mode (with a recording, a replay of its input); the reason of a refusal, or null. */
  start(replay?: InputRecording, options: PlayStartOptions = {}): string | null {
    const { editor, time, selection, sequence } = this.parts;
    this.#view = options.view ?? "game";
    const saved: Saved = {
      t: time?.now() ?? 0,
      playing: time?.playing() ?? false,
      ids: [...(selection?.ids ?? [])],
      record: sequence?.recording ?? false,
    };
    const reason = editor.enterPlay();
    if (reason !== null) return reason;
    this.#saved = saved;
    time?.seek(0);
    this.#input = this.parts.input?.start(replay) ?? Promise.resolve();
    time?.play();
    document.body.dataset.play = "1";
    this.#tell(true);
    return null;
  }

  /** Stop the play mode and restore the edit state. */
  stop(): void {
    if (!this.active) return;
    this.parts.editor.stopPlay();
    this.#restore();
  }

  /** Stop and keep the changes with the IDs `ids` (all with no IDs) as one step; true when a step was made. */
  keep(ids?: readonly string[]): boolean {
    if (!this.active) return false;
    const result = this.parts.editor.keepPlay(ids);
    this.#restore();
    return result.applied;
  }

  /** Restore the time, the selection and the record mode of the edit state. */
  #restore(): void {
    const saved = this.#saved;
    this.#saved = null;
    delete document.body.dataset.play;
    this.#input = this.parts.input?.stop() ?? Promise.resolve();
    if (saved !== null) {
      const { time, selection, sequence, editor } = this.parts;
      time?.seek(saved.t);
      if (saved.playing) time?.play();
      selection?.set(saved.ids.filter((id) => editor.doc.entities[id] !== undefined));
      sequence?.setRecording(saved.record);
    }
    this.#tell(false);
  }

  /**
   * Write a handoff of the current documents (the play state in the play mode). Return the URL of the play page for
   * it with more parameters (the Game view embeds it), or null when the storage refuses the handoff.
   */
  handoffUrl(more: Readonly<Record<string, string>> = {}, camera?: string | null): string | null {
    const { editor, project, sequence } = this.parts;
    this.#count += 1;
    const key = `${String(Date.now())}-${String(this.#count)}`;
    const handoff = {
      format: HANDOFF_FORMAT,
      project,
      scene: editor.doc,
      sequence: sequence?.channel.doc ?? null,
      camera: camera === undefined ? this.parts.camera() : camera,
      // The input recording of the play mode, so the window replays it.
      ...recordingOf(this.parts.input?.recording() ?? null),
    } as const;
    if (!writeHandoff(localStore(), key, handoff)) return null;
    // The play window shows the texts in the locale of the page.
    const query = new URLSearchParams({ handoff: key, ...more });
    const locale = new URLSearchParams(location.search).get("locale");
    if (locale !== null) query.set("locale", locale);
    return `/player/play.html?${query.toString()}`;
  }

  /** Open the play window with the current documents (the play state in the play mode); false on a refusal. */
  openWindow(): boolean {
    const url = this.handoffUrl();
    if (url === null) return false;
    const opened = (this.parts.open ?? ((at: string) => window.open(at, "_blank", "popup,width=960,height=600")))(url);
    if (opened !== null && opened !== undefined) return true;
    // A refused window (a frame with no popups, a popup blocker) takes no handoff: remove it.
    readHandoff(localStore(), new URL(url, location.href).searchParams.get("handoff") ?? "", true);
    return false;
  }

  /** The script API of the play mode. `frame` waits for the next frame of the core. */
  api(frame: () => Promise<void>): PlayApi {
    const after = async (): Promise<void> => {
      await this.parts.editor.settled();
      await this.parts.sequence?.settled();
      await frame();
    };
    return {
      playMode: () => ({
        active: this.active,
        changes: this.changes().map(({ id, channel, entity, component, label }) => ({
          ...{ id, channel, entity, component, label },
        })),
      }),
      startPlay: async (replay, options) => {
        const reason = this.start(replay, options);
        if (reason === null) await this.#input;
        if (reason === null) await after();
        return reason;
      },
      playRecording: () => this.parts.input?.recording() ?? null,
      stopPlay: async () => {
        this.stop();
        await this.#input;
        await after();
      },
      keepPlay: async (ids) => {
        const kept = this.keep(ids);
        await after();
        return kept;
      },
      playWindow: () => this.openWindow(),
    };
  }

  #tell(active: boolean): void {
    for (const listener of this.#listeners) listener(active);
  }
}
