// SPDX-License-Identifier: Apache-2.0
/**
 * The host reads the project manifest and needs no Git.
 *
 * - The host starts in-process on a temporary copy of `samples/showroom` (a folder with no Git): `host.hello` lists
 *   the surfaces of the manifest, says `git: false`, and the Git requests refuse cleanly.
 * - The host starts on a Git checkout without a manifest (this repository): the built-in manifest gives the lab.
 * - The setup command, the denylist and the content roots of the manifest reach the parts of the host.
 * - The surfaces come from the manifest (the showroom) or from the host plugin (the built-in manifest), with
 *   their capabilities, pages, hidden flags and order; the host runs them under their manifest IDs.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtInIndexSource } from "../src/plugins";
import { setupSteps } from "../src/checkoutSetup";
import { denyPatterns, globPattern, isDenied } from "../src/denylist";
import { startHost, type Host } from "../src/host";
import { defaultProject, loadHostProject } from "../src/project";
import { NO_GIT, surfaceTabs, type ProjectSurfaceInfo, type RequestResult, type SurfaceState } from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir } from "./helpers";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SHOWROOM = resolve(import.meta.dir, "../../../samples/showroom");
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A copy of the showroom sample in a temporary folder with no Git. */
function showroomCopy(): string {
  const parent = tempDir("showroom");
  made.push(parent);
  const dir = join(parent, "showroom");
  cpSync(SHOWROOM, dir, { recursive: true });
  return dir;
}

async function start(folder: string, project?: string): Promise<{ host: Host; page: FakePage }> {
  const state = tempDir("project-state");
  made.push(state);
  const host = await startHost({
    checkout: folder,
    ...(project === undefined ? {} : { project }),
    stateDir: state,
    serverCommand: fakeCommand,
    watch: false,
  });
  return { host, page: await FakePage.open(host.endpoint) };
}

type Hello = RequestResult<"host.hello">;

/** A scene surface with the defaults of the host (the capabilities of the kind `scene`). */
function sceneInfo(id: string, label: string, more: Partial<ProjectSurfaceInfo> = {}): ProjectSurfaceInfo {
  return { id, kind: "scene", label, capabilities: ["scene", "index"], page: null, hidden: false, order: 1, ...more };
}

/** The ID, label and capabilities of each surface state. */
function shortStates(states: readonly SurfaceState[]): Pick<SurfaceState, "id" | "label" | "capabilities">[] {
  return states.map(({ id, label, capabilities }) => ({ id, label, capabilities }));
}

