// SPDX-License-Identifier: Apache-2.0
/**
 * Precompressed copies of the build files. The static server of the editor tests (serve-static.ts) uses it.
 *
 * After the build, the plugin writes `<file>.br` (Brotli, quality 11) and `<file>.gz` (gzip, level 9) next to
 * each text file of the output folder. nginx sends a copy in place of the file when the browser accepts its
 * encoding: `gzip_static on;` (snippets/web-precompressed.conf) and `brotli_static on;` where the Brotli
 * module is installed (snippets/web-brotli-static.conf). Then nginx does no compression work for these files,
 * and the browser gets fewer bytes than with the nginx default (gzip level 1).
 *
 * Rules:
 * - Only text types get copies: scripts, style sheets, HTML, JSON, SVG, the manifest, WebAssembly and plain
 *   text. Images, fonts and audio have their own compression.
 * - A file below 1 KiB gets no copy. The gain is small, and nginx compresses the file itself.
 * - The pass keeps a copy only when it is smaller than the file.
 * - `config.json` at the root gets no copy: each environment replaces that file, so a copy can be stale.
 * - Source maps get no copy: a release folder does not keep them.
 * - The pass removes each old copy that has no current file, so a stale copy never stays in the folder.
 *
 * The service worker precache lists only the files themselves (`globPatterns` in vite.config.ts), so the copies
 * do not change it. The test server (serve-static.ts) sends the copies as nginx does
 * (`precompressedFile`).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Logger, Plugin } from "vite";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** A content encoding of a precompressed copy. */
export type Encoding = "br" | "gzip";

/** The file name suffix of each encoding: the names that gzip_static and brotli_static find. */
export const SUFFIX: Readonly<Record<Encoding, string>> = { br: ".br", gzip: ".gz" };

/** The extensions of the text files that get copies. */
export const PRECOMPRESS_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".webmanifest",
  ".wasm",
  // 3D room models: meshopt data compresses well with gzip or Brotli on top. KTX2 data does not.
  ".glb",
  ".txt",
  ".xml",
]);

/** The smallest file that gets copies (bytes). */
export const PRECOMPRESS_MIN_BYTES = 1024;

/** Paths below the output folder that never get copies: the environment replaces them. */
const NEVER: ReadonlySet<string> = new Set(["config.json"]);

/** Return true when the file at this path (relative to the output folder, with "/") gets copies. */
export function precompressible(path: string, bytes: number): boolean {
  return PRECOMPRESS_EXTENSIONS.has(extname(path)) && !NEVER.has(path) && bytes >= PRECOMPRESS_MIN_BYTES;
}

/** Return the Brotli and the gzip bytes of a file. */
export async function compress(data: Uint8Array): Promise<Record<Encoding, Uint8Array>> {
  const [br, gz] = await Promise.all([
    brotliAsync(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
      },
    }),
    gzipAsync(data, { level: 9 }),
  ]);
  return { br: new Uint8Array(br), gzip: new Uint8Array(gz) };
}

/** The result of one pass over an output folder. */
export interface PrecompressReport {
  /** The files that got at least one copy. */
  readonly files: number;
  /** The bytes of these files, and of their Brotli and gzip copies. */
  readonly rawBytes: number;
  readonly brBytes: number;
  readonly gzipBytes: number;
  /** The old copies that the pass removed. */
  readonly removed: number;
  readonly ms: number;
}

/** Every file below a folder, as paths relative to it with "/". */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split("\\").join("/"));
    }
  };
  walk(dir);
  return out;
}

/** Return the path of the file of a copy ("assets/a.js" for "assets/a.js.br"), or null for another file. */
export function copySource(path: string): string | null {
  for (const suffix of Object.values(SUFFIX)) {
    if (path.endsWith(suffix)) {
      const source = path.slice(0, -suffix.length);
      return PRECOMPRESS_EXTENSIONS.has(extname(source)) ? source : null;
    }
  }
  return null;
}

/** Write the copies of every text file below `dir`, and remove the old copies. */
export async function precompressDir(dir: string): Promise<PrecompressReport> {
  const started = performance.now();
  const root = resolve(dir);
  const all = listFiles(root);
  const copies = new Set(all.filter((path) => copySource(path) !== null));
  const sources = all.filter((path) => !copies.has(path));
  const written = new Set<string>();
  let files = 0;
  let rawBytes = 0;
  let brBytes = 0;
  let gzipBytes = 0;
  const queue = sources.filter((path) => precompressible(path, statSync(join(root, path)).size));
  const worker = async (): Promise<void> => {
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      const data = new Uint8Array(await readFile(join(root, path)));
      const encoded = await compress(data);
      let kept = false;
      for (const encoding of ["br", "gzip"] as const) {
        const bytes = encoded[encoding];
        if (bytes.byteLength >= data.byteLength) continue;
        const copy = `${path}${SUFFIX[encoding]}`;
        await writeFile(join(root, copy), bytes);
        written.add(copy);
        kept = true;
        if (encoding === "br") brBytes += bytes.byteLength;
        else gzipBytes += bytes.byteLength;
      }
      if (kept) {
        files += 1;
        rawBytes += data.byteLength;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism()) }, worker));
  // A copy that this pass did not write is from an earlier build, or its file gets no copy in this build.
  const stale = [...copies].filter((path) => !written.has(path));
  await Promise.all(stale.map((path) => rm(join(root, path), { force: true })));
  return { files, rawBytes, brBytes, gzipBytes, removed: stale.length, ms: Math.round(performance.now() - started) };
}

/**
 * The Vite plugin. It runs after the build has written every file, also after the service worker build of
 * vite-plugin-pwa (that `closeBundle` hook is sequential too, without an order), so `sw.js` gets copies.
 */
export function precompressPlugin(): Plugin {
  let outDir = "";
  let logger: Logger | null = null;
  return {
    name: "scenity-precompress",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      logger = config.logger;
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler(error?: Error) {
        if (error !== undefined || outDir === "" || !existsSync(outDir)) return;
        const report = await precompressDir(outDir);
        logger?.info(
          `precompress: ${String(report.files)} files, ${String(Math.round(report.rawBytes / 1024))} KiB → ` +
            `br ${String(Math.round(report.brBytes / 1024))} KiB, gzip ${String(Math.round(report.gzipBytes / 1024))} KiB ` +
            `(${String(report.ms)} ms)`,
        );
      },
    },
  };
}

/** The encodings that an Accept-Encoding header accepts. A weight of 0 refuses an encoding. */
export function acceptedEncodings(header: string | null): Set<Encoding> {
  const accepted = new Set<Encoding>();
  for (const part of (header ?? "").split(",")) {
    const [token = "", ...params] = part.split(";").map((value) => value.trim().toLowerCase());
    if (token !== "br" && token !== "gzip") continue;
    const weight = params.find((param) => param.startsWith("q="));
    if (weight !== undefined && !(Number(weight.slice(2)) > 0)) continue;
    accepted.add(token);
  }
  return accepted;
}

/**
 * The copy that nginx sends for a file: the first encoding of `encodings` that the browser accepts and that
 * has a copy next to the file. Null: send the file itself.
 */
export function precompressedFile(
  file: string,
  acceptEncoding: string | null,
  encodings: readonly Encoding[],
): { readonly path: string; readonly encoding: Encoding } | null {
  const accepted = acceptedEncodings(acceptEncoding);
  for (const encoding of encodings) {
    const path = `${file}${SUFFIX[encoding]}`;
    if (accepted.has(encoding) && existsSync(path) && statSync(path).isFile()) {
      return { path, encoding };
    }
  }
  return null;
}
