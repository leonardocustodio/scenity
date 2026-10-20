// SPDX-License-Identifier: Apache-2.0
// The first load of the scene page in `scenity dev`. The dev server answers a missing project file with no page of the
// app (404, or 204 for a read of the file port). The page reads the editor settings of a project with no
// `scenity.editor.json` and gives no warning. The dependency step names the modules of the Scenity packages. The
// caption of the camera preview names the camera entity. The spec `scene-first-load.spec.ts` runs the same page in a
// browser.
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_READ_HEADER as SERVER_READ_HEADER, scenityProjects } from "../../scripts/projects";
import { sceneDependencies, SCENE_PAGE_MODULES } from "../../scripts/scenityDeps";
import { devServerFiles, FILE_READ_HEADER } from "../../src/scene/sceneFiles";
import { PageSettings } from "../../src/scene/settings/pageSettings";
import { PreviewInset } from "../../src/scene/viewport/previewInset";
import { loadConfigFromFile, type UserConfig } from "vite";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const MANIFEST = join(import.meta.dirname, "../../package.json");

/** The config of the scene page dev server, as Vite loads it. */
async function sceneConfig(): Promise<UserConfig> {
  const file = join(import.meta.dirname, "../../vite.scene.config.ts");
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, file);
  if (loaded === null) throw new Error("no scene config");
  return loaded.config;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

/** The middleware of the projects plugin for the showroom. */
function projectsMiddleware(): Middleware {
  const handlers: Middleware[] = [];
  const plugin = scenityProjects({ showroom: SHOWROOM });
  const server = { middlewares: { use: (fn: Middleware) => handlers.push(fn) } };
  (plugin.configureServer as (server: unknown) => void)(server);
  const [handler] = handlers;
  if (handler === undefined) throw new Error("no middleware");
  return handler;
}

/** One GET through the middleware: the status, the body length and whether the request went on to Vite. */
function get(url: string, headers: Record<string, string> = {}): { status: number; bytes: number; next: boolean } {
  const out = { status: 200, bytes: 0, next: false };
  const response = {
    statusCode: 200,
    setHeader: () => undefined,
    end(body?: Uint8Array | string) {
      out.status = this.statusCode;
      out.bytes = body === undefined ? 0 : body.length;
    },
  };
  projectsMiddleware()({ url, method: "GET", headers } as unknown as IncomingMessage, response as never, () => {
    out.next = true;
  });
  return out;
}

describe("a missing project file on the scene page dev server", () => {
  it("gets 404, or 204 for a read of the file port, and never the page of the app", () => {
    expect(SERVER_READ_HEADER).toBe(FILE_READ_HEADER);
    expect(get("/projects/showroom/scenity.editor.json")).toEqual({ status: 404, bytes: 0, next: false });
    expect(get("/projects/showroom/scenity.editor.json", { [FILE_READ_HEADER]: "1" })).toEqual({
      status: 204,
      bytes: 0,
      next: false,
    });
    expect(get("/projects/showroom/../../package.json")).toEqual({ status: 404, bytes: 0, next: false });
    const found = get("/projects/showroom/scenity.project.json");
    expect(found.status).toBe(200);
    expect(found.bytes).toBeGreaterThan(0);
    // A project that the server does not have goes on to Vite (its 404).
    expect(get("/projects/nothing/scenity.project.json").next).toBe(true);
  });

  it("has no fallback page, and the scan of the dependency step reads no page of the lab", async () => {
    const config = await sceneConfig();
    expect(config.appType).toBe("mpa");
    // The Hub of the studio is a page of the scene server too.
    expect(config.optimizeDeps?.entries).toEqual(["scene.html", "hub.html", "player/*.html"]);
  });
});

describe("the editor settings of a project with no settings file", () => {
  it("reads a missing file as empty with no warning, and warns for a file that does not read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchStub = vi.fn((_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get(FILE_READ_HEADER)).toBe("1");
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchStub);
    const settings = new PageSettings(null);
    await settings.attach(devServerFiles("/projects/showroom/"));
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(settings.info()).toMatchObject({ loaded: true, project: null });
    expect(warn).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{ not json", { status: 200 })));
    const broken = new PageSettings(null);
    await broken.attach(devServerFiles("/projects/showroom/"));
    expect(broken.info()).toMatchObject({ loaded: true, project: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("scenity.editor.json does not read");
  });
});

describe("the dependency step of the scene page", () => {
  it("names each module, from the editor or through the Scenity package that declares its package", async () => {
    const include = sceneDependencies(MANIFEST);
    expect(include).toHaveLength(SCENE_PAGE_MODULES.length);
    expect(include).toContain("vue");
    expect(include).toContain("three/examples/jsm/postprocessing/EffectComposer.js");
    expect(include.find((id) => id.endsWith(" > zod"))).toMatch(/^@scenity\/[a-z0-9-]+ > zod$/);
    expect(include.find((id) => id.endsWith(" > reka-ui"))).toMatch(/^@scenity\/[a-z0-9-]+ > reka-ui$/);
    expect(include.find((id) => id.endsWith(" > @fluent/bundle"))).toMatch(/^@scenity\/[a-z0-9-]+ > @fluent\/bundle$/);
    // A module of a package that no manifest declares goes out.
    expect(sceneDependencies(MANIFEST, ["vue", "no-such-package/sub"])).toEqual(["vue"]);
    expect((await sceneConfig()).optimizeDeps?.include).toEqual(include);
  });
});

describe("the camera preview", () => {
  it("names the camera entity, and the caption follows a rename", () => {
    const take = vi.fn(() => Promise.resolve(null));
    const inset = new PreviewInset(take);
    const caption = inset.root.querySelector("figcaption");
    inset.show("entity-2", "entity-2");
    expect(caption?.textContent).toContain("entity-2");
    inset.show("entity-2", "Side");
    expect(caption?.textContent).toContain("Side");
    expect(caption?.textContent).not.toContain("entity-2");
    expect(inset.root.hidden).toBe(false);
    inset.show(null, "");
    expect(inset.root.hidden).toBe(true);
    expect(caption?.textContent).toBe("");
  });
});