describe("the host on the showroom sample (no Git)", () => {
  test("host.hello lists the surfaces of the manifest; the Git requests refuse", async () => {
    const dir = showroomCopy();
    const { host, page } = await start(dir);
    try {
      const hello = (await page.call("host.hello", { origin: "http://127.0.0.1:5999" })) as Hello;
      expect(hello.project?.surfaces).toEqual([sceneInfo("editor", "Editor")]);
      expect(hello.project?.id).toBe("showroom");
      expect(hello.project?.manifest).toBe(join(dir, "scenity.project.json"));
      expect(hello.project?.runs).toEqual({ check: "scenity check" });
      expect(hello.project?.contentRoots).toEqual(["assets", "scenes"]);
      expect(hello.git).toBe(false);
      expect(hello.role).toBe("admin");
      expect(hello.auth).toBe("none");
      expect(hello.checkout).toMatchObject({ path: dir, branch: null, changed: 0, open: true });
      // The scene surface of the manifest runs under its manifest ID and label.
      expect(shortStates(hello.surfaces)).toEqual([
        { id: "editor", label: "Editor", capabilities: ["scene", "index"] },
      ]);

      for (const type of ["git.status", "git.diff", "git.turns", "git.commit"]) {
        expect(await page.request(type, { message: "x", paths: [] })).toMatchObject({ ok: false, error: NO_GIT });
      }
      expect(await page.request("checkouts.create", { branch: "x" })).toMatchObject({ ok: false, error: NO_GIT });
      expect(await page.call("checkouts.list")).toEqual([
        { path: dir, branch: null, head: "", changed: 0, open: true },
      ]);
      // No turns without Git. The hooks still get a number.
      const turn = await host.turns.beginTurn(dir, "s1", { prompt: "move the cart" });
      expect(turn.turn).toBe(1);
      expect(host.turns.list(dir)).toEqual([]);
      expect(await host.turns.recordEdits(dir, "s1", [join(dir, "scenes/main.scene.json")])).toBeNull();
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("a bad manifest stops the start with the file and the problem", async () => {
    const dir = showroomCopy();
    writeFileSync(join(dir, "scenity.project.json"), JSON.stringify({ format: "scenity.project/1", id: "x" }));
    await rejectsWith(loadHostProject(dir), "scenity.project.json does not read");
  });
});

describe("the host on a Git checkout", () => {
  test("a checkout without a manifest gets the built-in lab manifest", async () => {
    const { parent, repo } = await makeRepo();
    made.push(parent);
    const { host, page } = await start(repo);
    try {
      const hello = (await page.call("host.hello")) as Hello;
      expect(hello.git).toBe(true);
      expect(hello.project?.manifest).toBeNull();
      // The host plugin gives the surfaces: the lab, ⌘1.
      expect(hello.project?.surfaces).toEqual([sceneInfo("lab", "Lab")]);
      expect(shortStates(hello.surfaces)).toEqual([{ id: "lab", label: "Lab", capabilities: ["scene", "index"] }]);
      expect(hello.project?.runs.motion).toBe("bun run labs motion");
      expect(hello.project?.contentRoots).toEqual([...builtInIndexSource().content.roots]);
      expect(hello.project?.credentialFile).toBe(".env");
      expect(await page.call("git.status")).toMatchObject({ files: [] });
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("--project names a folder of the checkout: the content roots are relative to the checkout", async () => {
    const { parent, repo } = await makeRepo();
    made.push(parent);
    const dir = join(repo, "samples", "showroom");
    mkdirSync(join(repo, "samples"));
    cpSync(SHOWROOM, dir, { recursive: true });
    const { host, page } = await start(repo, dir);
    try {
      const hello = (await page.call("host.hello")) as Hello;
      expect(hello.git).toBe(true);
      expect(hello.project?.dir).toBe(dir);
      expect(hello.project?.contentRoots).toEqual(["samples/showroom/assets", "samples/showroom/scenes"]);
      expect(host.project().content.roots).toEqual(["samples/showroom/assets", "samples/showroom/scenes"]);
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("the surface of the manifest runs the scene page of the project on its scene server", async () => {
    const dir = showroomCopy();
    const { host, page } = await start(dir);
    try {
      await page.call("host.hello", { origin: "http://127.0.0.1:5999" });
      const ready = (await page.waitEvent(
        (event) => event.type === "surface.state" && event.surface.id === "editor" && event.surface.url !== null,
      )) as { surface: SurfaceState };
      const url = new URL(ready.surface.url ?? "");
      expect(url.pathname).toBe("/scene.html");
      expect(url.searchParams.get("project")).toBe("showroom");
      expect(url.searchParams.get("edit")).toBe("1");
      expect(url.searchParams.get("workbench")).toBe("http://127.0.0.1:5999");
      // The scene page has no built lab of the render pool: the scene server is the one server of the project.
      expect(host.servers.all().map((server) => [server.kind, server.checkout])).toEqual([["scene", dir]]);
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("the built-in manifest hashes the content of the lab, as the lab page does", () => {
    expect(defaultProject("/work").content).toEqual(builtInIndexSource().content);
    // The lab page plans its open take. The built-in source gives no plans.
    expect(defaultProject("/work").index.plans()).toEqual([]);
  });
});

describe("surfaces from data", () => {
  /** A showroom copy whose manifest has these surfaces. */
  function withSurfaces(surfaces: readonly object[]): string {
    const dir = showroomCopy();
    const file = join(dir, "scenity.project.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { workbench: { surfaces: readonly object[] } };
    writeFileSync(file, JSON.stringify({ ...doc, workbench: { ...doc.workbench, surfaces } }));
    return dir;
  }

  test("the manifest gives the capabilities, pages, hidden flags and order; the tabs follow the order", async () => {
    const dir = withSurfaces([
      { id: "web", kind: "web", label: "Site", order: 3 },
      { id: "view", kind: "scene", label: "View", capabilities: [], page: "/scene.html?project=showroom", order: 2 },
      { id: "tools", kind: "scene", label: "Tools", capabilities: ["scene"], hidden: true },
      { id: "main", kind: "scene", label: "Main", order: 1 },
    ]);
    const project = await loadHostProject(dir);
    expect(project.surfaces).toEqual([
      { id: "web", kind: "web", label: "Site", capabilities: [], page: null, hidden: false, order: 3 },
      sceneInfo("view", "View", { capabilities: [], page: "/scene.html?project=showroom", order: 2 }),
      sceneInfo("tools", "Tools", { capabilities: ["scene"], hidden: true, order: 3 }),
      sceneInfo("main", "Main", { order: 1 }),
    ]);
    expect(surfaceTabs(project.surfaces).map((surface) => surface.id)).toEqual(["main", "view", "web"]);
  });

  test("the host runs each scene surface; the first with the scene capability is the scene surface", async () => {
    const dir = withSurfaces([
      { id: "view", kind: "scene", label: "View", capabilities: [], page: "/scene.html?project=showroom" },
      { id: "main", kind: "scene", label: "Main" },
      { id: "web", kind: "web", label: "Site" },
    ]);
    const { host, page } = await start(dir);
    try {
      const hello = (await page.call("host.hello", { origin: "http://127.0.0.1:5999" })) as Hello;
      expect(shortStates(hello.surfaces)).toEqual([
        { id: "view", label: "View", capabilities: [] },
        { id: "main", label: "Main", capabilities: ["scene", "index"] },
      ]);
      expect(host.surfaces.idWith()).toBe("main");
      const ready = (await page.waitEvent(
        (event) => event.type === "surface.state" && event.surface.id === "view" && event.surface.url !== null,
      )) as { surface: SurfaceState };
      const url = new URL(ready.surface.url ?? "");
      expect(`${url.pathname}?project=${url.searchParams.get("project") ?? ""}`).toBe("/scene.html?project=showroom");
      // A surface without the scene capability gets no lab defaults (no `worker=1`).
      expect(url.searchParams.has("worker")).toBe(false);
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("a manifest without a scene surface has no scene surface in the host", async () => {
    const { host, page } = await start(withSurfaces([{ id: "web", kind: "web", label: "Site" }]));
    try {
      const hello = (await page.call("host.hello")) as Hello;
      expect(hello.surfaces).toEqual([]);
      expect(host.surfaces.idWith()).toBeNull();
      expect(() => host.surfaces.scene()).toThrow("no surface with the capability scene");
    } finally {
      page.close();
      await host.stop();
    }
  });
});

describe("the fields of the workbench part", () => {
  test("the setup command becomes steps without a shell", () => {
    expect(setupSteps("bun install --frozen-lockfile && bun run generate")).toEqual([
      ["bun", "install", "--frozen-lockfile"],
      ["bun", "run", "generate"],
    ]);
    expect(() => setupSteps("bun install; rm -rf /")).toThrow("shell character");
    expect(() => setupSteps("bun install & echo")).toThrow("shell character");
    expect(() => setupSteps("bun install &&")).toThrow("not valid");
  });

  test("the denylist patterns of the manifest deny their paths", () => {
    expect(globPattern("**/*.secret").test("a/b/c.secret")).toBe(true);
    expect(globPattern("private/*.json").test("x/private/keys.json")).toBe(true);
    expect(globPattern("private/*.json").test("private/sub/keys.json")).toBe(false);
    expect(isDenied("art/notes.secret")).toBe(false);
    denyPatterns(["*.secret", "vault/**"]);
    expect(isDenied("art/notes.secret")).toBe(true);
    expect(isDenied("/abs/project/vault/a/b.txt")).toBe(true);
    expect(isDenied("scenes/main.scene.json")).toBe(false);
  });
});
