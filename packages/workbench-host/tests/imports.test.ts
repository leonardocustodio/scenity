// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the import by drop on the host:
 * - the fields of a request;
 * - the upload of a dropped GLB with its drop point (the browser path) through a real host, and the size limit;
 * - the path of a desktop drop (home folder, links, the denylist);
 * - the run of the job in the Runs tab, and the file route.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost } from "../src/host";
import { checkDropPath, importJob, ImportJobs, type ImportRequestFile } from "../src/imports";
import {
  importFileOf,
  importQuery,
  isEventOf,
  isBridgeEvent,
  readImportFields,
  safeImportName,
  type ImportStarted,
} from "../src/protocol";
import { WEB_DIR } from "../src/runArgs";
import { builtInRunCatalog } from "../src/runCatalog";
import { RunManager, type RunExit, type RunSpawner, type SpawnOptions } from "../src/runs";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

scaleTestTimeouts();

const dir = tempDir("imports");
const made: string[] = [dir];
afterAll(() => cleanup(...made));

interface FakeRun {
  readonly argv: readonly string[];
  readonly options: SpawnOptions;
  end(code: number): void;
}

function fakeSpawner(): { spawn: RunSpawner; runs: FakeRun[] } {
  const runs: FakeRun[] = [];
  const spawn: RunSpawner = (argv, options) => {
    let end: (exit: RunExit) => void = () => undefined;
    const exited = new Promise<RunExit>((resolve) => (end = resolve));
    runs.push({ argv, options, end: (code) => end({ code, signal: null }) });
    return { exited, signal: () => end({ code: null, signal: "SIGTERM" }) };
  };
  return { spawn, runs };
}

/** The bytes of a GLB header (enough for the route: the host does not read the file). */
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);

describe("the fields of an import", () => {
  test("a name of an import format, a point of three numbers, short texts", () => {
    const fields = readImportFields(
      { point: "1.2,0,-0.5", source: " me ", licence: "CC0-1.0", drop: "drop-3" },
      "a b.GLB",
    );
    expect(fields).toEqual({
      name: "a_b.GLB",
      point: [1.2, 0, -0.5],
      source: "me",
      licence: "CC0-1.0",
      drop: "drop-3",
    });
    expect(readImportFields({}, "x.fbx").point).toBeNull();
    expect(() => readImportFields({}, "x.stl")).toThrow("the import reads");
    expect(() => readImportFields({ point: "1,2" }, "x.obj")).toThrow("three numbers");
    expect(() => readImportFields({ source: "a\u0000b" }, "x.obj")).toThrow("control character");
    expect(() => readImportFields({ drop: "a/b" }, "x.obj")).toThrow("not allowed");
    expect(safeImportName("../../etc/passwd.blend")).toBe("passwd.blend");
    expect(safeImportName(".hidden.glb")).toBe("_hidden.glb");
  });

  test("the query of the page reads back as the same fields", () => {
    const fields = { name: "chair.obj", point: [0.5, 0.9, 1] as const, source: "s", licence: "l", drop: "d1" };
    const params = new URLSearchParams(importQuery(fields));
    expect(readImportFields(Object.fromEntries(params), params.get("name") ?? "")).toEqual({
      ...fields,
      point: [0.5, 0.9, 1],
    });
  });

  test("the file route takes only the files of IMPORT_FILES of an import ID", () => {
    expect(importFileOf("/imports/mg7x1-0a1b2c3d/preview.glb")).toEqual({ id: "mg7x1-0a1b2c3d", file: "preview.glb" });
    expect(importFileOf("/imports/mg7x1-0a1b2c3d/source")).toBeNull();
    expect(importFileOf("/imports/../x/record.json")).toBeNull();
  });

  test("the bridge event of a drop carries the file", () => {
    const event = {
      workbench: 1,
      event: "import",
      drop: "d",
      file: new Blob([GLB]),
      name: "a.glb",
      point: null,
      source: "",
      licence: "",
    };
    expect(isBridgeEvent(event)).toBe(true);
    expect(isBridgeEvent({ ...event, file: "bytes" })).toBe(false);
    // The desktop path: the event of a drop of the shell has no file (the page keeps its path).
    expect(isBridgeEvent({ ...event, file: null })).toBe(true);
    expect(isBridgeEvent({ ...event, file: undefined })).toBe(false);
  });
});

