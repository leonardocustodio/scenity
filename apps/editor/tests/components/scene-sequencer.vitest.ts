// SPDX-License-Identifier: Apache-2.0
// The sequencer panel of the scene page: a track list for each entity, keys on the time ruler, a drag that moves a key,
// Delete and markers. Also the play bar with the loop between A and B, the record mode and the curve editor. The panel
// runs the commands of the open sequence over a real page editor (the scene channel with the sequence channel). Thus
// each change is one step of the one history, the core gets each new sequence, and Save writes the sequence file.
import { builtinRegistry, readDocument, type SceneOp } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { SceneSaveParams, SceneSaveResult } from "@scenity/cli/sceneFileContract";
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { markRaw, nextTick } from "vue";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import { PageSequence, type PageTime } from "../../src/scene/sequencer/pageSequence";
import SequencerPanel from "../../src/scene/sequencer/SequencerPanel.vue";

const registry = builtinRegistry();

const SCENE = {
  format: "scenity.scene/1",
  id: "garden",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { transform: { position: [1, 0, 0] } } },
    lamp: {
      name: "Lamp",
      parent: null,
      index: 1,
      components: { transform: { position: [0, 2, 0] }, light: { type: "point", intensity: 2 } },
    },
  },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "tour",
  scene: "garden",
  duration: 4000,
  tracks: [],
};

