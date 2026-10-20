// SPDX-License-Identifier: Apache-2.0
/**
 * The before and after of a turn of Claude. At the prompt of a turn, the host keeps the URL state of the visible lab
 * frame and a picture of it ("before"). After each edit of Claude (the `PostToolUse` hook), it waits until the dev
 * server applied the edit (HMR or a page reload). If the frame moved, it restores the URL state of the turn start.
 * Then it captures the frame again ("after"). The `agent.turn` event gives both to the page. The tool
 * `workbench_after` gives the after picture to Claude.
 *
 * The host also makes a one-row sheet of the turn window before and after, from the shadow frame (turnSheets.ts). It
 * writes the facts and the pictures of each turn into its state folder (turnPictures.ts). The `agent.turnSaved` event
 * tells the pages. The panel lists the turns after a page reload or a host restart.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { watchRoots } from "./edits";
import type { PictureStore } from "./pictures";
import type { Capture, HostEvent, SavedTurn, TurnWindow } from "./protocol";
import type { Surface } from "./surfaces";
import type { SurfacePort } from "./tools/context";
import { labUrlFacts, shownUrl } from "./tools/kit";
import type { TurnPictureStore } from "./turnPictures";
import { turnSheet, turnWindow } from "./turnSheets";

/** The result of an after capture. */
export interface AfterResult {
  readonly session: string;
  readonly turn: number;
  /** The files of the turn, relative to the checkout. */
  readonly files: readonly string[];
  /** The URL state of the turn start, or null. */
  readonly url: string | null;
  readonly before: Capture | null;
  readonly after: Capture | null;
  /** True when the frame loaded the page again for the edit. */
  readonly reloaded: boolean;
  /** False when the dev server applied no update in time (or the files are not lab files). */
  readonly applied: boolean;
  /** The error of the after capture, or null. */
  readonly error: string | null;
}

export interface TurnCaptureOptions {
  /** The visible lab surface. */
  surface(): Surface;
  checkout(): string;
  emit(event: HostEvent): void;
  /** The folders whose files the dev server serves (default: `watchRoots` of the checkout). */
  roots?(checkout: string): readonly string[];
  /** The width of the pictures (px; default 640). */
  readonly width?: number;
  /** The time for the update of the dev server (ms; default 8 s). */
  readonly hmrTimeoutMs?: number;
  /** The quiet time after an edit before the after capture (ms; default 250): many edits give one capture. */
  readonly settleMs?: number;
  /** The store of the saved turns and their pictures, or none (nothing is saved). */
  readonly pictures?: TurnPictureStore;
  /** The picture store of the host. The `agent.turn` event gives the IDs of its pictures. */
  readonly store: PictureStore;
  /** The shadow frame for the sheets of a turn, or none (no sheets). */
  readonly shadow?: () => SurfacePort;
}

/** The options of a turn start. */
export interface BeginOptions {
  readonly prompt?: string;
  /** The number of the turn in the turn store (turns.ts); the saved turn waits for it. */
  readonly numbered?: Promise<unknown>;
}

interface TurnEntry {
  readonly session: string;
  turn: number;
  readonly checkout: string;
  readonly prompt: string;
  readonly started: string;
  /** Resolves when the turn has its number of the turn store. */
  readonly numbered: Promise<unknown>;
  /** The URL state of the turn start: the last URL that the frame reported, then the URL of the bridge call. */
  url: string | null;
  before: Promise<Capture | null>;
  /** The window of the sheets, after the before sheet (null without sheets). */
  window: Promise<TurnWindow | null>;
  /** The work of the saved turn, one step after the other. */
  saving: Promise<unknown>;
  files: string[];
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<AfterResult> | null;
  again: boolean;
  last: AfterResult | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

/** True when a file is in one of the folders. */
export function underRoots(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const path = relative(root, file);
    return path !== "" && !path.startsWith("..") && !isAbsolute(path);
  });
}

/**
 * Put the frame back at the URL state of the turn start when the take, the time, the camera or the debug layers
 * differ. A reload keeps the URL state. A tool call or the owner can move the clock. Claude can show debug layers,
 * and the after picture must not show them.
 */
export async function restoreUrlState(surface: Surface, start: string, now: string): Promise<boolean> {
  const want = labUrlFacts(start);
  const have = labUrlFacts(now);
  const debug = want.debug.join(",") !== have.debug.join(",");
  const same = want.take === have.take && want.t === have.t && want.camera === have.camera;
  if (same && want.paused === have.paused && !debug) return false;
  if (want.take !== null && want.take !== have.take) await surface.call("load", [want.take]);
  if (debug) await surface.call("debug", [[...want.debug]]);
  if (want.camera !== have.camera) await surface.call("camera", [want.camera === "overview" ? null : want.camera]);
  if (want.paused) await surface.call("pause");
  if (want.t !== null) await surface.call("seek", [want.t]);
  return true;
}

