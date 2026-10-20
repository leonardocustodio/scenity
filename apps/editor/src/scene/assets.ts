// SPDX-License-Identifier: Apache-2.0
/**
 * The assets of a project for the scene page and the still page. They are the built outputs through the asset
 * manifest when the project has a build, else the source files of the asset index (the dev fallback, project.ts).
 *
 * - A build: `<output>/manifest.json` (Manifest 2, `build.assets.output` of `scenity.project.json`, default "build"),
 *   checked with `parseAssetManifest` and the budgets of the project before any file loads. Each file of a record has a
 *   size and a SHA-256, so the asset loader checks them.
 * - The dev fallback: one record for each asset with its source file and no checks. A project with a build also gets
 *   a dev record of each asset that the build does not hold yet (a new import or promote). Thus a promoted model shows
 *   after a reload with no build.
 *
 * The page also gives the URLs of the WASM decoders (decoders.ts): the Basis transcoder for KTX2 textures and the Draco
 * decoder. The Draco decoder loads only for a file with Draco.
 */
import { parseAssetManifest, type AssetBudgets, type AssetManifest } from "@scenity/runtime/manifest";
import type { SceneDecoders } from "@scenity/runtime/protocol";
import { readManifest } from "./project";
import { t } from "../texts";

/** Where the assets come from: the built outputs, or the source files. */
export type AssetOrigin = "build" | "source";

/** The asset part of a "load" message, and the origin of the files. */
export interface ProjectAssets {
  readonly manifest: AssetManifest;
  readonly files: Readonly<Record<string, string>>;
  readonly decoders: SceneDecoders;
  readonly origin: AssetOrigin;
}

/** The part of `scenity.project.json` that the page reads. */
interface ProjectBuild {
  readonly build?: { readonly assets?: { readonly output?: string } };
  readonly quality?: { readonly budgets?: AssetBudgets };
}

/** True for a JSON answer: a static server can answer a missing file with the page (an HTML 200). */
function isJson(response: Response): boolean {
  return response.ok && (response.headers.get("Content-Type") ?? "").includes("json");
}

/** The built manifest of the project at `base`, or null when the project has no build. */
async function readBuild(base: string): Promise<Omit<ProjectAssets, "decoders" | "origin"> | null> {
  const project = await fetch(`${base}scenity.project.json`);
  if (!isJson(project)) return null;
  const settings = (await project.json()) as ProjectBuild;
  const output = settings.build?.assets?.output ?? "build";
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(output) || output.split("/").includes("..")) {
    throw new Error(t("scene-error-output", { output }));
  }
  const response = await fetch(`${base}${output}/manifest.json`);
  if (!isJson(response)) return null;
  const manifest = parseAssetManifest(await response.json(), settings.quality?.budgets);
  const files: Record<string, string> = {};
  for (const record of manifest.records) {
    for (const file of record.files) files[file.file] = `${base}${output}/${encodeURIComponent(file.file)}`;
  }
  return { manifest, files };
}

/**
 * The assets of the project at `base`. When `wanted` is "source", the page takes the source files. Otherwise it takes
 * the build when there is one, else the source files.
 */
export async function readAssets(base: string, wanted: string | null, decoders: SceneDecoders): Promise<ProjectAssets> {
  if (wanted !== null && wanted !== "build" && wanted !== "source") {
    throw new Error(t("scene-error-origin", { origin: wanted }));
  }
  const build = wanted === "source" ? null : await readBuild(base);
  if (build === null && wanted === "build") throw new Error(t("scene-error-no-build", { base }));
  if (build !== null)
    return { ...(wanted === "build" ? build : await withNewSources(base, build)), decoders, origin: "build" };
  return { ...(await readManifest(base)), decoders, origin: "source" };
}

/**
 * The build with a dev record of each asset that the build does not hold yet (a new import or promote). The dev record
 * has the source file, as the dev fallback gives it. An asset of the build keeps its built files. With no asset index,
 * the result is the build.
 */
async function withNewSources(
  base: string,
  build: Omit<ProjectAssets, "decoders" | "origin">,
): Promise<Omit<ProjectAssets, "decoders" | "origin">> {
  const sources = await readManifest(base).catch(() => null);
  if (sources === null) return build;
  const built = new Set(build.manifest.records.map((record) => record.id));
  const added = sources.manifest.records.filter((record) => !built.has(record.id));
  if (added.length === 0) return build;
  const files = { ...build.files };
  for (const record of added) for (const file of record.files) files[file.file] = sources.files[file.file] ?? "";
  return { manifest: { ...build.manifest, records: [...build.manifest.records, ...added] }, files };
}
