// SPDX-License-Identifier: Apache-2.0
// Autosave and recovery: the drafts in the browser and on the host. The newer draft wins, and a draft of the host only
// comes back. Also the drafts file of the dev server, and the autosave of the project.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "@scenity/editor-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDrafts, writeDraft } from "../../scripts/draftsApi";
import { startAutosave } from "../../src/scene/drafts/autosave";
import { HostDraftStorage } from "../../src/scene/drafts/hostDrafts";

const KEY = "scenity.sceneDraft.demo:scenes/main.scene.json";
const draft = (savedMs: number): string =>
  JSON.stringify({
    format: "scenity.sceneDraft/1",
    path: "scenes/main.scene.json",
    baseHash: null,
    text: "{}",
    savedMs,
  });

/** A browser storage in a map. */
function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the drafts of the host", () => {
  it("gives a draft of the host that the browser does not have, and the newer draft of the two", async () => {
    const posts: unknown[] = [];
    const fetcher = (input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") posts.push(JSON.parse(typeof init.body === "string" ? init.body : "{}"));
      const body = input.endsWith("drafts.json") ? { drafts: { [KEY]: draft(2000) } } : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
    const local = memory();
    const storage = new HostDraftStorage(local, "/projects/demo/", fetcher);
    expect(await storage.ready).toBe(true);
    expect(storage.getItem(KEY)).toBe(draft(2000));
    // A newer draft of the browser wins; a write goes to the host after 300 ms.
    vi.useFakeTimers();
    storage.setItem(KEY, draft(3000));
    expect(storage.getItem(KEY)).toBe(draft(3000));
    expect(posts).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(posts).toEqual([{ key: KEY, value: draft(3000) }]);
    storage.removeItem(KEY);
    storage.flush();
    expect(posts.at(-1)).toEqual({ key: KEY, value: null });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("works on with no host", async () => {
    const storage = new HostDraftStorage(memory(), "/projects/demo/", () => Promise.reject(new Error("offline")));
    expect(await storage.ready).toBe(false);
    storage.setItem(KEY, draft(1));
    expect(storage.getItem(KEY)).toBe(draft(1));
  });

  it("keeps the drafts in the project folder and refuses another key", () => {
    const dir = mkdtempSync(join(tmpdir(), "scenity-drafts-"));
    try {
      expect(writeDraft(dir, KEY, draft(5))).toBeNull();
      expect(readDrafts(dir)).toEqual({ [KEY]: draft(5) });
      expect(writeDraft(dir, "scenity.other", "x")).toContain("key");
      expect(writeDraft(dir, KEY, null)).toBeNull();
      expect(readDrafts(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the autosave of the project", () => {
  it("saves a dirty scene after the seconds with no edit, only when the project turns it on", () => {
    vi.useFakeTimers();
    let settings: EditorSettings = DEFAULT_EDITOR_SETTINGS;
    const listeners: (() => void)[] = [];
    const settingsListeners: (() => void)[] = [];
    const state = { dirty: true, playing: false, saves: 0 };
    const stop = startAutosave({
      listen: (listener) => (listeners.push(listener), () => undefined),
      get dirty() {
        return state.dirty;
      },
      playing: () => state.playing,
      save: () => {
        state.saves += 1;
        return Promise.resolve();
      },
      settings: () => settings,
      listenSettings: (listener) => (settingsListeners.push(listener), () => undefined),
    });
    vi.advanceTimersByTime(60_000);
    expect(state.saves).toBe(0);
    settings = { ...DEFAULT_EDITOR_SETTINGS, autosave: { enabled: true, seconds: 10 } };
    for (const tell of settingsListeners) tell();
    vi.advanceTimersByTime(9_000);
    // An edit waits again for 10 s with no edit.
    for (const tell of listeners) tell();
    vi.advanceTimersByTime(9_000);
    expect(state.saves).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(state.saves).toBe(1);
    state.playing = true;
    for (const tell of listeners) tell();
    vi.advanceTimersByTime(10_000);
    expect(state.saves).toBe(1);
    stop();
  });
});

describe("the format upgrade", () => {
  it("offers the upgrade of the old scene fixture with the diff of its text", async () => {
    const { readFileSync } = await import("node:fs");
    const { readDocument, writeDocument } = await import("@scenity/scene");
    const { lineDiff, upgradeOffer } = await import("../../src/scene/drafts/formatUpgrade");
    const text = readFileSync(
      join(__dirname, "../../../../packages/scene/tests/fixtures/legacy.v0.scene.json"),
      "utf8",
    );
    expect(upgradeOffer(text)).toEqual({ from: "scenity.scene/0", to: "scenity.scene/1" });
    const read = readDocument(text, "scene");
    if (!read.ok) throw new Error("the fixture does not read");
    const lines = lineDiff(text, writeDocument(read.doc));
    expect(lines).toContain('+   "format": "scenity.scene/1",');
    expect(lines.some((line) => line.startsWith("- ") && line.includes('"background"'))).toBe(true);
    expect(upgradeOffer(writeDocument(read.doc))).toBeNull();
    expect(upgradeOffer("not json")).toBeNull();
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual(["+ x", "- b"]);
    expect(lineDiff("a", "a")).toEqual([]);
  });
});
