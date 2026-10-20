// SPDX-License-Identifier: Apache-2.0
/**
 * The generated assets on a dev server, a Vite plugin. Scenity has no generator of its own:
 * `SCENITY_GENERATOR_URL` names a generation service (`httpGenerator` of `@scenity/assets/sources`), and
 * `SCENITY_GENERATOR_NAME` its name. With no service the list is empty.
 *
 * - `GET /projects/<name>/assets.generators.json`: the generators.
 * - `POST .../assets.generate.estimate`: the cost of a run (`GenerateInput`), before the run.
 * - `POST .../assets.generate.run`: a run and the import of its result with the generated rights record.
 *
 * The posts need the import header and the same origin, as the import does.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type * as SourcesIndex from "@scenity/assets/sources";
import {
  ASSET_GENERATE_ESTIMATE_PATH,
  ASSET_GENERATE_RUN_PATH,
  ASSET_GENERATORS_PATH,
  type AssetImportResult,
  type GenerateEstimateResult,
  type GenerateInput,
  type GeneratorInfo,
} from "../src/assetBrowser/assetTypes.ts";
import { listEntryOf } from "./assetApi.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

let generators: Promise<SourcesIndex.AssetGenerator[]> | null = null;

/** The generators of the server: the service of the environment, if one. */
function list(): Promise<SourcesIndex.AssetGenerator[]> {
  generators ??= assetsModule<typeof SourcesIndex>("sources").then(({ httpGenerator }) => {
    const url = process.env.SCENITY_GENERATOR_URL;
    if (url === undefined || url === "") return [];
    const name = process.env.SCENITY_GENERATOR_NAME ?? "Generator";
    return [httpGenerator({ id: "service", name, url })];
  });
  return generators;
}

async function generatorOf(input: GenerateInput): Promise<SourcesIndex.AssetGenerator> {
  const found = (await list()).find((each) => each.id === input.generator);
  if (found === undefined) throw new Error(`no generator ${input.generator}`);
  if (typeof input.prompt !== "string" || input.prompt.trim() === "") throw new Error("the request has no text");
  if (!found.kinds.includes(input.kind)) throw new Error(`${found.name} does not make the kind ${input.kind}`);
  return found;
}

/** The cost of a run. */
export async function estimateRun(input: GenerateInput): Promise<GenerateEstimateResult> {
  const generator = await generatorOf(input);
  return { ok: true, ...(await generator.estimate({ prompt: input.prompt.trim(), kind: input.kind })) };
}

/** A run and the import of its result into the project folder `dir`. */
export async function runGenerator(dir: string, input: GenerateInput): Promise<AssetImportResult> {
  const { importGenerated } = await assetsModule<typeof SourcesIndex>("sources");
  const result = await importGenerated(dir, await generatorOf(input), {
    prompt: input.prompt.trim(),
    kind: input.kind,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    asset: listEntryOf(result.db, result.entry),
    warnings: result.warnings,
    rights: { record: result.rights.record, note: result.rights.note },
  };
}

async function handlePost(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  what: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A generation comes only from a page of this server." });
    return;
  }
  const input = (await readJson(request)) as GenerateInput;
  const result = what === ASSET_GENERATE_ESTIMATE_PATH ? await estimateRun(input) : await runGenerator(dir, input);
  sendJson(response, result.ok ? 200 : 400, result);
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityGeneratorsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-generators-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        const fail = (error: unknown): void =>
          sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
        if (dir !== undefined && what === ASSET_GENERATORS_PATH && request.method === "GET") {
          list().then((all) => {
            const info: GeneratorInfo[] = all.map((each) => ({ id: each.id, name: each.name, kinds: each.kinds }));
            sendJson(response, 200, info);
          }, fail);
        } else if (
          dir !== undefined &&
          (what === ASSET_GENERATE_ESTIMATE_PATH || what === ASSET_GENERATE_RUN_PATH) &&
          request.method === "POST"
        ) {
          handlePost(request, response, dir, what).catch(fail);
        } else next();
      });
    },
  };
}
