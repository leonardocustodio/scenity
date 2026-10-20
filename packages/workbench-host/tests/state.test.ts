// SPDX-License-Identifier: Apache-2.0
/** Tests of the state folder: the default folder and the JSON round trip. */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HostState,
  checkoutHash,
  defaultStateDir,
  moveOldStateDir,
  readJsonObject,
  writeJsonAtomic,
} from "../src/state";
import { cleanup, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const dir = tempDir("state");
afterAll(() => cleanup(dir));

describe("the state folder", () => {
  test("the default folder is in Application Support on macOS", () => {
    const hash = checkoutHash("/repo");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(defaultStateDir("/repo", "darwin", "/Users/me")).toBe(
      `/Users/me/Library/Application Support/org.scenity.editor/host/${hash}`,
    );
    expect(defaultStateDir("/repo", "linux", "/home/me", {})).toBe(
      `/home/me/.local/state/org.scenity.editor/host/${hash}`,
    );
    expect(defaultStateDir("/repo", "linux", "/home/me", { XDG_STATE_HOME: "/s" })).toBe(
      `/s/org.scenity.editor/host/${hash}`,
    );
    expect(checkoutHash("/other")).not.toBe(hash);
  });

  test("a host moves the state folder of the old app identifier to the new one", () => {
    const old = join(dir, "move", "org.codeblue.labs", "host", "abc");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "checkouts.json"), '{"current":"/repo"}');
    const moved = join(dir, "move", "org.scenity.editor", "host", "abc");
    moveOldStateDir(moved);
    expect(existsSync(old)).toBe(false);
    expect(readJsonObject(join(moved, "checkouts.json"))).toEqual({ current: "/repo" });
    // A folder that exists already stays as it is, and a folder of another name is not moved.
    mkdirSync(old, { recursive: true });
    moveOldStateDir(moved);
    expect(existsSync(old)).toBe(true);
    moveOldStateDir(join(dir, "move", "other", "host", "abc"));
    expect(existsSync(join(dir, "move", "other"))).toBe(false);
  });

  test("an atomic write leaves no temporary file", () => {
    const path = join(dir, "x.json");
    writeJsonAtomic(path, { a: 1 });
    writeJsonAtomic(path, { a: 2 });
    expect(readJsonObject(path)).toEqual({ a: 2 });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("a bad or absent file reads as an empty object", () => {
    writeFileSync(join(dir, "bad.json"), "{ nope");
    expect(readJsonObject(join(dir, "bad.json"))).toEqual({});
    expect(readJsonObject(join(dir, "absent.json"))).toEqual({});
  });

  test("the checkouts, the surface URLs and the sessions come back after a restart", () => {
    const folder = join(dir, "host");
    const state = new HostState(folder);
    expect(state.currentCheckout()).toBeNull();
    state.openCheckout("/a");
    state.openCheckout("/b");
    state.openCheckout("/a");
    state.setSurfaceUrl("/a", "lab", "http://127.0.0.1:1/?t=5");
    state.setSurfaceUrl("/a", "other", "http://127.0.0.1:2/");
    state.setSurfaceUrl("/a", "other", null);
    state.addSession("/a", "s1");
    state.addSession("/a", "s2");
    state.addSession("/a", "s1");

    const again = new HostState(folder);
    expect(again.currentCheckout()).toBe("/a");
    expect(again.knownCheckouts()).toEqual(["/a", "/b"]);
    expect(again.surfaceUrls("/a")).toEqual({ lab: "http://127.0.0.1:1/?t=5" });
    expect(again.surfaceUrls("/b")).toEqual({});
    expect(again.sessions("/a")).toEqual(["s1", "s2"]);
    expect(JSON.parse(readFileSync(join(folder, "checkouts.json"), "utf8"))).toEqual({
      current: "/a",
      known: ["/a", "/b"],
    });
  });
});
