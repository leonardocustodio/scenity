// SPDX-License-Identifier: Apache-2.0
// The studio state folder: the JSON files with their schemas, the atomic writes, the secret mode and the move of the
// browser keys into the user state.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { JsonFile, studioStateDir } from "../src/store";
import { defaultPreferences, importBrowserState, UserState } from "../src/userState";

const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "studio-state-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the studio state folder", () => {
  test("is beside the host folders of the app", () => {
    expect(studioStateDir("darwin", "/home/a")).toBe("/home/a/Library/Application Support/org.scenity.editor/studio");
    expect(studioStateDir("linux", "/home/a", {})).toBe("/home/a/.local/state/org.scenity.editor/studio");
    expect(studioStateDir("linux", "/home/a", { XDG_STATE_HOME: "/x" })).toBe("/x/org.scenity.editor/studio");
  });

  test("a JSON file gives the default for a missing or bad file, and checks a write", () => {
    const file = join(temp(), "a.json");
    const store = new JsonFile(file, z.object({ n: z.number() }), () => ({ n: 1 }));
    expect(store.read()).toEqual({ n: 1 });
    writeFileSync(file, "{ not json");
    expect(store.read()).toEqual({ n: 1 });
    store.write({ n: 5 });
    expect(store.read()).toEqual({ n: 5 });
    expect(() => store.write({ n: "x" } as never)).toThrow();
    expect(store.update((v) => ({ n: v.n + 1 }))).toEqual({ n: 6 });
  });

  test("a secret file has the mode 600", () => {
    const file = join(temp(), "secret.json");
    new JsonFile(file, z.object({ s: z.string() }), () => ({ s: "" }), true).write({ s: "x" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("the user state starts with the defaults", () => {
    const state = new UserState(temp());
    expect(state.preferences.read()).toEqual(defaultPreferences());
    expect(state.preferences.read().agent.mode).toBe("review");
    expect(state.registry.read().projects).toEqual([]);
  });

  test("the browser keys move in once", () => {
    const state = new UserState(temp());
    const entries = {
      "scenity.editor.user": JSON.stringify({ "view.grid": false }),
      "scenity.keymap.user": JSON.stringify({ format: "scenity.keymap/1", keys: { "view.frame": ["G"] } }),
      "scenity.scene.layout.showroom": JSON.stringify({ left: 300 }),
      "other.key": "1",
    };
    const moved = importBrowserState(state, entries);
    expect(moved.sort()).toEqual(["scenity.editor.user", "scenity.keymap.user", "scenity.scene.layout.showroom"]);
    expect(state.preferences.read().editor["view.grid"]).toBe(false);
    expect(state.keymap.read().keys["view.frame"]).toEqual(["G"]);
    expect(state.layouts.read().scopes["legacy:showroom"]).toEqual({ left: 300 });
    // A second import moves nothing and keeps the values of the studio.
    state.keymap.update((k) => ({ ...k, keys: { "view.frame": ["H"] } }));
    expect(importBrowserState(state, entries)).toEqual([]);
    expect(state.keymap.read().keys["view.frame"]).toEqual(["H"]);
    const saved = JSON.parse(readFileSync(state.preferences.file, "utf8")) as { importedKeys: string[] };
    expect(saved.importedKeys).toHaveLength(3);
  });
});
