// SPDX-License-Identifier: Apache-2.0
/**
 * The page server of `scenity bench` and `scenity shot`. It serves a `scenity build` folder: the player entries, the
 * project document of the build and the asset build. The scene and sequence documents come from the project folder in
 * canonical form, so a run uses the current documents with no new build, and a scene that the project does not list
 * (for example a stress scene) also plays. The page is one `<scenity-player>` with the options of the run; it is not a
 * file of the build.
 *
 * The server counts the bytes of the asset files that it serves: the `bytes` value of a scene budget.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtinRegistry, readDocument } from "@scenity/scene";
import { writeDocument } from "@scenity/scene/canonical";
import { isInside } from "../vite/resolve";
import { BUILD_ASSETS } from "../build/documents";

/** The path of the player page on the server. */
export const PLAYER_PAGE = "/__scenity-player.html";

/** The player options of a page. */
export interface PlayerPageOptions {
  readonly scene: string;
  readonly sequence: string | null;
  readonly backend: string;
  readonly tier: string;
  /** A named camera of the scene. Default: the camera of the scene. */
  readonly camera?: string;
  /** True: the render worker; false: the main-thread core. Default: the choice of the player. */
  readonly worker?: boolean;
  /** True (default): the clock runs and loops. False: the clock stands at the start, for one fixed frame. */
  readonly play?: boolean;
  /** The time of the clock at the first frame (ms). Default 0. */
  readonly start?: number;
}

export interface PageServer {
  readonly origin: string;
  /** The asset bytes since the last reset. */
  assetBytes(): number;
  resetBytes(): void;
  stop(): void;
}

function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The player page: the player with no adaptive quality ladder (the tier stays), no poster and no sound. The inline
 * script keeps the time of the `ready` event (the first frame with every asset) and the first error in
 * `globalThis.__scenityPage`.
 */
export function playerPageHtml(options: PlayerPageOptions): string {
  const attrs = [
    `src="project/scenity.project.json"`,
    `scene="${html(options.scene)}"`,
    `sequence="${html(options.sequence ?? "none")}"`,
    `backend="${html(options.backend)}"`,
    `tier="${html(options.tier)}"`,
    ...(options.camera === undefined ? [] : [`camera="${html(options.camera)}"`]),
    ...(options.worker === undefined ? [] : [`worker="${String(options.worker)}"`]),
    ...(options.start === undefined ? [] : [`start="${String(options.start)}"`]),
    `adaptive="false" poster="none"${options.play === false ? "" : " autoplay loop"} muted`,
  ];
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    "    <title>scenity player</title>",
    "    <style>",
    "      html, body { margin: 0; height: 100%; background: #000000; overflow: hidden; }",
    "      scenity-player { width: 100vw; height: 100vh; aspect-ratio: auto; }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <scenity-player ${attrs.join(" ")}></scenity-player>`,
    "    <script>",
    "      globalThis.__scenityPage = { ready: null, error: null };",
    '      const player = document.querySelector("scenity-player");',
    '      player.addEventListener("ready", () => { globalThis.__scenityPage.ready = performance.now(); });',
    '      player.addEventListener("error", (event) => {',
    '        globalThis.__scenityPage.error ??= String(event.detail?.reason ?? "error");',
    "      });",
    "    </script>",
    '    <script type="module" src="player/element.js"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/** The script that is true when the page has its first frame or an error. */
export const PAGE_SETTLED =
  "globalThis.__scenityPage && (globalThis.__scenityPage.ready !== null || globalThis.__scenityPage.error !== null)";
/** The script that gives the state of the page: `{ ready, error }`. */
export const PAGE_STATE = "globalThis.__scenityPage";

/** The canonical text of a scene or sequence file of the project, or null when the path is not one. */
export function sourceDocument(dir: string, rel: string): { text: string } | { error: string } | null {
  const kind = rel.endsWith(".scene.json") ? "scene" : rel.endsWith(".sequence.json") ? "sequence" : null;
  const file = resolve(dir, ...rel.split("/"));
  if (kind === null || !isInside(file, dir) || !existsSync(file)) return null;
  const read = readDocument(readFileSync(file, "utf8"), kind, { registry: builtinRegistry() });
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { error: `${rel} does not read: ${first.join("; ")}` };
  }
  return { text: writeDocument(read.doc) };
}

/** Serve a build folder `out` of the project folder `dir` on a free port of the loopback. */
export function servePlayerPage(out: string, dir: string, page: PlayerPageOptions): PageServer {
  let bytes = 0;
  const assets = `/project/${BUILD_ASSETS}/`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const headers = { "Cache-Control": "no-store" };
      if (path === "/" || path === PLAYER_PAGE) {
        return new Response(playerPageHtml(page), { headers: { ...headers, "Content-Type": "text/html" } });
      }
      if (path.startsWith("/project/")) {
        const own = sourceDocument(dir, path.slice("/project/".length));
        if (own !== null && "error" in own) return new Response(own.error, { status: 500, headers });
        if (own !== null)
          return new Response(own.text, { headers: { ...headers, "Content-Type": "application/json" } });
      }
      const file = join(out, ...path.split("/"));
      if (!isInside(file, out) || !existsSync(file) || !statSync(file).isFile()) {
        return new Response("not found", { status: 404, headers });
      }
      if (path.startsWith(assets)) bytes += statSync(file).size;
      return new Response(Bun.file(file), { headers });
    },
  });
  return {
    origin: `http://127.0.0.1:${String(server.port)}`,
    assetBytes: () => bytes,
    resetBytes: () => {
      bytes = 0;
    },
    stop: () => {
      void server.stop(true);
    },
  };
}
