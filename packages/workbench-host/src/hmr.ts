// SPDX-License-Identifier: Apache-2.0
/**
 * The HMR record of a surface: the host knows when the dev server applied an edit. The page sends the bridge events
 * `hmr`, `reload` and `ready` of the frame to the host. The file watcher (edits.ts) gives the time of each edit.
 * `wait(file)` resolves when the frame applied the edit of the file.
 *
 * The dev server can miss an edit (for example an edit of `patch`). Then the frame keeps the old module until a
 * `touch`. On macOS, both watchers see an in-place write and a rename-replace (a temporary file renamed over the
 * file: `sed -i`, `os.replace`, many editors). But a rename keeps the modification time of the temporary file. Thus
 * the edit time is the later of the modification time and the status change time (the rename sets it). A wait that
 * gets no update after `nudgeMs` touches the file once, so the dev server sees it again.
 */
import { statSync, utimesSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** An update that the frame applied: the files of an `hmr` event, or a page load (`reloaded`). */
export interface HmrRecord {
  /** The absolute paths of the updated files. Empty for a page load. */
  readonly files: readonly string[];
  /** The time of the update (ms since the epoch). For a page load: the time of the `reload` event, else of `ready`. */
  readonly at: number;
  readonly reloaded: boolean;
}

/** What `wait` waits for: the edit of a file (an absolute path, or a path relative to the checkout), or a time. */
export type HmrTarget = string | { readonly since: number };

export interface HmrTrackerOptions {
  /** The checkout: the base of a relative target path. */
  readonly checkout: string;
  /** The folder of the Vite root (apps/editor): the base of a Vite URL path such as `/src/core/x.ts`. */
  readonly appRoot: string;
  /** The time of the last edit of a file (an absolute path) that the file watcher saw, or null. */
  readonly lastEdit: (file: string) => number | null;
  /**
   * The modification time of a file (ms since the epoch), or null when the file does not exist. The default
   * reads the file system (`fileTime`). It is the time of the write itself, so it comes before the hmr event of Vite
   * and before the event of the file watcher, in either order.
   */
  readonly modified?: (file: string) => number | null;
  readonly now?: () => number;
  /** Make the dev server see a file again (default `touchFile`); a test gives a fake. */
  readonly nudge?: (file: string) => void;
  /** The time without an update before the nudge of a file (ms; default 1500; 0: no nudge). */
  readonly nudgeMs?: number;
}

/**
 * The edit time of a file (ms since the epoch, rounded down): the later of the modification time and the status
 * change time, or null when the file does not exist. A rename-replace keeps the modification time of the temporary
 * file, but the rename sets the status change time.
 */
export function fileTime(file: string): number | null {
  try {
    const stat = statSync(file);
    return Math.floor(Math.max(stat.mtimeMs, stat.ctimeMs));
  } catch {
    return null;
  }
}

/** Set the access and modification times of a file to the current time (`touch`). A missing file stays missing. */
export function touchFile(file: string): void {
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {
    // The file is gone: the dev server sees the removal by itself.
  }
}

/**
 * The absolute path of a file that an `hmr` event names. The event can give a Vite URL path (`/src/x.ts`,
 * `/@fs/<abs path>`, with or without `?t=…`), a path relative to the Vite root, or an absolute path.
 */
export function hmrFilePath(name: string, appRoot: string, checkout: string): string {
  const path = name.replace(/[?#].*$/, "");
  if (path.startsWith("/@fs/")) return path.slice("/@fs".length);
  if (path.startsWith(checkout) || path.startsWith(appRoot)) return path;
  if (path.startsWith("/")) return join(appRoot, path);
  return resolve(appRoot, path);
}

interface Waiter {
  readonly match: (record: HmrRecord) => boolean;
  readonly resolve: (record: HmrRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const HISTORY = 50;

/** The HMR record of one surface frame. */
export class HmrTracker {
  readonly #options: HmrTrackerOptions;
  readonly #now: () => number;
  readonly #history: HmrRecord[] = [];
  readonly #waiters = new Set<Waiter>();
  #reloadAt: number | null = null;

  constructor(options: HmrTrackerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** The last update, or null. */
  get last(): HmrRecord | null {
    return this.#history.at(-1) ?? null;
  }

  /** The `hmr` event of the frame: Vite replaced the given modules. */
  hmr(files: readonly string[]): HmrRecord {
    const { appRoot, checkout } = this.#options;
    return this.#add({
      files: files.map((name) => hmrFilePath(name, appRoot, checkout)),
      at: this.#now(),
      reloaded: false,
    });
  }

  /** The `reload` event of the frame: the page starts a full reload. The `ready` event of the new page follows. */
  reload(): void {
    this.#reloadAt = this.#now();
  }

  /** The `ready` event of the frame: a page loaded. A page that loaded after an edit shows the edit. */
  ready(): HmrRecord {
    const at = this.#reloadAt ?? this.#now();
    this.#reloadAt = null;
    return this.#add({ files: [], at, reloaded: true });
  }

  #add(record: HmrRecord): HmrRecord {
    this.#history.push(record);
    if (this.#history.length > HISTORY) this.#history.shift();
    for (const waiter of this.#waiters) {
      if (!waiter.match(record)) continue;
      this.#waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
    return record;
  }

  /**
   * The edit time of a file: its modification time, else the time that the file watcher saw. The modification time
   * comes first because Vite can report the update before the watcher sees the edit.
   */
  #editTime(file: string): number | null {
    return (this.#options.modified ?? fileTime)(file) ?? this.#options.lastEdit(file);
  }

  /**
   * The test of a record for a target. For a file: an `hmr` event that names the file, or any update after the edit
   * time (Vite can name the module that accepted the update, not the file). The past records count too, so an update
   * that came before the call resolves it. Without a known edit time, only an update after the call that names the
   * file, or a page load after the call, matches.
   */
  #matcher(target: HmrTarget): (record: HmrRecord) => boolean {
    const called = this.#now();
    if (typeof target !== "string") return (record) => record.at >= target.since;
    const file = this.#absolute(target);
    const editAt = this.#editTime(file);
    if (editAt !== null) return (record) => record.at >= editAt;
    return (record) => record.at >= called && (record.reloaded || record.files.includes(file));
  }

  /**
   * Wait until the frame applied the edit of a file, or an update after a time. Reject after the timeout. A
   * file without an update after `nudgeMs` gets one touch, so a dev server that missed the edit sees it again.
   */
  wait(target: HmrTarget, timeoutMs: number): Promise<HmrRecord> {
    const match = this.#matcher(target);
    const done = this.#history.findLast(match);
    if (done !== undefined) return Promise.resolve(done);
    return new Promise((resolve, reject) => {
      const nudgeMs = this.#options.nudgeMs ?? 1_500;
      const file = typeof target === "string" ? this.#absolute(target) : null;
      const nudge =
        file === null || nudgeMs <= 0 || nudgeMs >= timeoutMs
          ? null
          : setTimeout(() => {
              // A page that reloads at this time shows the edit after its `ready`. A touch would reload it again.
              if (this.#reloadAt === null) (this.#options.nudge ?? touchFile)(file);
            }, nudgeMs);
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        if (nudge !== null) clearTimeout(nudge);
        const what = typeof target === "string" ? target : `the time ${String(target.since)}`;
        reject(new Error(`The surface applied no update for ${what} in ${String(timeoutMs)} ms.`));
      }, timeoutMs);
      const waiter: Waiter = {
        match,
        resolve: (record) => {
          if (nudge !== null) clearTimeout(nudge);
          resolve(record);
        },
        reject: (error) => {
          if (nudge !== null) clearTimeout(nudge);
          reject(error);
        },
        timer,
      };
      this.#waiters.add(waiter);
    });
  }

  #absolute(target: string): string {
    return isAbsolute(target) ? target : resolve(this.#options.checkout, target);
  }

  /** Reject every wait (the surface closed or moved to another checkout). */
  cancel(reason: string): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.#waiters.clear();
  }
}
