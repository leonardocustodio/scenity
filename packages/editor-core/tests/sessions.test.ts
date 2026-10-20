// SPDX-License-Identifier: Apache-2.0
// The document sessions of the open scenes. Two scenes of one project keep their own undo history over a switch. Only
// the active session patches the runtime. A close with unsaved changes asks first (cancel, save, discard). A "save
// as" moves the session to the new path. A new scene gets a free path in the project.
import { describe, expect, it } from "bun:test";
import { writeDocument, type SceneOp } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import {
  DocumentSessions,
  EditError,
  EMPTY_VIEW,
  newSceneDocument,
  newScenePlan,
  RecentScenes,
  SceneChannel,
  sceneDraftKey,
  SceneDrafts,
  SceneFile,
  sceneIdOf,
  sceneTextHash,
  SEQUENCE_CHANNEL,
  SEQUENCE_OP,
  SequenceChannel,
  VIEW_CHANNEL,
  VIEW_OP,
  type CloseChoice,
  type DocumentSession,
  type DraftStorage,
  type SceneView,
  type ViewOp,
} from "../src/index";
import { components, garden } from "./helpers";

const TABLE = "/entities/table/components/transform/position";
const MAIN = "scenes/main.scene.json";
const SECOND = "scenes/second.scene.json";

/** A second scene: the garden with another ID and the table at x = 7. */
function second(): SceneDocument {
  const doc = garden();
  const table = doc.entities.table;
  if (table === undefined) throw new Error("the garden has no table");
  const transform = { ...(table.components.transform as Record<string, unknown>), position: [7, 0, 0] };
  return {
    ...doc,
    id: "second",
    entities: { ...doc.entities, table: { ...table, components: { ...table.components, transform } } },
  };
}

const draftKey = (file: string): string => sceneDraftKey("garden", file);

/** The scene channel of an editor with the view state and a sequence channel, as the scene page has. */
function editor(play: { busy: string | null } = { busy: null }) {
  const patches: SceneOp[][] = [];
  const sequenceDoc: SequenceDocument = {
    format: "scenity.sequence/1",
    id: "tour",
    scene: "main",
    duration: 1000,
    tracks: [],
  };
  const sequence = new SequenceChannel({ doc: sequenceDoc, send: () => undefined });
  let view: SceneView = EMPTY_VIEW;
  const channel = new SceneChannel<SceneDocument>({
    doc: garden(),
    registry: components,
    patch: (ops) => patches.push([...ops]),
    channels: {
      [VIEW_CHANNEL]: { read: () => view, write: (next) => (view = next as SceneView), same: (a, b) => a === b },
      [SEQUENCE_CHANNEL]: sequence.channel,
    },
    kinds: [VIEW_OP, SEQUENCE_OP],
  });
  const file = new SceneFile(MAIN, garden(), writeDocument(garden()));
  const storage = memory();
  const drafts = new SceneDrafts(storage, draftKey(MAIN), MAIN);
  const sessions = new DocumentSessions({ channel, file, drafts, draftKey, busy: () => play.busy });
  const other = sessions.open({ path: SECOND, doc: second(), diskText: writeDocument(second()) });
  const setView = (next: SceneView): void => {
    view = next;
  };
  return { channel, file, drafts, storage, sessions, other, patches, sequence, view: () => view, setView };
}

/** A storage in memory. */
function memory(): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function move(channel: SceneChannel<SceneDocument>, x: number): void {
  channel.edit([{ op: "set", path: TABLE, value: [x, 0, 0] }], "Move the table");
}

function tableX(doc: SceneDocument): number | undefined {
  const transform = doc.entities.table?.components.transform as { position?: number[] } | undefined;
  return transform?.position?.[0];
}