describe("the path of a desktop drop", () => {
  const home = join(dir, "home");
  const outside = join(dir, "outside");
  mkdirSync(join(home, "models"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(home, "models", "sofa.fbx"), "fbx");
  writeFileSync(join(outside, "sofa.fbx"), "fbx");
  writeFileSync(join(home, "models", "id_rsa.obj"), "secret");
  writeFileSync(join(home, ".env.glb"), "secret");
  symlinkSync(join(home, ".env.glb"), join(home, "models", "link.glb"));

  test("a file in the home folder passes with its real path and size", () => {
    expect(checkDropPath(join(home, "models", "sofa.fbx"), home)).toEqual({
      path: join(home, "models", "sofa.fbx"),
      bytes: 3,
    });
  });

  test("refuses a relative path, a file outside the home, a link, the denylist and another format", () => {
    expect(() => checkDropPath("models/sofa.fbx", home)).toThrow("absolute");
    expect(() => checkDropPath(join(outside, "sofa.fbx"), home)).toThrow("home folder");
    expect(() => checkDropPath(join(home, "models", "link.glb"), home)).toThrow("a link");
    expect(() => checkDropPath(join(home, "models", "id_rsa.obj"), home)).toThrow("denylist");
    expect(() => checkDropPath(join(home, ".env.glb"), home)).toThrow("denylist");
    expect(() => checkDropPath(join(home, "models"), home)).toThrow("not a format");
    expect(() => checkDropPath(join(home, "none.glb"), home)).toThrow("No file");
  });

  test("a path import starts the job on the file where it is", async () => {
    const { spawn, runs } = fakeSpawner();
    const checkout = join(dir, "checkout-path");
    mkdirSync(join(checkout, WEB_DIR), { recursive: true });
    const jobs = new ImportJobs({
      stateDir: join(dir, "state-path"),
      runs: new RunManager({ emit: () => undefined, spawn, outputBatchMs: 0 }),
      checkout: () => checkout,
      home,
      bun: "bun",
    });
    const body = { path: join(home, "models", "sofa.fbx"), point: [1, 0, 2], source: "vendor", licence: "store" };
    const response = await jobs.http(
      new Request("http://h/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      new URL("http://h/imports"),
    );
    const started = (await response?.json()) as ImportStarted;
    expect(started.name).toBe("sofa.fbx");
    const request = JSON.parse(
      readFileSync(join(jobs.folder, started.id, "request.json"), "utf8"),
    ) as ImportRequestFile;
    expect(request).toMatchObject({
      origin: "path",
      input: join(home, "models", "sofa.fbx"),
      point: [1, 0, 2],
      bytes: 3,
    });
    expect(runs[0]?.argv).toEqual(["bun", importJob(), "--request", join(jobs.folder, started.id, "request.json")]);
    const refused = await jobs.http(
      new Request("http://h/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: join(outside, "sofa.fbx") }),
      }),
      new URL("http://h/imports"),
    );
    expect(refused?.status).toBe(400);
  });

  test("a host without the picture of the job gives the job --no-picture (the e2e host)", async () => {
    const { spawn, runs } = fakeSpawner();
    const checkout = join(dir, "checkout-nopic");
    mkdirSync(join(checkout, WEB_DIR), { recursive: true });
    const jobs = new ImportJobs({
      stateDir: join(dir, "state-nopic"),
      runs: new RunManager({ emit: () => undefined, spawn, outputBatchMs: 0 }),
      checkout: () => checkout,
      home,
      bun: "bun",
      picture: false,
    });
    const response = await jobs.http(
      new Request("http://h/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: join(home, "models", "sofa.fbx") }),
      }),
      new URL("http://h/imports"),
    );
    const started = (await response?.json()) as ImportStarted;
    const request = join(jobs.folder, started.id, "request.json");
    expect(runs[0]?.argv).toEqual(["bun", importJob(), "--request", request, "--no-picture"]);
  });
});

