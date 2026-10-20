// SPDX-License-Identifier: Apache-2.0
/**
 * The built lab: a production build of apps/editor for the surfaces that need no HMR (the shadow frame, the indexer
 * window, a second window, the background runs) and for the render pool. A build has about 40 modules in place of the
 * 957 of the dev server, so a page loads faster.
 *
 * The build goes to a cache folder outside the repository tree (`<state>/pool/lab/b<n>`). A watch of the sources starts
 * a new build after a quiet time (debounced). `ensure()` compares the file stamp of the sources with the stamp of the
 * current build and builds first when they differ, so a caller never gets a build of old sources. A failed build keeps
 * the last good build. The stamp is the size and the modification time of each source file. It is a file stamp,
 * because the content hash (labsContentHash.ts) covers only the frame inputs, and the built lab is the whole page.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { labPackageFolders, outsideWorkspaces } from "../../labsFs";
import { APP } from "../server";

/** The repo root (the Bun workspace). */
const WEB = join(APP, "..", "..");

/** One finished build. */
export interface BuildInfo {
  readonly id: number;
  readonly dir: string;
  readonly stamp: string;
  /** The time of the build (ms). */
  readonly ms: number;
  readonly at: string;
}

/** Make a build of apps/editor into a folder. A test gives a fake. */
export type LabBuilder = (outDir: string) => Promise<void>;

export interface BuiltLabOptions {
  /** The folder of the builds. */
  readonly cacheDir: string;
  /** The source folders and files (absolute). The default is `labSources()`. */
  readonly sources?: readonly string[];
  readonly build?: LabBuilder;
  /** The quiet time after a change of a source before a build (ms; default 300). */
  readonly debounceMs?: number;
  readonly log?: (line: string) => void;
}

/** Folder names that a stamp skips: outputs, tests and dependencies. */
const SKIP = new Set(["node_modules", "dist", "test-results", "tests", "scripts", "coverage"]);

/**
 * The generated contracts of each plugin (`plugins/<plugin>/sdk/contracts/generated/ts`, the alias of vite.config.ts).
 */
function pluginContracts(web: string): string[] {
  const plugins = join(web, "plugins");
  if (!existsSync(plugins)) return [];
  return readdirSync(plugins).map((name) => join(plugins, name, "sdk", "contracts", "generated", "ts"));
}

/** The review records of the art folders of a workspace (`art/<set>/reviews`). */
function reviewFolders(web: string): string[] {
  const art = join(web, "art");
  return existsSync(art) ? readdirSync(art).map((name) => join(art, name, "reviews")) : [];
}

/**
 * The sources of the lab build: apps/editor (its `src`, `index.html`, `vite.config.ts`), every workspace package and
 * plugin part that it depends on (also through other packages; labsFs.ts `labPackageFolders`), the clip review
 * records and the generated contracts. A project outside the checkout adds the packages and the review
 * records of its workspace.
 */
export function labSources(web = WEB): string[] {
  const workspaces = outsideWorkspaces(web);
  return [
    join(web, "apps", "editor", "src"),
    join(web, "apps", "editor", "index.html"),
    join(web, "apps", "editor", "vite.config.ts"),
    ...labPackageFolders(web, workspaces),
    ...[web, ...workspaces].flatMap(reviewFolders),
    ...pluginContracts(web),
  ].filter((path) => existsSync(path));
}

/** The file stamp of the sources: the path, the size and the modification time of each file. */
export function sourceStamp(sources: readonly string[]): string {
  const hash = createHash("sha256");
  const walk = (path: string): void => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    if (!stat.isDirectory()) {
      hash.update(`${relative(WEB, path)}\t${String(stat.size)}\t${String(stat.mtimeMs)}\n`);
      return;
    }
    for (const name of readdirSync(path).sort()) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      walk(join(path, name));
    }
  };
  for (const source of sources) walk(source);
  return hash.digest("hex").slice(0, 32);
}

