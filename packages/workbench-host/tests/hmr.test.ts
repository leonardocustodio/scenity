// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of HMR in the loop, the host half: the HMR record of a surface, the file watcher
 * fallback, and `waitForHmr` through a running host with a fake page.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EditWatcher, watchRoots, type Edit } from "../src/edits";
import { HmrTracker, hmrFilePath } from "../src/hmr";
import { startHost } from "../src/host";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const CHECKOUT = "/co";
const APP = "/co/apps/editor";
const FAMILY = "/co/plugins/demo/room/src/families/wave_hello.ts";
const folders: string[] = [];
afterAll(() => cleanup(...folders));

function tracker(edits: Map<string, number>, clock: { now: number }): HmrTracker {
  return new HmrTracker({
    checkout: CHECKOUT,
    appRoot: APP,
    lastEdit: (file) => edits.get(file) ?? null,
    now: () => clock.now,
  });
}

describe("the file names of an hmr event", () => {
  test("Vite URL paths, relative paths and absolute paths give absolute paths", () => {
    expect(hmrFilePath("/src/core/Room3DLab.vue?t=17", APP, CHECKOUT)).toBe(`${APP}/src/core/Room3DLab.vue`);
    expect(hmrFilePath(`/@fs${FAMILY}`, APP, CHECKOUT)).toBe(FAMILY);
    expect(hmrFilePath("src/x.ts", APP, CHECKOUT)).toBe(`${APP}/src/x.ts`);
    expect(hmrFilePath(FAMILY, APP, CHECKOUT)).toBe(FAMILY);
  });
});

describe("the HMR record", () => {
  test("an hmr event that names the file resolves the wait", async () => {
    const clock = { now: 1000 };
    const hmr = tracker(new Map(), clock);
    const wait = hmr.wait(FAMILY, 1000);
    clock.now = 1100;
    hmr.hmr(["/src/other.ts"]);
    clock.now = 1200;
    hmr.hmr([`/@fs${FAMILY}`]);
    expect(await wait).toEqual({ files: [FAMILY], at: 1200, reloaded: false });
    expect(hmr.last?.at).toBe(1200);
  });

  test("with an edit time from the watcher, any update after the edit resolves, also one before the wait", async () => {
    const clock = { now: 1000 };
    const edits = new Map([[FAMILY, 1000]]);
    const hmr = tracker(edits, clock);
    clock.now = 1050;
    hmr.hmr(["/src/core/Room3DLab.vue"]);
    expect((await hmr.wait(FAMILY, 100)).at).toBe(1050);
    expect((await hmr.wait("plugins/demo/room/src/families/wave_hello.ts", 100)).at).toBe(1050);
    edits.set(FAMILY, 2000);
    await rejectsWith(hmr.wait(FAMILY, 30), "applied no update");
  });

  test("a reload and the next ready resolve the wait as a reload", async () => {
    const clock = { now: 1000 };
    const hmr = tracker(new Map([[FAMILY, 900]]), clock);
    const wait = hmr.wait(FAMILY, 1000);
    clock.now = 1100;
    hmr.reload();
    clock.now = 1900;
    hmr.ready();
    expect(await wait).toEqual({ files: [], at: 1100, reloaded: true });
  });

  test("a wait since a time takes the first update after it; cancel rejects the waits", async () => {
    const clock = { now: 1000 };
    const hmr = tracker(new Map(), clock);
    const wait = hmr.wait({ since: 1500 }, ciWaitMs(1000));
    hmr.hmr(["/src/a.ts"]);
    clock.now = 1600;
    hmr.hmr(["/src/b.ts"]);
    expect((await wait).files).toEqual([`${APP}/src/b.ts`]);
    const open = hmr.wait({ since: 5000 }, ciWaitMs(1000));
    hmr.cancel("closed");
    await rejectsWith(open, "closed");
  });
});

describe("the file watcher", () => {
  test("it finds the lab, engine and plugin sources of a checkout", () => {
    const checkout = tempDir("roots");
    folders.push(checkout);
    const sources = [
      "apps/editor/src",
      "plugins/demo/room/src",
      "packages/legacy/src",
      "packages/character/src",
      "packages/render/src",
      "packages/view-vue/src",
      "packages/ui/src",
    ];
    for (const folder of sources) mkdirSync(join(checkout, folder), { recursive: true });
    expect(watchRoots(checkout).map((root) => root.slice(checkout.length + 1))).toEqual([
      "apps/editor/src",
      "packages/character/src",
      "packages/render/src",
      "packages/view-vue/src",
      "plugins/demo/room/src",
    ]);
  });

  test("it records each edit at once and calls the listener once per burst", async () => {
    const root = tempDir("watch");
    folders.push(root);
    mkdirSync(join(root, "deep"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const watcher = new EditWatcher([root], { debounceMs: 80 });
    const seen: Edit[] = [];
    watcher.onEdit((edit) => seen.push(edit));
    watcher.start();
    await Bun.sleep(100);
    const file = join(root, "deep", "a.ts");
    writeFileSync(file, "1");
    writeFileSync(file, "2");
    writeFileSync(join(root, "node_modules", "x.js"), "1");
    await until(() => seen.length > 0, 3000, "the edit");
    await Bun.sleep(150);
    watcher.stop();
    expect(seen.map((edit) => edit.file)).toEqual([file]);
    expect(watcher.lastEdit(file)).toBeGreaterThan(0);
    expect(watcher.lastEdit(join(root, "node_modules", "x.js"))).toBeNull();
    expect(watcher.latest()?.file).toBe(file);
  });
});

describe("waitForHmr through the host", () => {
  test("an edit, then an hmr event of the page, resolve the wait and set the last edit", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("hmr-state");
    folders.push(parent, state);
    const src = join(repo, "apps/editor/src");
    mkdirSync(src, { recursive: true });
    const host = await startHost({
      checkout: repo,
      stateDir: state,
      token: "22".repeat(32),
      serverCommand: fakeCommand,
    });
    const page = await FakePage.open(host.endpoint);
    try {
      const report = (event: object) => page.call("surface.report", { surface: "lab", where: "visible", event });
      await Bun.sleep(100);
      const lab = host.surface("lab");
      const file = join(src, "tunables.ts");
      writeFileSync(file, "export const y = -0.004;\n");
      await until(() => host.surfaces.ids().length > 0 && lab.state.lastEdit === null, 1000, "the surface");
      const wait = lab.waitForHmr(file, 3000);
      await Bun.sleep(150);
      await report({ workbench: 1, event: "hmr", files: ["/src/tunables.ts"] });
      const record = await wait;
      expect(record.reloaded).toBe(false);
      expect(lab.lastHmr).toEqual(record);
      expect(lab.state.lastEdit).toMatchObject({ file: "apps/editor/src/tunables.ts", reloaded: false });

      await Bun.sleep(5);
      const since = Date.now();
      const reload = lab.waitForHmr({ since }, ciWaitMs(3000));
      await report({ workbench: 1, event: "reload", url: "http://127.0.0.1:1/?t=5" });
      await report({ workbench: 1, event: "ready", url: "http://127.0.0.1:1/?t=5" });
      expect((await reload).reloaded).toBe(true);
      expect(lab.state.lastEdit?.reloaded).toBe(true);
    } finally {
      page.close();
      await host.stop();
    }
  });
});
