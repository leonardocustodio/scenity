// SPDX-License-Identifier: Apache-2.0
/**
 * The Poly Haven provider of the asset sources: the HDRIs (environment maps), the models
 * (glTF with their buffers and textures) and the textures (the diffuse map) of polyhaven.com, all CC0. It reads the
 * public API (`/assets?t=<type>`, `/files/<id>`) and the previews of the CDN. The URLs of the API and of the CDN are
 * options, so a test gives a local server.
 */
import type { AssetProvider, Fetcher, SourceFile, SourceItem, SourceKind } from "./provider";
import { itemMatches, searchWords } from "./provider";

export const POLYHAVEN_API = "https://api.polyhaven.com";
export const POLYHAVEN_CDN = "https://cdn.polyhaven.com";
/** The resolution of a download when the call gives none. */
const DEFAULT_RESOLUTION = "1k";
/** The most items of a search. */
const MOST_ITEMS = 60;
/** Poly Haven asks each client of its API to name itself. */
const HEADERS = { "User-Agent": "Scenity asset sources (https://github.com/snowpine/scenity)" };

const TYPES: Readonly<Record<SourceKind, string>> = { environment: "hdris", model: "models", texture: "textures" };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface PolyHavenOptions {
  readonly api?: string;
  readonly cdn?: string;
  readonly fetch?: Fetcher;
}

async function readJson(fetcher: Fetcher, url: string): Promise<Json> {
  const response = await fetcher(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)} ${response.statusText}`);
  const value: unknown = await response.json();
  if (!isObject(value)) throw new Error(`${url}: the answer is not a JSON object`);
  return value;
}

/** A file entry of the API (`{ url, size }`) as a source file, or null. */
function fileOf(path: string, value: unknown): SourceFile | null {
  if (!isObject(value) || typeof value.url !== "string") return null;
  return { path, url: value.url, ...(typeof value.size === "number" ? { bytes: value.size } : {}) };
}

/** The file name of a URL. */
const nameOfUrl = (url: string): string => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file");

/** The files of an item from the answer of `/files/<id>`. */
export function polyHavenFiles(files: Json, kind: SourceKind, resolution: string): SourceFile[] {
  const pick = (group: unknown, format: string): Json | null => {
    const sizes = isObject(group) ? group : {};
    const at = sizes[resolution] ?? sizes[DEFAULT_RESOLUTION] ?? Object.values(sizes)[0];
    const entry = isObject(at) ? at[format] : undefined;
    return isObject(entry) ? entry : null;
  };
  if (kind === "environment") {
    const hdr = pick(files.hdri, "hdr");
    const main = hdr === null ? null : fileOf(nameOfUrl(String(hdr.url)), hdr);
    return main === null ? [] : [main];
  }
  if (kind === "texture") {
    const jpg = pick(files.Diffuse ?? files.diffuse, "jpg");
    const main = jpg === null ? null : fileOf(nameOfUrl(String(jpg.url)), jpg);
    return main === null ? [] : [main];
  }
  const gltf = pick(files.gltf, "gltf");
  const main = gltf === null ? null : fileOf(nameOfUrl(String(gltf.url)), gltf);
  if (main === null || gltf === null) return [];
  const include = isObject(gltf.include) ? gltf.include : {};
  const parts = Object.entries(include).flatMap(([path, value]) => {
    const file = fileOf(path, value);
    return file === null ? [] : [file];
  });
  return [main, ...parts];
}

/** The Poly Haven provider. */
export function polyHaven(options: PolyHavenOptions = {}): AssetProvider {
  const api = (options.api ?? POLYHAVEN_API).replace(/\/$/, "");
  const cdn = (options.cdn ?? POLYHAVEN_CDN).replace(/\/$/, "");
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    id: "polyhaven",
    name: "Poly Haven",
    kinds: ["environment", "model", "texture"],
    rights: {
      name: "polyhaven",
      source: "Poly Haven, https://polyhaven.com",
      author: "Poly Haven",
      licence: "CC0 1.0 Universal",
      spdx: "CC0-1.0",
      licenceUrl: "https://polyhaven.com/license",
      allowedUse: ["web", "public", "commercial"],
      webDelivery: true,
    },
    async search(kind, text) {
      const all = await readJson(fetcher, `${api}/assets?t=${TYPES[kind]}`);
      const words = searchWords(text);
      const ranks = new Map<string, number>();
      const items = Object.entries(all).flatMap(([id, value]): SourceItem[] => {
        if (!isObject(value)) return [];
        const list = (field: unknown): unknown[] => (Array.isArray(field) ? (field as unknown[]) : []);
        const tags = [...list(value.tags), ...list(value.categories)];
        const item = {
          id,
          name: typeof value.name === "string" ? value.name : id,
          kind,
          tags: tags.map(String),
          licence: "CC0-1.0",
          authors: isObject(value.authors) ? Object.keys(value.authors) : [],
        };
        ranks.set(id, typeof value.download_count === "number" ? value.download_count : 0);
        return itemMatches(item, words) ? [item] : [];
      });
      const rank = (item: SourceItem): number => ranks.get(item.id) ?? 0;
      return items.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name)).slice(0, MOST_ITEMS);
    },
    preview: (id) => `${cdn}/asset_img/thumbs/${encodeURIComponent(id)}.png?width=256&height=256`,
    async files(id, kind, resolution = DEFAULT_RESOLUTION) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`"${id}" is not a Poly Haven ID`);
      return polyHavenFiles(await readJson(fetcher, `${api}/files/${id}`), kind, resolution);
    },
  };
}
