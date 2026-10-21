// SPDX-License-Identifier: Apache-2.0
/**
 * A small static server for the production build, for the end-to-end tests of the editor. It applies the security headers of the nginx snippet and the
 * Cache-Control rules of snippets/web-app.conf. It uses index.html as the fallback, as nginx does. It can proxy /v1
 * and /health to an engine that the caller starts, for example the mock engine of the test kit of a plugin. As in
 * web-app.conf, /sitemap.xml and each source map (`*.map`) are a 404. A missing /robots.txt or /release-notes.json is
 * a 404, not index.html. Playwright tests start one server per worker. The command line form serves a build by hand
 * (in apps/editor):
 *
 *     bun scripts/static/serve-static.ts --root dist --port 4174
 *
 * Test helpers (only with `e2e: true`): several builds by name with a switch (`POST /__e2e/root/<name>`),
 * and sinks for the telemetry paths that record what the browser sends (`GET /__e2e/telemetry`). Two servers
 * can share one engine (`engine`), for example the two cells of the cell move test. The proxy
 * sends `X-Forwarded-Host`, as nginx does, so the engine knows the cell of each request.
 * A WebSocket under /v1/ (the control channel of a room) goes to the mock engine too, with the subprotocols of the
 * client (the connection ticket): the lab test of the mock engine source opens one.
 *
 * The server sends the precompressed copies of the build (precompress.ts) as nginx does with
 * `brotli_static` and `gzip_static`: `<file>.br`, else `<file>.gz`, when the browser accepts the encoding.
 * It does not compress other files.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cacheControlFor, readNginxHeaders } from "./nginxHeaders";
import { precompressedFile, type Encoding } from "./precompress";

/** An engine behind the proxy: its origin. The caller starts it and stops it. */
export interface ProxyEngine {
  readonly url: string;
}

export interface StaticServerOptions {
  /** Build folders by name. The server serves the first one at start. */
  readonly roots: Readonly<Record<string, string>>;
  readonly host?: string;
  /** Zero selects a free port. */
  readonly port?: number;
  /** Proxy /v1 and /health to this engine. The caller closes it. */
  readonly engine?: ProxyEngine;
  /** Enable the /__e2e routes and the telemetry sinks. */
  readonly e2e?: boolean;
  /** The values of the nginx variables ($scenity_web_*). Default: none (plain HTTP). */
  readonly variables?: Readonly<Record<string, string>>;
  /** A JSON text that replaces /config.json of the build. */
  readonly config?: string;
  /** PEM texts of a server certificate and its key: serve HTTPS. */
  readonly tls?: { readonly cert: string; readonly key: string };
  /** The precompressed copies to send, in order. Default: Brotli, then gzip. An empty list sends none. */
  readonly precompressed?: readonly Encoding[];
}

export interface TelemetryRecord {
  readonly path: string;
  readonly contentType: string | null;
  readonly bytes: number;
}

export interface StaticServer {
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
  /** Serve another build (the update test). */
  setRoot(name: string): void;
  /** The engine behind the proxy, or null. */
  readonly engine: ProxyEngine | null;
  readonly telemetry: readonly TelemetryRecord[];
  stop(): Promise<void>;
}

/**
 * Same-origin telemetry paths of the test configuration, and the CSP report route that the nginx snippet names in
 * report-uri and Reporting-Endpoints.
 */
export const E2E_TELEMETRY_PATHS = [
  "/v1/telemetry/otlp",
  "/v1/telemetry/sentry",
  "/v1/telemetry/events",
  "/v1/telemetry/csp",
];

/**
 * Files at the root that are never the app document (snippets/web-app.conf): a missing file is a
 * 404, not index.html.
 */
const ROOT_FILES: readonly string[] = ["/robots.txt", "/release-notes.json"];

function withHeaders(response: Response, headers: readonly (readonly [string, string])[], cache: string): Response {
  for (const [name, value] of headers) {
    response.headers.append(name, value);
  }
  response.headers.set("Cache-Control", cache);
  return response;
}

/** A static file, or its precompressed copy when the request accepts the encoding of a copy. */
function fileResponse(request: Request, file: string, encodings: readonly Encoding[]): Response {
  const copy = precompressedFile(file, request.headers.get("accept-encoding"), encodings);
  if (copy === null) {
    return new Response(Bun.file(file));
  }
  // The type of the file itself, not of the copy.
  return new Response(Bun.file(copy.path), {
    headers: {
      "Content-Type": Bun.file(file).type,
      "Content-Encoding": copy.encoding,
      Vary: "Accept-Encoding",
    },
  });
}

