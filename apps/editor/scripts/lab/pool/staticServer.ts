// SPDX-License-Identifier: Apache-2.0
/**
 * The static server of the built lab on 127.0.0.1 and a free port. It serves the current build of `BuiltLab` with the
 * headers of the lab, behind the page key gate (`@scenity/labs-platform/labKey` `pageKeyGate`). A page request needs
 * the per-process secret of the server (the header or the `labsKey` URL parameter). The modules and the assets stay
 * open on the loopback, as on the dev server. The paths under `/__pool/` go to the HTTP API of the render pool, which
 * has its own token.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { pageKeyGate } from "@scenity/labs-platform/labKey";
import { POOL_PREFIX } from "./paths";

/** The content types of the files of a build. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ktx2": "image/ktx2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The headers of every answer: no type sniffing, no referrer. The lab needs no isolation header. */
const BASE_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } as const;

/** The API of the pool: true when it answered the request. */
export type ApiHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;

export interface StaticServerOptions {
  /** The folder of the current build, or null before the first build. */
  readonly root: () => string | null;
  /** The per-process secret of the server (`SCENITY_LABS_PAGE_SECRET`), or null. */
  readonly key: string | null;
  readonly port?: number;
  readonly api?: ApiHandler;
  /** The gate of the lab page. The default is `pageKeyGate` with the key. */
  readonly gate?: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
}

export interface BuiltLabServer {
  readonly origin: string;
  readonly server: Server;
  stop(): Promise<void>;
}

/** The file of a path in a build, or null (no path outside the build). */
export function fileOf(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = normalize(join(root, decoded));
  if (!path.startsWith(`${root}/`) && path !== root) return null;
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

/**
 * The Cache-Control of a path: the hashed files under `/assets/` never change. The server checks the other files each
 * time.
 */
export function cacheOf(pathname: string): string {
  return pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string, pathname: string): void {
  const size = statSync(file).size;
  response.writeHead(200, {
    ...BASE_HEADERS,
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": String(size),
    "cache-control": cacheOf(pathname),
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

/** Serve a file of the build: a file, or `index.html` for a path without a file name extension. */
function serveBuild(request: IncomingMessage, response: ServerResponse, url: URL, root: string | null): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "method not allowed");
    return;
  }
  if (root === null) {
    sendText(response, 503, "The built lab is building.");
    return;
  }
  const file = url.pathname === "/" ? null : fileOf(root, url.pathname);
  if (file !== null) {
    sendFile(request, response, file, url.pathname);
    return;
  }
  if (extname(url.pathname) !== "" || url.pathname.startsWith("/assets/")) {
    sendText(response, 404, "not found");
    return;
  }
  sendFile(request, response, join(root, "index.html"), "/index.html");
}

/** Start the server. The promise resolves when it listens. */
export function startBuiltLabServer(options: StaticServerOptions): Promise<BuiltLabServer> {
  const gate = options.gate ?? pageKeyGate(options.key);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const answer = async (): Promise<void> => {
      if (url.pathname.startsWith(POOL_PREFIX) && options.api !== undefined) {
        if (await options.api(request, response, url)) return;
        sendText(response, 404, "not found");
        return;
      }
      gate(request, response, () => {
        serveBuild(request, response, url, options.root());
      });
    };
    answer().catch((error: unknown) => {
      if (!response.headersSent) sendText(response, 500, error instanceof Error ? error.message : String(error));
      else response.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${String(port)}`,
        server,
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