describe("the document sessions", () => {
  it("keeps a separate undo history for each scene over a switch", () => {
    const { channel, file, sessions, other } = editor();
    const main = sessions.active;
    if (main === null) throw new Error("no active session");
    move(channel, 1);
    move(channel, 2);
    sessions.activate(other);
    expect(channel.doc).toBe(other.doc);
    expect(tableX(channel.doc)).toBe(7);
    // The file state of the editor is the file of the second scene after the switch. Main keeps its own file state.
    expect(file.path).toBe(SECOND);
    expect(main.path).toBe(MAIN);
    expect(main.dirty).toBe(true);
    expect(other.dirty).toBe(false);
    // The second scene has no step before its open.
    expect(channel.undo()).toBe(false);
    move(channel, 5);
    expect(sessions.canUndo(main)).toBe(true);
    expect(tableX(main.doc)).toBe(2);
    sessions.activate(MAIN);
    expect(sessions.active).toBe(main);
    // An undo of main removes one step of main only.
    expect(channel.undo()).toBe(true);
    expect(tableX(channel.doc)).toBe(1);
    expect(tableX(other.doc)).toBe(5);
    expect(other.dirty).toBe(true);
    expect(channel.undo()).toBe(true);
    expect(channel.undo()).toBe(false);
    expect(main.dirty).toBe(false);
    // The redo steps of main stay over a switch too.
    sessions.activate(other);
    expect(channel.undo()).toBe(true);
    expect(tableX(channel.doc)).toBe(7);
    expect(other.dirty).toBe(false);
    sessions.activate(main);
    expect(channel.redo()).toBe(true);
    expect(tableX(channel.doc)).toBe(1);
  });

  it("sends the change of the document to the runtime at a switch, and calls the hooks in order", () => {
    const { channel, sessions, other, patches } = editor();
    const calls: string[] = [];
    sessions.beforeSwitch((from, to) => calls.push(`before ${from?.path ?? ""} ${String(channel.doc === to.doc)}`));
    sessions.afterSwitch((from, to) => calls.push(`after ${from?.path ?? ""} ${String(channel.doc === to.doc)}`));
    sessions.activate(other);
    expect(calls).toEqual([`before ${MAIN} false`, `after ${MAIN} true`]);
    // The runtime gets the diff of the two documents: the table moves to x = 7.
    expect(patches.flat().some((op) => op.op === "set")).toBe(true);
    expect(tableX(channel.doc)).toBe(7);
  });

  it("keeps the view state, the sequence, the selection and the draft key of each session", () => {
    const { channel, sessions, other, sequence, view, setView } = editor();
    const main = sessions.active;
    if (main === null) throw new Error("no active session");
    const solo: ViewOp = { kind: "view", flag: "solo", ids: ["table"] };
    channel.apply({ id: "solo", title: "Solo", ops: [solo] });
    const shown = view();
    expect(shown.solo).toEqual(["table"]);
    main.selection = ["table"];
    sessions.activate(other);
    // The new scene starts with an empty view state and the current sequence document.
    expect(view()).toBe(EMPTY_VIEW);
    expect(sessions.values(other)[SEQUENCE_CHANNEL]).toBe(sequence.doc);
    expect(sessions.values(main)[VIEW_CHANNEL]).toBe(shown);
    other.state = { camera: "front" };
    setView(EMPTY_VIEW);
    sessions.activate(main);
    expect(view()).toEqual(shown);
    expect(main.selection).toEqual(["table"]);
    expect(other.state).toEqual({ camera: "front" });
    expect(main.draftKey).toBe(draftKey(MAIN));
    expect(other.draftKey).toBe(draftKey(SECOND));
  });

  it("refuses a switch while a drag or the play mode runs, and a second session of one path", () => {
    const play = { busy: null as string | null };
    const { channel, sessions, other } = editor(play);
    channel.begin();
    expect(() => sessions.activate(other)).toThrow(EditError);
    channel.end();
    play.busy = "Stop the play mode first.";
    expect(() => sessions.activate(other)).toThrow("play mode");
    play.busy = null;
    sessions.activate(other);
    expect(() => sessions.open({ path: MAIN, doc: garden(), diskText: null })).toThrow("open already");
  });

  it("asks about unsaved changes at a close: cancel, a failed save, discard", async () => {
    const { channel, sessions, other } = editor();
    const main = sessions.active;
    if (main === null) throw new Error("no active session");
    move(channel, 2);
    const asked: string[] = [];
    const port = (choice: CloseChoice, saved = true) => ({
      ask: (target: DocumentSession) => (asked.push(target.path), choice),
      save: () => Promise.resolve(saved),
    });
    expect(await sessions.close(main, port("cancel"))).toMatchObject({ closed: false, active: main });
    expect(await sessions.close(main, port("save", false))).toMatchObject({ closed: false });
    expect(sessions.list()).toHaveLength(2);
    const closed = await sessions.close(main, port("discard"));
    expect(closed).toMatchObject({ closed: true, active: other });
    expect(asked).toEqual([MAIN, MAIN, MAIN]);
    expect(channel.doc).toBe(other.doc);
    // A clean session closes with no question; then no session is open.
    expect(await sessions.close(SECOND, port("cancel"))).toMatchObject({ closed: true, active: null });
    expect(asked).toHaveLength(3);
    expect(sessions.list()).toHaveLength(0);
  });

  it("makes a parked session active to save it at a close", async () => {
    const { channel, sessions, other } = editor();
    sessions.activate(other);
    move(channel, 3);
    sessions.activate(MAIN);
    const saves: string[] = [];
    const result = await sessions.close(other, {
      ask: () => "save",
      save: (target) => {
        saves.push(`${target.path} ${String(tableX(channel.doc))}`);
        return Promise.resolve(true);
      },
    });
    expect(result).toMatchObject({ closed: true });
    expect(saves).toEqual([`${SECOND} 3`]);
    // The close of the active session makes the last other session active.
    expect(sessions.active?.path).toBe(MAIN);
    expect(tableX(channel.doc)).toBe(0);
  });

  it("moves a session to a new path after a save as, with the history", () => {
    const { channel, file, sessions } = editor();
    const main = sessions.active;
    if (main === null) throw new Error("no active session");
    move(channel, 4);
    const copy = "scenes/copy.scene.json";
    expect(sessions.saveAsProblem(main, MAIN)).toContain("another path");
    expect(sessions.saveAsProblem(main, SECOND)).toContain("is open");
    expect(sessions.saveAsProblem(main, copy)).toBeNull();
    const request = main.saveAsRequest(copy);
    expect(request).toMatchObject({ path: copy, baseHash: null });
    expect(request.text).toBe(writeDocument(channel.doc));
    // The writer saved the text: the session is at the new path, clean, and its undo still works.
    main.moveTo(copy, request.text, sceneTextHash(request.text));
    expect(main.path).toBe(copy);
    expect(file.path).toBe(copy);
    expect(main.baseHash).toBe(sceneTextHash(request.text));
    expect(main.dirty).toBe(false);
    expect(main.draftKey).toBe(draftKey(copy));
    expect(sessions.find(copy)).toBe(main);
    expect(sessions.find(MAIN)).toBeNull();
    expect(channel.undo()).toBe(true);
    expect(main.dirty).toBe(true);
  });
});

