// SPDX-License-Identifier: Apache-2.0
/**
 * The file watcher of the asset database: one recursive `fs.watch` on the project folder. The watcher
 * collects the changed paths, waits for a quiet time and then gives the paths to the database in one update.
 */
import { watch } from "node:fs";
import { isSkippedFolder, toPosix } from "./files";
import type { AssetChange } from "./types";

export interface WatchOptions {
  /** The quiet time in milliseconds after the last event before an update (default 100). */
  readonly debounceMs?: number;
  /** The callback for an error of an update. The default writes the error to the console. */
  readonly onError?: (error: unknown) => void;
}

export interface AssetWatcher {
  /** Stop the watcher. An update that runs at that time completes, but its callback does not run. */
  close(): void;
}

/** True when an event path is in a folder that the scan does not enter. */
export function isIgnoredPath(path: string): boolean {
  const parts = path.split("/");
  return parts.slice(0, -1).some(isSkippedFolder) || parts.at(-1)?.startsWith(".") === true;
}

/** Watch a project folder and call `update` with the changed project paths after each quiet time. */
export function watchProject(
  dir: string,
  update: (paths: readonly string[]) => Promise<AssetChange>,
  onChange: (ids: readonly string[], documents: readonly string[]) => void,
  options: WatchOptions = {},
): AssetWatcher {
  const debounceMs = options.debounceMs ?? 100;
  const onError = options.onError ?? ((error: unknown) => console.error("asset watcher:", error));
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let queue = Promise.resolve();
  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    queue = queue.then(async () => {
      try {
        const change = await update(paths);
        if (!closed && (change.ids.length > 0 || change.documents.length > 0)) onChange(change.ids, change.documents);
      } catch (error) {
        onError(error);
      }
    });
  };
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (closed || filename === null) return;
    const path = toPosix(filename);
    if (isIgnoredPath(path)) return;
    pending.add(path);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
    },
  };
}
