// SPDX-License-Identifier: Apache-2.0
// The clip browser: the clips of a model and of the clip source of its animator, and a clip as drag data. Also the
// command that puts a clip on the timeline (a key on the track of the entity, else a new track). The panel has the
// rows, Add at the playhead and the preview toggle, which need an open sequence.
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import ClipBrowserPanel from "../../src/scene/clips/ClipBrowserPanel.vue";
import {
  clipCommand,
  clipDragText,
  clipRows,
  readClipDrag,
  type ClipDrag,
  type ClipRow,
} from "../../src/scene/clips/clipBrowser";

afterEach(() => {
  document.body.innerHTML = "";
});

const COMPONENTS = { model: { asset: "asset:robot" }, animator: { clipSource: { asset: "asset:moves" } } };
const PARTS = { clips: ["Idle", "Wave"], clipSeconds: { Idle: 2, Wave: 1.25 }, sourceClips: ["Jump"] };

function sequence(tracks: SequenceDocument["tracks"] = []): SequenceDocument {
  return { format: "scenity.sequence/1", id: "s", scene: "main", duration: 5000, tracks };
}

describe("the model of the clip browser", () => {
  it("lists the clips of the model with their lengths, then the clips of the clip source", () => {
    expect(clipRows(COMPONENTS, PARTS)).toEqual([
      { asset: "asset:robot", name: "Idle", seconds: 2, from: "model" },
      { asset: "asset:robot", name: "Wave", seconds: 1.25, from: "model" },
      { asset: "asset:moves", name: "Jump", seconds: null, from: "source" },
    ]);
    expect(clipRows({ model: { asset: "asset:robot" } }, undefined)).toEqual([]);
    expect(clipRows({}, PARTS)).toEqual([]);
  });

  it("keeps a clip in drag data, and refuses other data", () => {
    const row: ClipRow = { asset: "asset:robot", name: "Wave", seconds: 1, from: "model" };
    expect(readClipDrag(clipDragText("robot", row))).toEqual({ entity: "robot", clip: "asset:robot", name: "Wave" });
    expect(readClipDrag("not json")).toBeNull();
    expect(readClipDrag(JSON.stringify({ entity: "robot" }))).toBeNull();
  });

  it("adds a key on the animation track of the entity, else a new track with the key", () => {
    const drag: ClipDrag = { entity: "robot", clip: "asset:robot", name: "Wave" };
    expect(clipCommand(sequence(), drag, 1234.4)).toEqual({
      command: "sequence.track.add",
      args: {
        kind: "animation",
        entity: "robot",
        keys: JSON.stringify([{ t: 1234, clip: "asset:robot", name: "Wave" }]),
      },
    });
    const tracks: SequenceDocument["tracks"] = [
      { kind: "animation", entity: "other", keys: [] },
      { kind: "animation", entity: "robot", keys: [{ t: 0, clip: "asset:robot" }] },
    ];
    expect(clipCommand(sequence(tracks), drag, 9000)).toEqual({
      command: "sequence.key.add",
      args: { track: 1, t: 5000, value: JSON.stringify({ clip: "asset:robot", name: "Wave" }) },
    });
  });
});

describe("the clip browser panel", () => {
  function setup(open: SequenceDocument | null) {
    const doc = shallowRef({
      format: "scenity.scene/1",
      id: "main",
      entities: { robot: { name: "Robot", parent: null, index: 0, components: COMPONENTS } },
    } as unknown as SceneDocument);
    const runs: [string, Readonly<Record<string, unknown>>][] = [];
    const previews: (ClipDrag | null)[] = [];
    const wrapper = mount(ClipBrowserPanel, {
      attachTo: document.body,
      props: {
        doc,
        selected: shallowRef(["robot"]),
        report: () => Promise.resolve({ entities: [{ id: "robot", parts: PARTS }] }),
        sequence: () => open,
        time: () => 800,
        run: (command: string, args: Readonly<Record<string, unknown>>) => {
          runs.push([command, args]);
          return Promise.resolve(null);
        },
        preview: (value: ClipDrag | null) => previews.push(value),
      },
    });
    return { wrapper, runs, previews };
  }
  const rowOf = (name: string) => document.querySelector<HTMLElement>(`[data-testid="clip-row"][data-clip="${name}"]`);
  const press = async (row: HTMLElement | null, id: string): Promise<void> => {
    row?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
    await flushPromises();
  };

  it("adds a clip at the playhead and toggles its preview; the preview stops at the unmount", async () => {
    const { wrapper, runs, previews } = setup(sequence());
    await flushPromises();
    expect(document.querySelector('[data-testid="clips-panel"]')?.getAttribute("data-clips")).toBe("3");
    expect(rowOf("Wave")?.textContent).toContain("1.25 s");
    expect(rowOf("Jump")?.dataset.from).toBe("source");
    await press(rowOf("Wave"), "clip-add");
    expect(runs).toEqual([
      [
        "sequence.track.add",
        { kind: "animation", entity: "robot", keys: JSON.stringify([{ t: 800, clip: "asset:robot", name: "Wave" }]) },
      ],
    ]);
    await press(rowOf("Wave"), "clip-preview");
    expect(previews).toEqual([{ entity: "robot", clip: "asset:robot", name: "Wave" }]);
    expect(rowOf("Wave")?.querySelector('[data-testid="clip-preview"]')?.getAttribute("aria-pressed")).toBe("true");
    await press(rowOf("Jump"), "clip-preview");
    expect(previews.at(-1)).toEqual({ entity: "robot", clip: "asset:moves", name: "Jump" });
    wrapper.unmount();
    expect(previews.at(-1)).toBeNull();
  });

  it("needs an open sequence for the timeline and the preview", async () => {
    setup(null);
    await flushPromises();
    expect(document.querySelector('[data-testid="clips-no-sequence"]')).not.toBeNull();
    expect(rowOf("Wave")?.querySelector<HTMLButtonElement>('[data-testid="clip-add"]')?.disabled).toBe(true);
    expect(rowOf("Wave")?.querySelector<HTMLButtonElement>('[data-testid="clip-preview"]')?.disabled).toBe(true);
  });
});
