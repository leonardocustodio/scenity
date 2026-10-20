// SPDX-License-Identifier: Apache-2.0
/**
 * The generated assets: a generator makes a model, a texture or a sky from a text. It gives
 * the cost of a run first (an estimate), and the files of the result after the run. Scenity has no generator of its
 * own: `httpGenerator` speaks to a service at a URL with two requests, and a plugin can add another generator.
 *
 *   POST <url>/estimate { prompt, kind }  →  { cost, unit, seconds }
 *   POST <url>/generate { prompt, kind }  →  { name, files: [{ path, url }] }   (the main file first)
 *
 * The import writes the rights record of the generator (`rights/generated-<id>.yaml`, of kind "generated"), puts the
 * files into `assets/sources/generated/<name>/` and imports the main file with that record.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { importProjectFile, type ProjectImportResult } from "../projectImport";
import { writeRightsRecord } from "../rights/write";
import type { Fetcher, SourceFile, SourceKind } from "./provider";

/** A request to a generator. */
export interface GenerateRequest {
  readonly prompt: string;
  readonly kind: SourceKind;
}

/** The cost of a run: an amount in the unit of the service (credits, USD) and the time of the run. */
export interface GenerateEstimate {
  readonly cost: number;
  readonly unit: string;
  readonly seconds: number;
}

/** The result of a run: a name for the asset and its files, the main file first. */
export interface GenerateResult {
  readonly name: string;
  readonly files: readonly SourceFile[];
}

/** A generator of assets. */
export interface AssetGenerator {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly SourceKind[];
  /** The terms of the service: the licence text of the rights record of its results. */
  readonly licence: string;
  readonly spdx: string | null;
  estimate(request: GenerateRequest): Promise<GenerateEstimate>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function post(fetcher: Fetcher, url: string, body: unknown): Promise<Json> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)} ${response.statusText}`);
  const value: unknown = await response.json();
  if (!isObject(value)) throw new Error(`${url}: the answer is not a JSON object`);
  return value;
}

export interface HttpGeneratorOptions {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly kinds?: readonly SourceKind[];
  readonly licence?: string;
  readonly spdx?: string | null;
  readonly fetch?: Fetcher;
}

/** A generator that speaks to a service at a URL (see the head of this file). */
export function httpGenerator(options: HttpGeneratorOptions): AssetGenerator {
  const url = options.url.replace(/\/$/, "");
  const fetcher = options.fetch ?? ((target, init) => fetch(target, init));
  return {
    id: options.id,
    name: options.name,
    kinds: options.kinds ?? ["model", "texture", "environment"],
    licence: options.licence ?? `The terms of ${options.name}`,
    spdx: options.spdx ?? null,
    async estimate(request) {
      const answer = await post(fetcher, `${url}/estimate`, request);
      if (typeof answer.cost !== "number" || typeof answer.unit !== "string")
        throw new Error("the estimate has no cost");
      return { cost: answer.cost, unit: answer.unit, seconds: typeof answer.seconds === "number" ? answer.seconds : 0 };
    },
    async generate(request) {
      const answer = await post(fetcher, `${url}/generate`, request);
      const files = (Array.isArray(answer.files) ? answer.files : []).flatMap((file): SourceFile[] =>
        isObject(file) && typeof file.path === "string" && typeof file.url === "string"
          ? [{ path: file.path, url: file.url }]
          : [],
      );
      if (files.length === 0) throw new Error("the generator gives no file");
      return { name: typeof answer.name === "string" ? answer.name : "generated", files };
    },
  };
}

/** A relative path in the folder of a result: no "..", no absolute path. */
function safePath(path: string): string | null {
  const clean = posix.normalize(path.replaceAll("\\", "/"));
  return clean.startsWith("/") || clean.startsWith("..") || clean === "." ? null : clean;
}

/** Run a generator and import its result into the project folder `dir`. */
export async function importGenerated(
  dir: string,
  generator: AssetGenerator,
  request: GenerateRequest,
  options: { readonly fetch?: Fetcher; readonly today?: string } = {},
): Promise<ProjectImportResult> {
  const fetcher = options.fetch ?? ((url) => fetch(url));
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const rights = `rights/generated-${generator.id}.yaml`;
  if (!existsSync(join(dir, rights))) {
    const written = writeRightsRecord(dir, {
      name: `generated-${generator.id}`,
      source: generator.name,
      author: generator.name,
      licence: generator.licence,
      spdx: generator.spdx,
      licenceDate: today,
      allowedUse: ["web"],
      webDelivery: "pending",
      kind: "generated",
      generator: generator.id,
    });
    if (!written.ok) return { ok: false, reason: written.reason };
  }
  const result = await generator.generate(request);
  const slug =
    result.name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "generated";
  const folder = `assets/sources/generated/${slug}`;
  const download = async (url: string): Promise<Uint8Array> => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [main, ...parts] = result.files;
  const mainPath = main === undefined ? null : safePath(main.path);
  if (main === undefined || mainPath === null) return { ok: false, reason: "the generator gives no main file" };
  for (const part of parts) {
    const path = safePath(part.path);
    if (path === null) return { ok: false, reason: `${part.path} is not a path in the folder of the result` };
    mkdirSync(dirname(join(dir, folder, path)), { recursive: true });
    writeFileSync(join(dir, folder, path), await download(part.url));
  }
  const sub = posix.dirname(mainPath);
  return importProjectFile(dir, posix.basename(mainPath), await download(main.url), {
    folder: sub === "." ? folder : `${folder}/${sub}`,
    rights,
    tags: ["generated", generator.id],
    today,
  });
}