/** The before and after of the turns of the open checkout, one entry per session. */
export class TurnCapture {
  readonly #options: TurnCaptureOptions;
  readonly #turns = new Map<string, TurnEntry>();
  #latest: string | null = null;

  constructor(options: TurnCaptureOptions) {
    this.#options = options;
  }

  get #width(): number {
    return this.#options.width ?? 640;
  }

  /**
   * A turn starts (the prompt): keep the URL state, capture the before picture and the before sheet, and save the
   * turn.
   */
  begin(session: string, turn: number, options: BeginOptions = {}): void {
    const old = this.#turns.get(session);
    if (old?.timer !== null && old?.timer !== undefined) clearTimeout(old.timer);
    const surface = (): Surface => this.#options.surface();
    const raw = (() => {
      try {
        return surface().state.url;
      } catch {
        return null;
      }
    })();
    const url = raw === null ? null : shownUrl(raw);
    const entry: TurnEntry = {
      session,
      turn,
      checkout: this.#options.checkout(),
      prompt: (options.prompt ?? "").trim(),
      started: new Date().toISOString(),
      numbered: (options.numbered ?? Promise.resolve()).catch(() => undefined),
      url,
      before: Promise.resolve(null),
      window: Promise.resolve(null),
      saving: Promise.resolve(),
      files: [],
      timer: null,
      running: null,
      again: false,
      last: null,
    };
    // The URL report of the frame comes at most every 250 ms. The bridge call gives the current URL state. Both calls
    // start at the same time, so the before picture is the frame of the prompt.
    const now = orNull(() => surface().url({ timeoutMs: 5_000 }));
    const picture = orNull(() => surface().capture(this.#width, { timeoutMs: 15_000 }));
    entry.before = (async () => {
      const reported = await now;
      if (reported !== null) entry.url = shownUrl(reported);
      return picture;
    })();
    this.#turns.set(session, entry);
    this.#latest = session;
    this.#saveBegin(entry);
  }

  /** Correct the number of the turn of a session (the turn store can give another number). */
  renumber(session: string, turn: number): void {
    const entry = this.#turns.get(session);
    if (entry !== undefined) entry.turn = turn;
  }

  /** An edit of Claude: add the file and capture the after picture after a quiet time. */
  edit(session: string, turn: number, file: string): void {
    let entry = this.#turns.get(session);
    if (entry === undefined) {
      this.begin(session, turn);
      entry = this.#turns.get(session);
      if (entry === undefined) return;
    }
    const checkout = this.#options.checkout();
    // A file of the checkout as a path from its root; a file outside it keeps its absolute path.
    const inside = isAbsolute(file) ? relative(checkout, file) : file;
    const path = inside.startsWith("..") ? file : inside;
    if (!entry.files.includes(path)) entry.files.push(path);
    this.#latest = session;
    const target = entry;
    if (target.timer !== null) clearTimeout(target.timer);
    target.timer = setTimeout(() => {
      target.timer = null;
      void this.#run(target);
    }, this.#options.settleMs ?? 250);
  }

  /**
   * The after capture of a session (default: the session of the last prompt or edit): wait for a capture that runs,
   * else capture now. Null without a turn.
   */
  async after(session?: string, width?: number): Promise<AfterResult | null> {
    const key = session ?? this.#latest;
    const entry = key === null ? undefined : this.#turns.get(key);
    if (entry === undefined) return null;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.running !== null) return entry.running;
    return this.#run(entry, width);
  }

  async #run(entry: TurnEntry, width?: number): Promise<AfterResult> {
    if (entry.running !== null) {
      entry.again = true;
      return entry.running;
    }
    entry.running = this.#capture(entry, width ?? this.#width);
    try {
      const result = await entry.running;
      entry.last = result;
      this.#saveAfter(entry, result);
      const { store } = this.#options;
      this.#options.emit({
        type: "agent.turn",
        session: result.session,
        turn: result.turn,
        files: [...result.files],
        url: result.url,
        // The IDs of the picture store. The page reads the bytes at `GET /pictures/<id>`.
        before: store.refOrNull(result.before),
        after: store.refOrNull(result.after),
        reloaded: result.reloaded,
      });
      return result;
    } finally {
      entry.running = null;
      if (entry.again) {
        entry.again = false;
        void this.#run(entry);
      }
    }
  }

  /** Wait for the update of the last lab file of the turn; give whether it applied and whether the page reloaded. */
  async #waitApplied(surface: Surface, files: readonly string[]): Promise<{ applied: boolean; reloaded: boolean }> {
    const checkout = this.#options.checkout();
    const roots = (this.#options.roots ?? watchRoots)(checkout);
    const lab = files.map((file) => resolve(checkout, file)).filter((file) => underRoots(file, roots));
    const last = lab.at(-1);
    if (last === undefined) return { applied: false, reloaded: false };
    try {
      const record = await surface.waitForHmr(last, this.#options.hmrTimeoutMs ?? 8_000);
      return { applied: true, reloaded: record.reloaded };
    } catch {
      return { applied: false, reloaded: false };
    }
  }

  async #capture(entry: TurnEntry, width: number): Promise<AfterResult> {
    const files = [...entry.files];
    const before = await entry.before;
    const base = { session: entry.session, turn: entry.turn, files, url: entry.url };
    let surface: Surface;
    try {
      surface = this.#options.surface();
    } catch (error) {
      return { ...base, before, after: null, reloaded: false, applied: false, error: errorText(error) };
    }
    const { applied, reloaded } = await this.#waitApplied(surface, files);
    try {
      if (entry.url !== null) await restoreUrlState(surface, entry.url, shownUrl(await surface.url()));
      await surface.call("frame", [], { timeoutMs: 30_000 });
      const after = await surface.capture(width, { timeoutMs: 20_000 });
      return { ...base, before, after, reloaded, applied, error: null };
    } catch (error) {
      return { ...base, before, after: null, reloaded, applied, error: errorText(error) };
    }
  }

  // The saved turn and its sheets.
  /** Run a step of the saved turn after the steps before it; a failed step does not stop the next one. */
  #queue(entry: TurnEntry, step: () => Promise<void>): void {
    entry.saving = entry.saving.then(step).catch(() => undefined);
  }

  /** Save the facts of a turn and give the saved turn to the pages. */
  #facts(entry: TurnEntry, result: AfterResult | null, window: TurnWindow | null): void {
    const store = this.#options.pictures;
    if (store === undefined) return;
    const saved = store.saveFacts(entry.checkout, {
      session: entry.session,
      turn: entry.turn,
      prompt: entry.prompt,
      started: entry.started,
      files: result?.files ?? [...entry.files],
      url: entry.url,
      reloaded: result?.reloaded ?? false,
      applied: result?.applied ?? false,
      error: result?.error ?? null,
      window,
    });
    this.#options.emit({ type: "agent.turnSaved", turn: saved });
  }

  /** Save one picture of a turn and give the saved turn to the pages. */
  #picture(entry: TurnEntry, name: Parameters<TurnPictureStore["savePicture"]>[3], picture: Capture | null): void {
    const store = this.#options.pictures;
    if (store === undefined || picture === null) return;
    const saved: SavedTurn | null = store.savePicture(entry.checkout, entry.session, entry.turn, name, picture);
    if (saved !== null) this.#options.emit({ type: "agent.turnSaved", turn: saved });
  }

  /** The turn start: the facts, the before picture, then the window and the before sheet from the shadow. */
  #saveBegin(entry: TurnEntry): void {
    const shadow = this.#options.shadow;
    let resolveWindow: (window: TurnWindow | null) => void = () => undefined;
    entry.window = new Promise((resolve) => (resolveWindow = resolve));
    this.#queue(entry, async () => {
      const before = await entry.before;
      await entry.numbered;
      this.#facts(entry, null, null);
      this.#picture(entry, "before", before);
    });
    this.#queue(entry, async () => {
      try {
        if (shadow === undefined) return;
        const port = shadow();
        const window = await turnWindow(port, entry.url);
        resolveWindow(window);
        this.#facts(entry, entry.last, window);
        this.#picture(entry, "beforeSheet", await turnSheet(port, window));
      } finally {
        resolveWindow(null);
      }
    });
  }

  /** An after capture: the facts and the after picture, then the after sheet of the same window. */
  #saveAfter(entry: TurnEntry, result: AfterResult): void {
    const shadow = this.#options.shadow;
    this.#queue(entry, async () => {
      const window = await entry.window;
      this.#facts(entry, result, window);
      this.#picture(entry, "after", result.after);
      if (shadow === undefined || window === null) return;
      this.#picture(entry, "afterSheet", await turnSheet(shadow(), window));
    });
  }

  /** Wait until the saved turn of a session has every step that started (the tests). */
  async saved(session: string): Promise<void> {
    await this.#turns.get(session)?.saving;
  }

  /** Forget the turns (a checkout change, the stop of the host). */
  clear(): void {
    for (const entry of this.#turns.values()) if (entry.timer !== null) clearTimeout(entry.timer);
    this.#turns.clear();
    this.#latest = null;
  }
}
