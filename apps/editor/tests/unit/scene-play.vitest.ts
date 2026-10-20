// SPDX-License-Identifier: Apache-2.0
// The play mode of the scene page. The controller keeps the edit state (the documents, the time, the selection) and
// plays from 0 ms. Stop gives the edit state back. The file bar shows the dirty state of the edit state. The editor
// keeps no draft and refuses a save during the play mode. Keep is one undo step. The tests also cover the play control
// and the handoff of the play window with the input recording. The showroom files are read only (no save here).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneDraftKey, SceneDrafts, type DraftStorage } from "@scenity/editor-core";
import type { SceneOp } from "@scenity/scene";
import { HANDOFF_FORMAT, readHandoff, writeHandoff } from "../../src/player/handoff";
import type { InputRecording } from "@scenity/scene/sequence";
import { PagePlay, type PlayParts } from "../../src/scene/play/pagePlay";
import type { PlayInput } from "../../src/scene/play/playInput";
import { playBar } from "../../src/scene/play/playBar";
import { parseScene } from "../../src/scene/project";
import { sceneBar } from "../../src/scene/sceneBar";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import type { PageTime } from "../../src/scene/sequencer/pageSequence";

const PATH = "scenes/main.scene.json";
const TEXT = readFileSync(join(import.meta.dirname, "../../../../samples/showroom", PATH), "utf8");
const TABLE = "/entities/table/components/transform/position";
const MOVE: SceneOp[] = [{ op: "set", path: TABLE, value: [0, 0, 0] }];

function memory(): DraftStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** A clock of the page that records its calls. */
function fakeTime(start: number): PageTime & { readonly calls: string[] } {
  const state = { t: start, playing: false };
  const calls: string[] = [];
  return {
    calls,
    now: () => state.t,
    playing: () => state.playing,
    seek: (t) => {
      calls.push(`seek ${String(t)}`);
      state.t = t;
      state.playing = false;
    },
    play: () => {
      calls.push("play");
      state.playing = true;
    },
    pause: () => {
      state.playing = false;
    },
  };
}

function setup(extra: Partial<PlayParts> = {}) {
  const storage = memory();
  const editor = new ScenePageEditor({
    patch: () => Promise.resolve({ ok: true, warnings: [] }),
    doc: parseScene(TEXT),
    path: PATH,
    diskText: TEXT,
    files: { read: () => Promise.reject(new Error("no read")), save: () => Promise.reject(new Error("no save")) },
    drafts: new SceneDrafts(storage, sceneDraftKey("showroom", PATH), PATH),
    bar: sceneBar(PATH, () => undefined),
  });
  const time = fakeTime(1500);
  const selected = { ids: ["table"] as readonly string[] };
  const selection = { ids: selected.ids, set: (ids: readonly string[]) => void (selected.ids = ids) };
  Object.defineProperty(selection, "ids", { get: () => selected.ids });
  const play = new PagePlay({
    editor,
    project: "showroom",
    camera: () => "front",
    time,
    sequence: null,
    selection,
    ...extra,
  });
  return { editor, play, time, selected, storage };
}

const testId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.play;
});

