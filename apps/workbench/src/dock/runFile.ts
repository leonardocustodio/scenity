// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the runs as object URLs. The file route of the host needs the launch token in a header, so an
 * `<img src>` cannot load it. The page fetches the file and makes an object URL.
 */
import { getCurrentScope, onScopeDispose, reactive } from "vue";
import type { DockHost } from "./dockHost";

export interface RunFiles {
  /** The object URL of a file, or null while it loads (or when it failed). The first call starts the load. */
  url(run: string, path: string): string | null;
  /** The text of a file. */
  text(run: string, path: string): Promise<string>;
}

export function useRunFiles(host: DockHost): RunFiles {
  const urls = reactive(new Map<string, string | null>());
  const made: string[] = [];
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => made.forEach((url) => URL.revokeObjectURL(url)));
  }
  return {
    url(run, path) {
      const key = `${run}\n${path}`;
      if (!urls.has(key)) {
        urls.set(key, null);
        host.fetchRunFile(run, path).then(
          (blob) => {
            const url = URL.createObjectURL(blob);
            made.push(url);
            urls.set(key, url);
          },
          () => undefined,
        );
      }
      return urls.get(key) ?? null;
    },
    async text(run, path) {
      return (await host.fetchRunFile(run, path)).text();
    },
  };
}

/** The last part of a path. */
export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}
