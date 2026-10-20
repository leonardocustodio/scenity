// SPDX-License-Identifier: Apache-2.0
/**
 * The asset sources on a dev server, a Vite plugin. Poly Haven is built in. The environment
 * values `SCENITY_POLYHAVEN_API` and `SCENITY_POLYHAVEN_CDN` change its URLs (a test gives a local server).
 *
 * - `GET /projects/<name>/assets.sources.json`: the providers.
 * - `GET .../assets.sources.search?provider=<id>&kind=<kind>&q=<text>`: the items of a search.
 * - `GET .../assets.sources.preview?provider=<id>&id=<item>`: the preview picture of an item. The server fetches it,
 *   so the page loads no picture of another site (its content security policy).
 * - `POST .../assets.sources.import`: an import (`SourceImportInput`, with the import header): the files of the item,
 *   the rights record of the provider and the asset record (`importFromSource`). The answer is the import answer.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type * as SourcesIndex from "@scenity/assets/sources";
import {
  ASSET_SOURCES_IMPORT_PATH,
  ASSET_SOURCES_PATH,
  ASSET_SOURCES_PREVIEW_PATH,
  ASSET_SOURCES_SEARCH_PATH,
  type AssetImportResult,
  type SourceImportInput,
  type SourceProviderInfo,
} from "../src/assetBrowser/assetTypes.ts";
import { listEntryOf } from "./assetApi.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { projectHostFaces } from "./hostFaces.ts";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The most preview pictures that the server keeps. */
const PREVIEWS = 200;
const previews = new Map<string, { readonly type: string; readonly bytes: Uint8Array }>();
const registries = new Map<string, Promise<SourcesIndex.ProviderRegistry>>();

/** A project of the server: its name and its folder. */
interface Project {
  readonly name: string;
  readonly dir: string;
}

/**
 * The providers of a project: Poly Haven at the URLs of the environment, then the providers of the host faces of its
 * plugins (the `assetSources` point). A provider that the registry refuses gives a warning.
 */
function providers(project: Project): Promise<SourcesIndex.ProviderRegistry> {
  // A trust of the project gives it the providers of its plugins, so the key contains the state of the trust.
  const key = `${project.dir}|${RESTRICTED_PROJECTS.has(project.name) ? "restricted" : "trusted"}`;
  let known = registries.get(key);
  if (known === undefined) {
    known = (async () => {
      const { ProviderRegistry, polyHaven } = await assetsModule<typeof SourcesIndex>("sources");
      const registry = new ProviderRegistry().add(
        polyHaven({
          ...(process.env.SCENITY_POLYHAVEN_API === undefined ? {} : { api: process.env.SCENITY_POLYHAVEN_API }),
          ...(process.env.SCENITY_POLYHAVEN_CDN === undefined ? {} : { cdn: process.env.SCENITY_POLYHAVEN_CDN }),
        }),
      );
      for (const face of await projectHostFaces(project.name, project.dir)) {
        for (const source of face.assetSources ?? []) {
          try {
            registry.add(source as SourcesIndex.AssetProvider);
          } catch (error) {
            console.warn(`an asset source of ${face.id}:`, error instanceof Error ? error.message : error);
          }
        }
      }
      return registry;
    })();
    registries.set(key, known);
  }
  return known;
}

/** Forget the providers of a project folder (its plugins changed). */
export function forgetSources(dir: string): void {
  for (const key of [...registries.keys()]) if (key.startsWith(`${dir}|`)) registries.delete(key);
}

async function provider(project: Project, id: string | null): Promise<SourcesIndex.AssetProvider> {
  const found = (await providers(project)).get(id ?? "");
  if (found === undefined) throw new Error(`no asset source ${id ?? ""}`);
  return found;
}

const KINDS = new Set(["environment", "model", "texture"]);
function kindOf(value: unknown): SourcesIndex.SourceKind {
  if (typeof value !== "string" || !KINDS.has(value)) throw new Error(`"${String(value)}" is not a kind of a source`);
  return value as SourcesIndex.SourceKind;
}

async function sendPreview(project: Project, response: ServerResponse, params: URLSearchParams): Promise<void> {
  const source = await provider(project, params.get("provider"));
  const id = params.get("id") ?? "";
  const key = `${source.id}/${id}`;
  let picture = previews.get(key);
  if (picture === undefined) {
    const answer = await fetch(source.preview(id));
    if (!answer.ok) throw new Error(`no preview for ${id}`);
    picture = {
      type: answer.headers.get("content-type") ?? "image/png",
      bytes: new Uint8Array(await answer.arrayBuffer()),
    };
    if (previews.size >= PREVIEWS) previews.delete(previews.keys().next().value ?? "");
    previews.set(key, picture);
  }
  response.setHeader("Content-Type", picture.type);
  response.setHeader("Cache-Control", "max-age=86400");
  response.end(picture.bytes);
}

/** Import an item of a source into the folder of the project. */
export async function importItem(project: Project, input: SourceImportInput): Promise<AssetImportResult> {
  const { importFromSource } = await assetsModule<typeof SourcesIndex>("sources");
  const source = await provider(project, input.provider);
  const result = await importFromSource(project.dir, source, input.id, kindOf(input.kind), {
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    asset: listEntryOf(result.db, result.entry),
    warnings: result.warnings,
    rights: { record: result.rights.record, note: result.rights.note },
  };
}

async function handleGet(project: Project, what: string, url: string, response: ServerResponse): Promise<void> {
  const params = new URL(url, "http://localhost").searchParams;
  if (what === ASSET_SOURCES_PATH) {
    const list: SourceProviderInfo[] = (await providers(project)).list().map((each) => ({
      id: each.id,
      name: each.name,
      kinds: each.kinds,
      licence: each.rights.spdx ?? null,
    }));
    sendJson(response, 200, list);
  } else if (what === ASSET_SOURCES_SEARCH_PATH) {
    const source = await provider(project, params.get("provider"));
    sendJson(response, 200, await source.search(kindOf(params.get("kind")), params.get("q") ?? ""));
  } else await sendPreview(project, response, params);
}

async function handleImport(request: IncomingMessage, response: ServerResponse, project: Project): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "An import comes only from a page of this server." });
    return;
  }
  const result = await importItem(project, (await readJson(request)) as SourceImportInput);
  sendJson(response, result.ok ? 200 : 400, result);
}

const GETS = new Set([ASSET_SOURCES_PATH, ASSET_SOURCES_SEARCH_PATH, ASSET_SOURCES_PREVIEW_PATH]);

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenitySourcesApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-sources-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec(url.split("?")[0] ?? "");
        const name = match?.[1] ?? "";
        const dir = Object.hasOwn(projects, name) ? projects[name] : undefined;
        const what = match?.[2] ?? "";
        const fail = (error: unknown): void =>
          sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
        if (dir !== undefined && GETS.has(what) && request.method === "GET") {
          handleGet({ name, dir }, what, url, response).catch(fail);
        } else if (dir !== undefined && what === ASSET_SOURCES_IMPORT_PATH && request.method === "POST") {
          handleImport(request, response, { name, dir }).catch(fail);
        } else next();
      });
    },
  };
}
