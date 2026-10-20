// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the two write styles of an edit. An in-place write is the Edit tool, `python open(…, "w")` or `patch` on
 * macOS. A rename-replace writes a temporary file and renames it over the file: `sed -i`, `os.replace`, many editors.
 * The file watcher of the host sees the edited file in both styles. The edit time of the HMR wait follows the rename
 * (the status change time). A wait without an update touches the file once, so that a dev server that missed the edit
 * sees it again (not while the page reloads). A check of the same styles against the Vite server of the lab
 * (2026-10-12) showed that Vite sees each of them too.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EditWatcher } from "../src/edits";
import { fileTime, HmrTracker, touchFile } from "../src/hmr";
import { cleanup, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const folder = tempDir("write-styles");
afterAll(() => cleanup(folder));

/** Write the file in place (truncate and write). */
function inPlace(file: string, text: string): void {
  writeFileSync(file, text);
}

/** Write a temporary file with an old modification time and rename it over the file. */
function renameReplace(file: string, text: string): void {
  const temporary = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(temporary, text);
  utimesSync(temporary, 1, 1);
  renameSync(temporary, file);
}

/** `sed -i` of macOS (BSD sed writes a temporary file and renames it). */
function sedInPlace(file: string, text: string): void {
  const script = `s/${readFileSync(file, "utf8").trim()}/${text.trim()}/`;
  const inPlaceFlag = process.platform === "darwin" ? ["-i", ""] : ["-i"];
  execFileSync("sed", [...inPlaceFlag, script, file]);
}

const STYLES = [
  ["an in-place write", inPlace],
  ["a rename-replace", renameReplace],
  ["sed -i", sedInPlace],
] as const;

describe("the file watcher and the HMR wait for each write style", () => {
  test.each(STYLES)(
    "%s: the watcher sees the file, and only a later update resolves the wait",
    async (_name, write) => {
      const file = join(folder, `family-${_name.replace(/\W+/g, "-")}.ts`);
      writeFileSync(file, "alpha\n");
      const watcher = new EditWatcher([folder], { debounceMs: 20 });
      watcher.start();
      try {
        await Bun.sleep(100);
        const before = Date.now();
        write(file, "bravo\n");
        await until(() => (watcher.lastEdit(file) ?? 0) >= before - 5, 3_000, "the watcher event of the file");
        expect(readFileSync(file, "utf8")).toBe("bravo\n");
        // The edit time follows the write, also after a rename with an old modification time.
        expect(fileTime(file)).toBeGreaterThanOrEqual(before - 5);
        const tracker = new HmrTracker({
          checkout: folder,
          appRoot: folder,
          lastEdit: (path) => watcher.lastEdit(path),
          nudgeMs: 0,
        });
        // An update before the edit does not resolve the wait.
        const stale = new HmrTracker({
          checkout: folder,
          appRoot: folder,
          lastEdit: () => null,
          now: () => before - 1_000,
          nudgeMs: 0,
        });
        stale.hmr([file]);
        let error = "";
        await stale.wait(file, 50).catch((reason: unknown) => (error = String(reason)));
        expect(error).toContain("applied no update");
        const wait = tracker.wait(file, 2_000);
        tracker.hmr(["/other.ts"]);
        expect((await wait).files).toEqual([join(folder, "other.ts")]);
      } finally {
        watcher.stop();
      }
    },
  );
});

describe("the nudge of a missed edit", () => {
  test("a wait without an update touches the file once; the touch gives the dev server a change", async () => {
    const file = join(folder, "missed.ts");
    writeFileSync(file, "x\n");
    const nudged: string[] = [];
    const tracker = new HmrTracker({
      checkout: folder,
      appRoot: folder,
      lastEdit: () => null,
      nudge: (path) => {
        nudged.push(path);
        // The dev server sees the touch and sends its update.
        tracker.hmr([path]);
      },
      nudgeMs: 30,
    });
    const record = await tracker.wait("missed.ts", 2_000);
    expect(nudged).toEqual([file]);
    expect(record.files).toEqual([file]);
    const old = statSync(file).mtimeMs;
    await Bun.sleep(5);
    touchFile(file);
    expect(statSync(file).mtimeMs).toBeGreaterThan(old);
    touchFile(join(folder, "absent.ts"));
  });

  test("no nudge while the page reloads: the ready of the new page shows the edit", async () => {
    const file = join(folder, "worker.ts");
    writeFileSync(file, "x\n");
    const nudged: string[] = [];
    const tracker = new HmrTracker({
      checkout: folder,
      appRoot: folder,
      lastEdit: () => null,
      nudge: (path) => nudged.push(path),
      nudgeMs: 20,
    });
    tracker.reload();
    const wait = tracker.wait(file, 2_000);
    await Bun.sleep(60);
    expect(nudged).toEqual([]);
    tracker.ready();
    expect((await wait).reloaded).toBe(true);
  });
});
