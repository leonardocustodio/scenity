// SPDX-License-Identifier: Apache-2.0
/**
 * The file watcher of a checkout: the fallback that tells the host when a source file of the lab or of the runtime
 * changed. It watches `apps/editor/src`, the `src` folder of each engine package that draws a frame (ENGINE_SOURCES)
 * and of each plugin part `plugins/<plugin>/<part>` with `fs.watch`. It records the last edit time of each file
 * immediately. A listener gets each file once per burst of changes (a debounce).
 */
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { LAB_APP } from "./servers";

/** The sorted names in a folder, or none when the folder does not exist. */
function namesIn(folder: string): string[] {
  return existsSync(folder) ? readdirSync(folder).sort() : [];
}

/**
 * The engine packages whose source draws a frame of the lab (the generic code of the room and the scene view).
 */
const ENGINE_SOURCES: ReadonlySet<string> = new Set(["render", "runtime", "character", "scene", "view-vue"]);

/**
 * The folders that the watcher watches in a checkout: the lab source, the source of each engine package of
 * ENGINE_SOURCES, and the source of each plugin part `plugins/<plugin>/<part>`.
 */
export function watchRoots(checkout: string): string[] {
  const packages = join(checkout, "packages");
  const runtime = namesIn(packages)
    .filter((name) => ENGINE_SOURCES.has(name))
    .map((name) => join(packages, name, "src"));
  const plugins = join(checkout, "plugins");
  const parts = namesIn(plugins).flatMap((plugin) =>
    namesIn(join(plugins, plugin)).map((part) => join(plugins, plugin, part, "src")),
  );
  return [join(checkout, LAB_APP, "src"), ...runtime, ...parts].filter((root) => existsSync(root));
}

export interface EditWatcherOptions {
  /** The time that a file must stay unchanged before the listeners get it. */
  readonly debounceMs?: number;
  readonly now?: () => number;
}

/** A file change: the absolute path and the time of its last change (ms since the epoch). */
export interface Edit {
  readonly file: string;
  readonly at: number;
}

function ignored(name: string): boolean {
  return name.split(/[\\/]/).some((part) => part === "node_modules" || part.startsWith("."));
}

/** True for a folder. A path that does not exist (a removed file) is not a folder. */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The watcher of the source folders of a checkout. */
export class EditWatcher {
  readonly roots: readonly string[];
  readonly #debounceMs: number;
  readonly #now: () => number;
  readonly #edits = new Map<string, number>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #listeners = new Set<(edit: Edit) => void>();
  readonly #watchers: FSWatcher[] = [];
  #latest: Edit | null = null;

  constructor(roots: readonly string[], options: EditWatcherOptions = {}) {
    this.roots = roots;
    this.#debounceMs = options.debounceMs ?? 100;
    this.#now = options.now ?? Date.now;
  }

  /** Start to watch each root. A root that cannot be watched is left out. */
  start(): void {
    if (this.#watchers.length > 0) return;
    for (const root of this.roots) {
      try {
        const watcher = watch(root, { recursive: true }, (_event, name) => {
          if (typeof name !== "string" || name === "" || ignored(name)) return;
          const file = join(root, name);
          if (!isFolder(file)) this.record(file);
        });
        watcher.on("error", () => watcher.close());
        this.#watchers.push(watcher);
      } catch {
        // The root is absent or the system cannot watch it.
      }
    }
  }

  stop(): void {
    for (const watcher of this.#watchers.splice(0)) watcher.close();
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  /** Record a change of a file. The watcher calls it. A test or a hook can also call it. */
  record(file: string, at: number = this.#now()): void {
    this.#edits.set(file, at);
    this.#latest = { file, at };
    const old = this.#timers.get(file);
    if (old !== undefined) clearTimeout(old);
    const timer = setTimeout(() => {
      this.#timers.delete(file);
      const edit = { file, at: this.#edits.get(file) ?? at };
      for (const listener of this.#listeners) listener(edit);
    }, this.#debounceMs);
    this.#timers.set(file, timer);
  }

  /** The time of the last change of a file (an absolute path), or null. */
  lastEdit(file: string): number | null {
    return this.#edits.get(file) ?? null;
  }

  /** The last change of any file, or null. */
  latest(): Edit | null {
    return this.#latest;
  }

  /** Call the listener once per burst of changes of a file. Give the function that removes it. */
  onEdit(listener: (edit: Edit) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
