// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the order of the two HMR sources. Vite can report the update before the file watcher sees the edit, or
 * after it. `waitForHmr(file)` takes the time of the file (the later of its modification and status change times) as
 * the edit time. Thus it resolves in either order, also for an update that came before the call. The clock of the
 * test starts at that time (`base`).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileTime, HmrTracker } from "../src/hmr";
import { cleanup, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const folders: string[] = [];
afterAll(() => cleanup(...folders));

/** A tracker on a real checkout folder with a clock of the test and a watcher map. */
function setup(): {
  file: string;
  base: number;
  clock: { now: number };
  edits: Map<string, number>;
  hmr: HmrTracker;
} {
  const checkout = tempDir("hmr-order");
  folders.push(checkout);
  const file = join(checkout, "family.ts");
  writeFileSync(file, "export const a = 1;\n");
  // The time of the write; the clock of the test starts there.
  const base = fileTime(file) ?? 0;
  const clock = { now: base };
  const edits = new Map<string, number>();
  const hmr = new HmrTracker({
    checkout,
    appRoot: join(checkout, "app"),
    lastEdit: (path) => edits.get(path) ?? null,
    now: () => clock.now,
  });
  return { file, base, clock, edits, hmr };
}

describe("the order of Vite and the file watcher", () => {
  test("the edit time is the later of the modification and the status change times", () => {
    const { file } = setup();
    // An old modification time (a rename keeps the time of the temporary file): the status change time is now.
    utimesSync(file, 10, 10);
    expect(fileTime(file)).toBeGreaterThan(Date.now() - 60_000);
    expect(fileTime(`${file}.absent`)).toBeNull();
  });

  test("Vite first, then the watcher, then the wait: the past update resolves the wait", async () => {
    const { file, base, clock, edits, hmr } = setup();
    clock.now = base + 40;
    hmr.hmr(["/src/core/Room3DLab.vue"]);
    // The watcher sees the edit 60 ms after Vite.
    edits.set(file, base + 100);
    clock.now = base + 200;
    const started = Date.now();
    expect((await hmr.wait(file, 2_000)).at).toBe(base + 40);
    expect(Date.now() - started).toBeLessThan(100);
  });

  test("Vite first, then the wait, then the watcher: the wait resolves at once", async () => {
    const { file, base, clock, edits, hmr } = setup();
    clock.now = base + 30;
    hmr.hmr([file]);
    clock.now = base + 50;
    const wait = hmr.wait(file, 2_000);
    edits.set(file, base + 90);
    expect((await wait).at).toBe(base + 30);
  });

  test("the watcher first, then the wait, then Vite: the wait resolves at the update", async () => {
    const { file, base, clock, edits, hmr } = setup();
    edits.set(file, base + 10);
    clock.now = base + 20;
    const wait = hmr.wait(file, 2_000);
    clock.now = base + 300;
    hmr.hmr(["/src/other.ts"]);
    expect((await wait).at).toBe(base + 300);
  });

  test("an update before the edit does not resolve the wait", async () => {
    const { file, base, clock, hmr } = setup();
    clock.now = base - 1000;
    hmr.hmr(["/src/old.ts"]);
    clock.now = base + 100;
    let error = "";
    await hmr.wait(file, 50).catch((reason: unknown) => (error = String(reason)));
    expect(error).toContain("applied no update");
  });
});