describe("a new scene and the recent scenes", () => {
  it("plans a free path and an empty document", () => {
    expect(sceneIdOf("  Night Garden! ")).toBe("night-garden");
    expect(sceneIdOf("???")).toBe("scene");
    const plan = newScenePlan("Night garden", [MAIN, "scenes/night-garden.scene.json"]);
    expect(plan).toEqual({ path: "scenes/night-garden-2.scene.json", id: "night-garden-2", name: "Night garden" });
    expect(newScenePlan("", []).name).toBe("New scene");
    expect(newSceneDocument(plan)).toEqual({
      format: "scenity.scene/1",
      id: "night-garden-2",
      name: "Night garden",
      entities: {},
    });
  });

  it("keeps the recent scenes per project, newest first, and falls back to none when the storage fails", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    const recent = new RecentScenes(storage, "garden");
    recent.touch(MAIN);
    recent.touch(SECOND);
    recent.touch(MAIN);
    expect(recent.list()).toEqual([MAIN, SECOND]);
    expect(new RecentScenes(storage, "other").list()).toEqual([]);
    recent.rename(MAIN, "scenes/copy.scene.json");
    expect(recent.list()).toEqual(["scenes/copy.scene.json", SECOND]);
    recent.forget(SECOND);
    expect(recent.list()).toEqual(["scenes/copy.scene.json"]);
    for (let index = 0; index < 12; index += 1) recent.touch(`scenes/s${String(index)}.scene.json`);
    expect(recent.list()).toHaveLength(8);
    const blocked = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    const none = new RecentScenes(blocked, "garden");
    none.touch(MAIN);
    expect(none.list()).toEqual([]);
    expect(new RecentScenes(null, "garden").list()).toEqual([]);
    items.set("scenity.recentScenes.bad", "{not json");
    expect(new RecentScenes(storage, "bad").list()).toEqual([]);
  });
});

describe("the drafts over a switch", () => {
  it("keeps the draft of each dirty scene under its own key", () => {
    const { channel, drafts, storage, sessions, other } = editor();
    // The page keeps the draft after each change (the editor of the page calls write or clear).
    const keep = (): void => {
      const active = sessions.active;
      if (active === null) return;
      if (active.dirty) drafts.write(new SceneFile(active.path, garden(), null), channel.doc, 1);
      else drafts.clear();
    };
    move(channel, 2);
    keep();
    sessions.activate(other);
    keep();
    expect(storage.items.has(draftKey(MAIN))).toBe(true);
    expect(storage.items.has(draftKey(SECOND))).toBe(false);
    expect(drafts.read()).toBeNull();
    move(channel, 9);
    keep();
    expect(JSON.parse(storage.items.get(draftKey(SECOND)) ?? "{}")).toMatchObject({ path: SECOND });
  });
});
