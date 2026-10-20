// SPDX-License-Identifier: Apache-2.0
// The split view of the Scene view. A layout sends the panes with their views. A pane has its own camera and view mode.
// Main puts a pane into the main view. The storage keeps the layout. The main view box is the top left pane.
import type { OrbitCamera } from "@scenity/editor-core";
import type { ScenePanes } from "@scenity/runtime-dev/document/splitView";
import { afterEach, describe, expect, it } from "vitest";
import { mainViewBox, setMainLayout } from "../../src/scene/viewport/mainView";
import { paneModeOf, paneView, SPLIT_KEY, SplitViews, viewModeOf } from "../../src/scene/viewport/splitViews";
import type { ViewportCamera } from "../../src/scene/viewport/viewportCamera";
import type { ViewMode } from "../../src/scene/viewport/viewportTypes";

afterEach(() => {
  document.body.innerHTML = "";
  setMainLayout("1");
});

const ORBIT: OrbitCamera = { target: [0, 1, 0], yaw: 0.3, pitch: -0.2, distance: 6, fov: 50 };

/** A storage of the page in a map. */
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

/** A split view over a fake main camera; the calls of the main camera and the sent panes go to the lists. */
function make(storage: Storage) {
  const sent: ScenePanes[] = [];
  const calls: string[] = [];
  let mode: ViewMode = "lit";
  const camera = {
    current: () => ORBIT,
    move: (next: OrbitCamera) => calls.push(`move ${String(next.yaw)}`),
    setProjection: (next: string) => calls.push(`projection ${next}`),
    useDocument: (name: string) => {
      calls.push(`document ${name}`);
      return Promise.resolve(true);
    },
  } as unknown as ViewportCamera;
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const split = new SplitViews({
    canvas,
    camera,
    port: { setPanes: (panes) => sent.push(panes) },
    cameras: () => [{ id: "front", label: "Front camera" }],
    mainMode: () => mode,
    setMainMode: (next) => {
      mode = next;
    },
    storage: () => storage,
  });
  split.start();
  return { split, sent, calls, mode: () => mode };
}

describe("the split view of the Scene view", () => {
  it("sends the panes of a layout with their own cameras and modes", () => {
    const { split, sent } = make(memory());
    split.setLayout("2x2");
    const last = sent.at(-1);
    expect(last?.layout).toBe("2x2");
    expect(last?.others).toHaveLength(3);
    // The top view is a long lens straight down at the target of the main camera.
    const top = last?.others[0]?.view;
    expect(top?.fov).toBe(1);
    expect(top?.target).toEqual([0, 1, 0]);
    expect((top?.position[1] ?? 0) > 100).toBe(true);
    expect(document.querySelectorAll('[data-testid="scene-pane"]')).toHaveLength(3);
    split.setPane(1, { mode: "wireframe" });
    split.setPane(2, { camera: "camera:front" });
    split.setPane(3, { camera: "perspective" });
    expect(sent.at(-1)?.others.map((pane) => [pane.camera, pane.mode, pane.view?.fov ?? null])).toEqual([
      [null, "wireframe", 1],
      ["front", null, null],
      [null, null, 50],
    ]);
    expect([paneModeOf("normals"), viewModeOf("unlit"), viewModeOf(null)]).toEqual(["normalShading", "unlit", "lit"]);
    expect(paneView({ camera: "top", mode: null, orbit: null })).toEqual({ view: null, camera: null, mode: null });
  });

  it("a drag and the wheel move the camera of a pane; Main swaps a pane with the main view", async () => {
    const { split, sent, calls, mode } = make(memory());
    split.setLayout("2h");
    const pane = document.querySelector<HTMLElement>('[data-testid="scene-pane"]');
    if (pane === null) throw new Error("no pane");
    const before = sent.at(-1)?.others[0]?.view?.position;
    pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 200, cancelable: true }));
    expect(sent.at(-1)?.others[0]?.view?.position).not.toEqual(before);
    split.setPane(1, { mode: "unlit" });
    document.querySelector<HTMLButtonElement>('[data-testid="scene-pane-main"]')?.click();
    await Promise.resolve();
    expect(calls).toEqual(["projection orthographic", "move 0"]);
    expect(mode()).toBe("unlit");
    expect(split.panes[0]).toMatchObject({ camera: "perspective", mode: null, orbit: ORBIT });
    // The mode menu of the bar changes the mode of its pane.
    const select = document.querySelector<HTMLSelectElement>('[data-testid="scene-pane-mode"]');
    if (select === null) throw new Error("no mode menu");
    select.value = "normalShading";
    select.dispatchEvent(new Event("change"));
    expect(split.panes[0]?.mode).toBe("normalShading");
  });

  it("keeps the layout and the panes in the storage; the main view box is the top left pane", () => {
    const storage = memory();
    make(storage).split.setLayout("2v");
    make(storage).split.setPane(1, { camera: "left", mode: "wireframe" });
    expect(JSON.parse(storage.getItem(SPLIT_KEY) ?? "{}")).toMatchObject({
      layout: "2v",
      panes: [{ camera: "left", mode: "wireframe" }, { camera: "front" }, { camera: "right" }],
    });
    const element = document.createElement("div");
    element.getBoundingClientRect = () => new DOMRect(10, 20, 800, 600);
    setMainLayout("2x2");
    expect(mainViewBox(element)).toEqual(new DOMRect(10, 20, 400, 300));
    setMainLayout("1");
    expect(mainViewBox(element).width).toBe(800);
  });
});