/** The default builder: `vite build` of apps/editor (in Bun, as the dev server runs). */
export const viteBuild: LabBuilder = (outDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["x", "--bun", "vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
      { cwd: APP, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, SCENITY_LAB_TOOLS: "1" } },
    );
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString("utf8")).slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite build ended with code ${String(code)}: ${errors.split("\n")[0] ?? ""}`));
    });
  });

export class BuiltLab {
  readonly #options: BuiltLabOptions;
  readonly #sources: readonly string[];
  readonly #listeners = new Set<(build: BuildInfo) => void>();
  readonly #watchers: FSWatcher[] = [];
  #current: BuildInfo | null = null;
  #previous: BuildInfo | null = null;
  #running: Promise<BuildInfo> | null = null;
  #next = 1;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #error: string | null = null;
  /** The stamp of the sources of the last failed build, or null. */
  #failed: string | null = null;

  constructor(options: BuiltLabOptions) {
    this.#options = options;
    this.#sources = options.sources ?? labSources();
    mkdirSync(options.cacheDir, { recursive: true });
    // Remove the builds of an earlier process: the new process starts with an empty cache.
    for (const name of readdirSync(options.cacheDir)) rmSync(join(options.cacheDir, name), { recursive: true });
  }

  /** The current build, or null before the first one. */
  get current(): BuildInfo | null {
    return this.#current;
  }

  /** The error of the last build, or null after a good build. */
  get error(): string | null {
    return this.#error;
  }

  /** Call the listener after each new build. Give the function that removes it. */
  onBuild(listener: (build: BuildInfo) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The build of the current sources: the current build when its stamp is valid, else a new or running build. */
  async ensure(): Promise<BuildInfo> {
    for (;;) {
      if (this.#running !== null) await this.#running.catch(() => null);
      const stamp = sourceStamp(this.#sources);
      if (this.#current?.stamp === stamp) return this.#current;
      // The build of these sources failed: keep the last good build until the next change (no new build per call).
      if (this.#failed === stamp && this.#current !== null) return this.#current;
      if (this.#running === null) {
        const good = await this.#start(stamp).catch((error: unknown) => error);
        if (!(good instanceof Error)) return good as BuildInfo;
        // A failed build of these sources: the last good build, else the error.
        if (this.#current !== null) return this.#current;
        throw good;
      }
    }
  }

  #start(stamp: string): Promise<BuildInfo> {
    const id = this.#next;
    this.#next += 1;
    const dir = join(this.#options.cacheDir, `b${String(id)}`);
    const temporary = `${dir}.tmp`;
    const begun = performance.now();
    const run = (this.#options.build ?? viteBuild)(temporary).then(() => {
      renameSync(temporary, dir);
      const build: BuildInfo = {
        id,
        dir,
        stamp,
        ms: Math.round(performance.now() - begun),
        at: new Date().toISOString(),
      };
      // Keep the build before the current one: a page of it can still load its lazy modules.
      if (this.#previous !== null) rmSync(this.#previous.dir, { recursive: true, force: true });
      this.#previous = this.#current;
      this.#current = build;
      this.#error = null;
      this.#failed = null;
      this.#options.log?.(`build ${String(id)} in ${String(build.ms)} ms`);
      for (const listener of this.#listeners) listener(build);
      return build;
    });
    this.#running = run;
    run.then(
      () => (this.#running = null),
      (error: unknown) => {
        this.#running = null;
        rmSync(temporary, { recursive: true, force: true });
        this.#error = error instanceof Error ? error.message : String(error);
        this.#failed = stamp;
        this.#options.log?.(`build ${String(id)} failed: ${this.#error}`);
      },
    );
    return run;
  }

  /** Watch the sources: a change starts a build after the quiet time. */
  watch(): void {
    const changed = (): void => {
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.ensure().catch(() => null);
      }, this.#options.debounceMs ?? 300);
    };
    for (const source of this.#sources) {
      try {
        this.#watchers.push(watch(source, { recursive: true }, changed));
      } catch {
        // A source that a watch cannot follow: `ensure()` still compares the stamp before each use.
      }
    }
  }

  /** Stop the watch. The builds stay on the disk until the next start. */
  stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    for (const watcher of this.#watchers.splice(0)) watcher.close();
  }
}