describe("the upload through a host (the browser path)", () => {
  test("a dropped GLB reaches the host with its drop point and starts a run of the Runs tab", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("imports-state");
    made.push(parent, state);
    const { spawn, runs } = fakeSpawner();
    const token = "44".repeat(32);
    const host = await startHost({
      checkout: repo,
      stateDir: state,
      token,
      serverCommand: fakeCommand,
      watch: false,
      runSpawn: spawn,
    });
    const page = await FakePage.open(host.endpoint);
    try {
      const query = importQuery({
        name: "box.glb",
        point: [0.25, 0, 1.5],
        source: "made by me",
        licence: "CC0-1.0",
        drop: "drop-1",
      });
      const post = (body: BodyInit, withToken = true) =>
        fetch(`${host.endpoint.origin}/imports?${query}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", ...(withToken ? { "x-workbench-token": token } : {}) },
          body,
        });
      expect((await post(GLB, false)).status).toBe(401);
      const answer = await post(GLB);
      expect(answer.status).toBe(200);
      const started = (await answer.json()) as ImportStarted;
      expect(started).toMatchObject({ name: "box.glb", point: [0.25, 0, 1.5], drop: "drop-1" });
      const folder = join(state, "imports", started.id);
      expect(new Uint8Array(readFileSync(join(folder, "source", "box.glb")))).toEqual(GLB);
      const request = JSON.parse(readFileSync(join(folder, "request.json"), "utf8")) as ImportRequestFile;
      expect(request).toMatchObject({
        version: 1,
        origin: "upload",
        point: [0.25, 0, 1.5],
        source: "made by me",
        licence: "CC0-1.0",
        bytes: GLB.length,
      });
      expect(request.pictureDir).toBe(join(repo, WEB_DIR, builtInRunCatalog().outRoot, `import-${started.id}`));
      // The job runs in the root of the checkout, as a run of the host.
      expect(runs[0]?.options.cwd).toBe(join(repo, WEB_DIR));
      expect(host.runs.info(started.run)?.command).toBe("import");
      writeFileSync(join(folder, "record.json"), '{"ok":1}');
      runs[0]?.end(0);
      const done = await page.waitEvent((event) => isEventOf(event, "runs.done"));
      expect(done).toMatchObject({ run: started.run, code: 0 });
      const record = await fetch(`${host.endpoint.origin}/imports/${started.id}/record.json`, {
        headers: { "x-workbench-token": token },
      });
      expect(await record.text()).toBe('{"ok":1}');
      const missing = await fetch(`${host.endpoint.origin}/imports/${started.id}/sheet.png`, {
        headers: { "x-workbench-token": token },
      });
      expect(missing.status).toBe(404);
      const empty = await post(new Uint8Array(0));
      expect(empty.status).toBe(400);
    } finally {
      page.close();
      await host.stop();
    }
  });

  test("a body above 200 MB gets 413 and leaves no folder", async () => {
    const { spawn } = fakeSpawner();
    const jobs = new ImportJobs({
      stateDir: join(dir, "state-big"),
      runs: new RunManager({ emit: () => undefined, spawn }),
      checkout: () => dir,
    });
    const url = new URL(
      `http://h/imports?${importQuery({ name: "big.glb", point: null, source: "", licence: "", drop: "" })}`,
    );
    const declared = await jobs.http(
      new Request(url, { method: "POST", headers: { "content-length": String(201 * 1024 * 1024) }, body: GLB }),
      url,
    );
    expect(declared?.status).toBe(413);
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 210 * 1024 * 1024) controller.close();
        else {
          sent += chunk.length;
          controller.enqueue(chunk);
        }
      },
    });
    const streamed = await jobs.http(new Request(url, { method: "POST", body: stream }), url);
    expect(streamed?.status).toBe(413);
    expect(existsSync(jobs.folder) ? readdirSync(jobs.folder) : []).toEqual([]);
  });
});
