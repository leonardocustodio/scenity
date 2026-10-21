// SPDX-License-Identifier: Apache-2.0
/**
 * The static server of the gallery tests (playwright.gallery.config.ts). Bun.serve gives the files of the gallery build, a 404 for a missing asset and index.html
 * for each other path (the routes of the app, for example /dev/gallery), as `vite preview` does. It adds no security
 * headers, as `vite preview`.
 *
 * The gallery does not use `vite preview`. Under Bun, `vite preview` stopped with "write after end"
 * (ERR_STREAM_WRITE_AFTER_END in the node:http layer of Bun) when the browser closed a page during a request. The
 * gallery tests close hundreds of pages, so that server stopped in the middle of a run, on macOS and in the Linux
 * container.
 *
 *     bun scripts/static/gallery-server.ts --root dist/gallery --port 4180
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: "dist/gallery" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "0" },
    // The page of the root path (the scene page build has scene.html).
    index: { type: "string", default: "index.html" },
  },
});

const root = resolve(values.root);
const index = join(root, values.index);
if (!existsSync(index)) {
  throw new Error(`gallery-server: ${index} does not exist; build the gallery first`);
}

/** The file of a URL path inside the root, or null. */
function fileOf(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = normalize(join(root, decoded));
  if (!candidate.startsWith(root + sep)) return null;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

const server = Bun.serve({
  hostname: values.host,
  port: Number(values.port),
  fetch(request) {
    const path = new URL(request.url).pathname;
    const file = path === "/" ? null : fileOf(path);
    if (file !== null) {
      return new Response(Bun.file(file), { headers: { "Cache-Control": "no-cache" } });
    }
    // A missing build asset is a 404, not the page (as serve-static.ts and nginx).
    if (path.startsWith("/assets/") || path.startsWith("/icons/")) {
      return new Response("not found", { status: 404 });
    }
    return new Response(Bun.file(index), { headers: { "Cache-Control": "no-cache" } });
  },
});

console.log(`gallery-server: ${server.url.href} serves ${root}`);
