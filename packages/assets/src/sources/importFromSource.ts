// SPDX-License-Identifier: Apache-2.0
/**
 * The import of an item of an asset source: the files of the item go into
 * `assets/sources/<provider>/<item>/`, the rights record of the provider (`rights/<provider>.yaml`) is written when
 * the project does not have it, and the main file imports with that record (`importProjectFile`).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { importProjectFile, type ProjectImportResult } from "../projectImport";
import { writeRightsRecord } from "../rights/write";
import type { AssetProvider, Fetcher, SourceKind } from "./provider";

/** The largest file of a download (bytes). */
const FILE_LIMIT = 256 * 1024 * 1024;

export interface SourceImportOptions {
  readonly resolution?: string;
  readonly fetch?: Fetcher;
  /** The date of a new rights record (default: today). */
  readonly today?: string;
}

/** A relative path in the folder of an item: no "..", no absolute path. */
function safePath(path: string): string | null {
  const clean = posix.normalize(path.replaceAll("\\", "/"));
  return clean.startsWith("/") || clean.startsWith("..") || clean === "." ? null : clean;
}

async function download(fetcher: Fetcher, url: string): Promise<Uint8Array> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${url}: ${String(response.status)} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > FILE_LIMIT) throw new Error(`${url}: the file is larger than 256 MB`);
  return bytes;
}

/** Import an item of a provider into the project folder `dir`. */
export async function importFromSource(
  dir: string,
  provider: AssetProvider,
  id: string,
  kind: SourceKind,
  options: SourceImportOptions = {},
): Promise<ProjectImportResult> {
  const fetcher = options.fetch ?? ((url) => fetch(url));
  const files = await provider.files(id, kind, options.resolution);
  const [main, ...parts] = files;
  if (main === undefined) return { ok: false, reason: `${provider.name} gives no file for ${id}` };
  const folder = `assets/sources/${provider.id}/${id.replaceAll(/[^\w.-]/g, "_")}`;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const rights = `rights/${provider.id}.yaml`;
  if (!existsSync(join(dir, rights))) {
    const written = writeRightsRecord(dir, { ...provider.rights, licenceDate: today });
    if (!written.ok) return { ok: false, reason: written.reason };
  }
  for (const part of parts) {
    const path = safePath(part.path);
    if (path === null) return { ok: false, reason: `${part.path} is not a path in the folder of the item` };
    const target = join(dir, folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await download(fetcher, part.url));
  }
  const mainPath = safePath(main.path);
  if (mainPath === null) return { ok: false, reason: `${main.path} is not a path in the folder of the item` };
  const sub = posix.dirname(mainPath);
  return importProjectFile(dir, posix.basename(mainPath), await download(fetcher, main.url), {
    folder: sub === "." ? folder : `${folder}/${sub}`,
    rights,
    tags: [provider.id, kind],
    today,
  });
}
