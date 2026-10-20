// SPDX-License-Identifier: Apache-2.0
/**
 * The player-page target of the scene pool: the page spec of `scenity shot`, `sheet` and `clip` and how a warm page of
 * the generic warm pages (`@scenity/labs-platform/warmPages`) loads it.
 *
 * A spec is a `scenity build` folder, its project folder, the player options of the page (page/serve.ts, without the
 * start time: a tool seeks each time) and the page size. The key is the spec. The version is a content stamp of the
 * inputs of the page: the player files and the manifest of the build (size and time) and the texts of the project,
 * scene and sequence documents that the page server reads from the project folder. So an edit of a document or a new
 * build loads the page again, and a picture of a warm page equals a picture of a new page.
 *
 * Each spec gets its own player page server (page/serve.ts) for the life of the pool.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { stableJson } from "@scenity/labs-platform/frameKey";
import type { PageTarget } from "@scenity/labs-platform/warmPages";
import { openPlayer } from "../page/player";
import { PLAYER_PAGE, servePlayerPage, type PageServer, type PlayerPageOptions } from "../page/serve";

/** The page of a lease: a build, its project, the player options and the page size. */
export interface PlayerSpec {
  /** The `scenity build` folder (absolute). */
  readonly out: string;
  /** The project folder (absolute). */
  readonly dir: string;
  readonly page: Omit<PlayerPageOptions, "start" | "play">;
  readonly width: number;
  readonly height: number;
}

/** The files of a build whose size and time go into the version. */
const BUILD_FILES = [
  "player/element.js",
  "player/index.js",
  "project/scenity.project.json",
  "project/build/manifest.json",
];

function fileStamp(path: string): string {
  if (!existsSync(path)) return "-";
  const stat = statSync(path);
  return `${String(stat.size)}:${String(stat.mtimeMs)}`;
}

function textOf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "-";
}

/** The content stamp of the inputs of a spec. */
export function specVersion(spec: PlayerSpec): string {
  const hash = createHash("sha256");
  for (const file of BUILD_FILES) hash.update(`${file}=${fileStamp(join(spec.out, ...file.split("/")))}\n`);
  const documents = ["scenity.project.json", spec.page.scene, spec.page.sequence ?? ""].filter((path) => path !== "");
  for (const path of documents) hash.update(`${path}=${textOf(join(spec.dir, ...path.split("/")))}\n`);
  return hash.digest("hex").slice(0, 32);
}

/** The key of a spec. */
export function specKey(spec: PlayerSpec): string {
  return stableJson(spec);
}

/** The player-page target and its page servers (one per spec key). */
export function playerTarget(): PageTarget<PlayerSpec, Page, null> & { stop(): void } {
  const servers = new Map<string, PageServer>();
  const serverOf = (spec: PlayerSpec): PageServer => {
    const key = specKey(spec);
    let server = servers.get(key);
    if (server === undefined) {
      server = servePlayerPage(spec.out, spec.dir, { ...spec.page, play: false });
      servers.set(key, server);
    }
    return server;
  };
  return {
    key: specKey,
    version: (spec) => Promise.resolve(specVersion(spec)),
    contextOptions: (spec) => ({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 }),
    sameContext: (had, spec) => had.width === spec.width && had.height === spec.height,
    load: (page, spec) => openPlayer(page, serverOf(spec).origin + PLAYER_PAGE),
    restHint: null,
    stop: () => {
      for (const server of servers.values()) server.stop();
      servers.clear();
    },
  };
}

/** Check the JSON of a spec from a request. Throw with the reason. */
export function readSpec(value: unknown): PlayerSpec {
  const spec = value as Partial<PlayerSpec> | null;
  const page = spec?.page as Partial<PlayerSpec["page"]> | undefined;
  const absolute = (path: unknown) => typeof path === "string" && path.startsWith("/");
  if (!absolute(spec?.out) || !absolute(spec?.dir)) throw new Error("A spec needs the absolute `out` and `dir`.");
  if (typeof page?.scene !== "string" || typeof page.backend !== "string" || typeof page.tier !== "string") {
    throw new Error("A spec needs `page` with `scene`, `backend` and `tier`.");
  }
  const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 16 && n <= 8192;
  if (!size(spec?.width) || !size(spec?.height)) throw new Error("A spec needs a `width` and a `height` in px.");
  return spec as PlayerSpec;
}
