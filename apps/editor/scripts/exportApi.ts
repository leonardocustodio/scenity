// SPDX-License-Identifier: Apache-2.0
/**
 * The GLB export of a scene on a dev server, a Vite plugin: `POST /projects/<name>/
 * assets.export.run` exports a scene of the project (`exportScene` of `@scenity/assets/export`, as `scenity assets
 * export`), writes the GLB file into the project folder and checks it with the glTF validator. The run needs the
 * import header and the same origin, as the import does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import type * as BuildIndex from "@scenity/assets/build";
import type * as ExportIndex from "@scenity/assets/export";
import { ASSET_EXPORT_PATH, type GlbExportInput, type GlbExportResult } from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The folder of the default output (`EXPORT_FOLDER` of the export command), relative to the project folder. */
const EXPORT_FOLDER = ".scenity/exports";

/** Export a scene of the project folder `dir` as GLB, and check the file with the glTF validator. */
export async function exportGlb(dir: string, input: GlbExportInput): Promise<GlbExportResult> {
  const { exportScene } = await assetsModule<typeof ExportIndex>("export");
  const { gltfErrors } = await assetsModule<typeof BuildIndex>("build");
  let result: ExportIndex.SceneExport;
  try {
    result = await exportScene(dir, input.scene, { runImports: input.runImports !== false });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const asked = input.out?.trim() ?? "";
  const out = asked === "" ? `${EXPORT_FOLDER}/${result.scene.id}.glb` : asked;
  const file = resolve(dir, out);
  if (relative(dir, file).startsWith("..") || !file.endsWith(".glb")) {
    return { ok: false, reason: `${out} is not a .glb file in the project folder` };
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.glb);
  return {
    ok: true,
    file: relative(dir, file).split("\\").join("/"),
    bytes: result.glb.byteLength,
    entities: Object.keys(result.scene.entities).length,
    models: Object.keys(result.models).length,
    warnings: result.warnings,
    validatorErrors: await gltfErrors(result.glb),
  };
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityExportApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-export-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir === undefined || match?.[2] !== ASSET_EXPORT_PATH || request.method !== "POST") {
          next();
          return;
        }
        if (isRemote(process.env) || !sameOriginImport(request)) {
          sendJson(response, 403, { ok: false, reason: "An export comes only from a page of this server." });
          return;
        }
        void readJson(request)
          .then((input) => exportGlb(dir, input as GlbExportInput))
          .then(
            (result) => sendJson(response, result.ok ? 200 : 400, result),
            (error: unknown) => sendJson(response, 400, { ok: false, reason: String(error) }),
          );
      });
    },
  };
}