describe("the play mode of the scene page", () => {
  it("plays from 0 ms on the play state, and stop gives back the documents, the time and the selection", async () => {
    const { editor, play, time, selected, storage } = setup();
    const edit = editor.doc;
    expect(play.start()).toBeNull();
    expect(document.body.dataset.play).toBe("1");
    expect(time.calls).toEqual(["seek 0", "play"]);
    expect(editor.apply(MOVE, "Move in the play mode")).toBeNull();
    selected.ids = ["ottoman"];
    // The file bar shows the edit state: not dirty, no draft, and no save.
    expect(editor.dirty).toBe(false);
    expect(testId("scene-bar")?.dataset.dirty).toBe("0");
    expect(storage.items.size).toBe(0);
    expect(await editor.save()).toMatchObject({ ok: false, reason: "Stop the play mode before a save." });
    expect(play.changes().map((change) => change.id)).toEqual(["table/transform"]);
    play.stop();
    expect(editor.doc).toBe(edit);
    expect(editor.dirty).toBe(false);
    expect(document.body.dataset.play).toBeUndefined();
    expect(time.calls.slice(2)).toEqual(["seek 1500"]);
    expect(selected.ids).toEqual(["table"]);
    expect(editor.channel.undo()).toBe(false);
  });

  it("keeps the chosen changes as one undo step", () => {
    const { editor, play } = setup();
    const edit = editor.doc;
    play.start();
    editor.apply(MOVE, "Move in the play mode");
    expect(play.keep(["table/transform"])).toBe(true);
    expect(play.active).toBe(false);
    expect(editor.dirty).toBe(true);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.doc).toBe(edit);
    expect(editor.channel.undo()).toBe(false);
  });

  it("has a control in the clock place of the toolbar: Play, Stop, Keep with the list of the changes", () => {
    const { editor, play } = setup();
    playBar(play);
    const group = testId("scene-play");
    // With no editor window, the clock place is the body.
    expect(group?.parentElement).toBe(document.body);
    expect(testId("play-stop")?.hidden).toBe(true);
    testId("play-start")?.click();
    expect(play.active).toBe(true);
    expect(testId("play-start")?.hidden).toBe(true);
    expect(testId("play-stop")?.hidden).toBe(false);
    editor.apply(MOVE, "Move in the play mode");
    testId("play-keep")?.click();
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="play-change"]');
    expect([...rows].map((row) => row.dataset.change)).toEqual(["table/transform"]);
    testId("play-keep-apply")?.click();
    expect(play.active).toBe(false);
    expect(testId("play-keep-list")?.hidden).toBe(true);
    expect(editor.channel.history.canUndo).toBe(true);
    testId("play-start")?.click();
    testId("play-stop")?.click();
    expect(play.active).toBe(false);
  });

  it("opens the play window with a handoff of the documents now", () => {
    const opened: string[] = [];
    const { editor, play } = setup({ open: (url) => opened.push(url) });
    globalThis.localStorage.clear();
    expect(play.openWindow()).toBe(true);
    const key = new URL(opened[0] ?? "", "http://page").searchParams.get("handoff") ?? "";
    expect(opened[0]).toBe(`/player/play.html?handoff=${key}`);
    const handoff = readHandoff(globalThis.localStorage, key, true);
    expect(handoff).toEqual({
      format: HANDOFF_FORMAT,
      project: "showroom",
      scene: editor.doc,
      sequence: null,
      camera: "front",
    });
    expect(readHandoff(globalThis.localStorage, key)).toBeNull();
    expect(play.active).toBe(false);
  });

  it("puts the input recording of the play mode in the handoff", () => {
    const opened: string[] = [];
    const recording: InputRecording = {
      format: "scenity.input/1",
      id: "play-1",
      scene: "main",
      events: [{ t: 400, kind: "press", action: "demo.toggle", entity: "table", point: [0, 1, 0] }],
    };
    let last: InputRecording | null = recording;
    const input = { recording: () => last } as unknown as PlayInput;
    const { play } = setup({ open: (url) => opened.push(url), input });
    globalThis.localStorage.clear();
    expect(play.openWindow()).toBe(true);
    const key = (url: string | undefined) => new URL(url ?? "", "http://page").searchParams.get("handoff") ?? "";
    expect(readHandoff(globalThis.localStorage, key(opened[0]), true)?.recording).toEqual(recording);
    // A recording with no events gives no field: the window takes the live input.
    last = { ...recording, events: [] };
    expect(play.openWindow()).toBe(true);
    expect(readHandoff(globalThis.localStorage, key(opened[1]), true)).not.toHaveProperty("recording");
  });

  it("refuses a handoff key with other signs and a value of another format", () => {
    const storage = memory();
    const handoff = {
      format: HANDOFF_FORMAT,
      project: "p",
      scene: parseScene(TEXT),
      sequence: null,
      camera: null,
    } as const;
    expect(writeHandoff(storage, "../x", handoff)).toBe(false);
    expect(writeHandoff(storage, "a-1", handoff)).toBe(true);
    expect(readHandoff(storage, "a-1")).toEqual(handoff);
    storage.setItem("scenity.playHandoff.b-2", JSON.stringify({ format: "other" }));
    expect(readHandoff(storage, "b-2")).toBeNull();
  });
});