function fileIn(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = normalize(join(root, decoded));
  if (!path.startsWith(root)) {
    return null;
  }
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

/** A WebSocket of a client and its socket to the engine (tunnel). */
interface Tunnel {
  readonly upstream: WebSocket;
  readonly queue: (string | ArrayBuffer)[];
  client: Bun.ServerWebSocket<Tunnel> | null;
}

export function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const names = Object.keys(options.roots);
  if (names.length === 0) {
    throw new Error("serve-static: give at least one root");
  }
  const roots = Object.fromEntries(Object.entries(options.roots).map(([name, path]) => [name, resolve(path)]));
  let current = names[0] ?? "";
  const headers = readNginxHeaders(options.variables ?? {});
  const telemetry: TelemetryRecord[] = [];
  const engine: ProxyEngine | null = options.engine ?? null;
  const encodings = options.precompressed ?? ["br", "gzip"];

  async function proxy(request: Request, url: URL): Promise<Response> {
    if (engine === null) {
      return new Response("no engine", { status: 502 });
    }
    const target = new URL(`${url.pathname}${url.search}`, engine.url);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }),
    });
    const out = new Headers(upstream.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
  }

  /**
   * A WebSocket of a client under /v1/: the server opens the same socket to the engine first, then upgrades the client
   * with the subprotocol that the engine chose. Messages of the engine before the upgrade wait in `queue`.
   */
  async function tunnel(request: Request, url: URL, bun: Bun.Server<Tunnel>): Promise<Response | undefined> {
    if (engine === null) {
      return new Response("no engine", { status: 502 });
    }
    const target = new URL(`${url.pathname}${url.search}`, engine.url);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const offered = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    const upstream = new WebSocket(target.href, offered);
    upstream.binaryType = "arraybuffer";
    const data: Tunnel = { upstream, queue: [], client: null };
    upstream.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (data.client === null) data.queue.push(event.data);
      else data.client.send(event.data);
    };
    upstream.onclose = (event: CloseEvent) => {
      // 1005 and 1006 are not codes that a close call can send.
      data.client?.close(event.code === 1005 || event.code === 1006 ? 1000 : event.code, event.reason);
    };
    const opened = await new Promise<boolean>((done) => {
      upstream.onopen = () => {
        done(true);
      };
      upstream.onerror = () => {
        done(false);
      };
    });
    if (!opened) {
      return new Response("the engine refused the socket", { status: 502 });
    }
    const chosen = upstream.protocol;
    if (!bun.upgrade(request, { data, headers: chosen === "" ? {} : { "Sec-WebSocket-Protocol": chosen } })) {
      upstream.close();
      return new Response("upgrade failed", { status: 400 });
    }
    return undefined;
  }

  const server = Bun.serve<Tunnel>({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 0,
    ...(options.tls === undefined ? {} : { tls: { cert: options.tls.cert, key: options.tls.key } }),
    async fetch(request, bun) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith("/v1/") && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return tunnel(request, url, bun);
      }
      if (options.e2e === true && path.startsWith("/__e2e/root/") && request.method === "POST") {
        const name = path.slice("/__e2e/root/".length);
        if (!(name in roots)) {
          return new Response("unknown root", { status: 404 });
        }
        current = name;
        return new Response(null, { status: 204 });
      }
      if (options.e2e === true && path === "/__e2e/telemetry") {
        return Response.json(telemetry);
      }
      if (options.e2e === true && E2E_TELEMETRY_PATHS.includes(path) && request.method === "POST") {
        const body = await request.arrayBuffer();
        telemetry.push({ path, contentType: request.headers.get("content-type"), bytes: body.byteLength });
        // The engine answers a CSP report with 204 and the forwarding routes with 202.
        return new Response(null, { status: path === "/v1/telemetry/csp" ? 204 : 202 });
      }
      if (path.startsWith("/v1/") || path.startsWith("/health/")) {
        return proxy(request, url);
      }
      if (path === "/config.json" && options.config !== undefined) {
        return withHeaders(
          new Response(options.config, { headers: { "Content-Type": "application/json" } }),
          headers,
          "no-cache",
        );
      }
      // nginx: the sitemap and each source map are a 404 with the security headers.
      if (path === "/sitemap.xml" || path.endsWith(".map")) {
        return withHeaders(new Response("not found", { status: 404 }), headers, "no-cache");
      }
      const root = roots[current] ?? "";
      const file = path === "/" ? null : fileIn(root, path);
      if (file !== null) {
        return withHeaders(fileResponse(request, file, encodings), headers, cacheControlFor(path));
      }
      if (path.startsWith("/assets/") || path.startsWith("/icons/") || ROOT_FILES.includes(path)) {
        return withHeaders(new Response("not found", { status: 404 }), headers, "no-cache");
      }
      // nginx: try_files $uri /index.html.
      return withHeaders(fileResponse(request, join(root, "index.html"), encodings), headers, "no-cache");
    },
    websocket: {
      open(client) {
        client.data.client = client;
        for (const message of client.data.queue.splice(0)) client.send(message);
      },
      message(client, message) {
        client.data.upstream.send(message);
      },
      close(client, code, reason) {
        client.data.upstream.close(code === 1005 || code === 1006 ? 1000 : code, reason);
      },
    },
  });

  // The server starts immediately. The result is a promise, so a caller can wait for it.
  return Promise.resolve({
    url: `${options.tls === undefined ? "http" : "https"}://${server.hostname ?? "127.0.0.1"}:${String(server.port)}`,
    headers,
    setRoot(name) {
      if (!(name in roots)) {
        throw new Error(`serve-static: unknown root ${name}`);
      }
      current = name;
    },
    telemetry,
    engine,
    async stop() {
      await server.stop(true);
    },
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: "dist" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4174" },
    },
  });
  const served = await startStaticServer({
    roots: { main: values.root },
    host: values.host,
    port: Number(values.port),
  });
  console.log(`Serving ${values.root} on ${served.url}.`);
  for (const [name, value] of served.headers) {
    console.log(`  ${name}: ${value}`);
  }
}