function sceneDoc(): SceneDocument {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

/** A clock of the page that a test sets. */
function testTime(): PageTime & { t: number; on: boolean } {
  const time = {
    t: 0,
    on: false,
    now: () => time.t,
    playing: () => time.on,
    seek: (t: number) => {
      time.t = t;
      time.on = false;
    },
    play: () => {
      time.on = true;
    },
    pause: () => {
      time.on = false;
    },
  };
  return time;
}

function setup() {
  const loads: SequenceDocument[] = [];
  const saves: SceneSaveParams[] = [];
  const save = (params: SceneSaveParams): Promise<SceneSaveResult> => {
    saves.push(params);
    return Promise.resolve({ ok: true, path: params.path, hash: "0".repeat(64), text: params.text, changed: true });
  };
  const files = { read: () => Promise.reject(new Error("no read")), save };
  const time = testTime();
  const sequence = new PageSequence({
    path: "sequences/tour.sequence.json",
    doc: SEQUENCE,
    diskText: JSON.stringify(SEQUENCE),
    time,
    files,
    load: (doc) => {
      loads.push(doc);
      return Promise.resolve();
    },
  });
  const patches: SceneOp[][] = [];
  const editor = new ScenePageEditor({
    ...sequence.editorParts(),
    doc: sceneDoc(),
    path: "scenes/garden.scene.json",
    diskText: JSON.stringify(SCENE),
    registry,
    files,
    patch: (ops) => {
      patches.push([...ops]);
      return Promise.resolve({ ok: true as const, warnings: [] });
    },
  });
  sequence.connect(editor);
  const selected: string[] = [];
  const wrapper = mount(SequencerPanel, {
    props: { sequence: markRaw(sequence), selected: () => selected },
    attachTo: document.body,
  });
  return { editor, sequence, time, wrapper, loads, saves, selected, patches };
}

const byId = (wrapper: VueWrapper, id: string) => wrapper.get(`[data-testid="${id}"]`);

/** Let the commands and the renders settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Give an element a box of `width` px at x 0, and a pointer capture that happy-dom lacks. */
function box(element: Element, width = 400): void {
  const rect = { left: 0, top: 0, right: width, bottom: 24, width, height: 24, x: 0, y: 0, toJSON: () => ({}) };
  Object.assign(element, {
    getBoundingClientRect: () => rect,
    setPointerCapture: () => undefined,
  });
}

async function addTableTrack(wrapper: VueWrapper): Promise<void> {
  await byId(wrapper, "sequencer-track-entity").setValue("table");
  await byId(wrapper, "sequencer-add-track").trigger("click");
  await settle();
}

describe("the sequencer panel", () => {
  it("adds a track and keys; each change is one undo step, and the core plays each new sequence", async () => {
    const { editor, sequence, time, wrapper, loads } = setup();
    expect(wrapper.text()).toContain("No track yet");
    await addTableTrack(wrapper);
    expect(byId(wrapper, "sequencer-group-table").text()).toBe("Table");
    expect(byId(wrapper, "sequencer-track-0").text()).toContain("transform");
    await byId(wrapper, "sequencer-key-add-0").trigger("click");
    time.t = 2000;
    await byId(wrapper, "sequencer-key-add-0").trigger("click");
    await settle();
    expect(wrapper.findAll('[data-testid^="sequencer-key-0-"]').map((key) => key.attributes("data-t"))).toEqual([
      "0",
      "2000",
    ]);
    expect(loads.at(-1)).toBe(sequence.channel.doc);
    expect(editor.dirty).toBe(true);
    editor.channel.undo();
    await settle();
    expect(wrapper.findAll('[data-testid^="sequencer-key-0-"]')).toHaveLength(1);
  });

  it("moves a key with a drag as one step, and deletes the selected key with Delete", async () => {
    const { sequence, editor, wrapper } = setup();
    await addTableTrack(wrapper);
    await byId(wrapper, "sequencer-key-add-0").trigger("click");
    await settle();
    box(byId(wrapper, "sequencer-ruler").element);
    const key = byId(wrapper, "sequencer-key-0-0");
    box(key.element);
    const steps = editor.channel.history.steps().steps.length;
    key.element.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 0, pointerId: 1, bubbles: true }));
    key.element.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, pointerId: 1 }));
    // During the drag the core shows the new time, with no step.
    expect(sequence.channel.doc.tracks[0]?.keys[0]?.t).toBe(1000);
    key.element.dispatchEvent(new PointerEvent("pointerup", { clientX: 200, pointerId: 1 }));
    await settle();
    expect(sequence.channel.doc.tracks[0]?.keys[0]?.t).toBe(2000);
    expect(editor.channel.history.steps().steps.length).toBe(steps + 1);
    const panel = byId(wrapper, "sequencer").element;
    panel.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", bubbles: true }));
    await settle();
    expect(sequence.channel.doc.tracks[0]?.keys).toEqual([]);
  });

  it("adds a marker, plays and pauses, and sets and clears the loop", async () => {
    const { sequence, time, wrapper } = setup();
    time.t = 1500;
    await byId(wrapper, "sequencer-marker-name").setValue("door-open");
    await byId(wrapper, "sequencer-add-marker").trigger("click");
    await settle();
    expect(sequence.channel.doc.markers).toEqual({ "door-open": 1500 });
    expect(byId(wrapper, "sequencer-marker-door-open").text()).toBe("door-open");
    await byId(wrapper, "sequencer-play").trigger("click");
    expect(time.on).toBe(true);
    await byId(wrapper, "sequencer-play").trigger("click");
    expect(time.on).toBe(false);
    await byId(wrapper, "sequencer-loop-a").trigger("click");
    time.t = 3000;
    await byId(wrapper, "sequencer-loop-b").trigger("click");
    expect(byId(wrapper, "sequencer-loop-clear").attributes("disabled")).toBeUndefined();
    await byId(wrapper, "sequencer-loop-clear").trigger("click");
    expect(byId(wrapper, "sequencer-loop-clear").attributes("disabled")).toBeDefined();
  });

  it("records an edit at the time now as a key, and the base scene stays", async () => {
    const { editor, sequence, time, wrapper } = setup();
    await byId(wrapper, "sequencer-record").trigger("click");
    expect(byId(wrapper, "sequencer").attributes("data-recording")).toBe("1");
    time.t = 1000;
    const path = "/entities/lamp/components/light/intensity";
    expect(editor.apply([{ op: "set", path, value: 5 }])).toBeNull();
    await settle();
    expect(editor.doc.entities.lamp?.components.light).toEqual({ type: "point", intensity: 2 });
    expect(sequence.channel.doc.tracks).toEqual([
      { kind: "property", entity: "lamp", path: "light/intensity", keys: [{ t: 1000, value: 5 }] },
    ]);
    expect(byId(wrapper, "sequencer-track-0").text()).toContain("light/intensity");
  });

  it("shows the curve of a number track and changes a key value with a vertical drag", async () => {
    const { sequence, wrapper } = setup();
    await sequence.run("sequence.track.add", { kind: "property", entity: "lamp", path: "light/intensity" });
    await sequence.run("sequence.key.add", { track: 0, t: 0, value: "1" });
    await sequence.run("sequence.key.add", { track: 0, t: 4000, value: "3" });
    await settle();
    await byId(wrapper, "sequencer-track-0").get("button").trigger("click");
    await settle();
    const point = byId(wrapper, "sequencer-curve-key-0-1");
    const svg = byId(wrapper, "sequencer-curve").get("svg").element;
    box(svg, 400);
    Object.assign(point.element, { setPointerCapture: () => undefined });
    point.element.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientY: 50, pointerId: 2, bubbles: true }),
    );
    point.element.dispatchEvent(new PointerEvent("pointermove", { clientY: 4, pointerId: 2 }));
    point.element.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
    await settle();
    const value = (sequence.channel.doc.tracks[0]?.keys[1] as { value: number }).value;
    expect(value).toBeGreaterThan(3);
  });

  it("saves the sequence file with the scene through the same port", async () => {
    const { editor, wrapper, saves } = setup();
    await addTableTrack(wrapper);
    const result = await editor.save();
    expect(result.ok).toBe(true);
    expect(saves.map((save) => save.path)).toEqual(["scenes/garden.scene.json", "sequences/tour.sequence.json"]);
    const text = saves[1]?.text ?? "";
    expect(JSON.parse(text)).toMatchObject({ tracks: [{ kind: "transform", entity: "table", keys: [] }] });
    expect(editor.dirty).toBe(false);
  });
});
