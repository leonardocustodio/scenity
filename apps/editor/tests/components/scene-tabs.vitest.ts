// SPDX-License-Identifier: Apache-2.0
// The scene tabs and the Scenes panel: a tab for each open scene with its dirty mark, a click that switches, × that
// closes, the arrow keys, and + for a new scene. Also the Scenes panel with the scenes of the project, their pictures,
// the marks of the open scenes and the recent scenes.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenSceneInfo, PageScenes } from "../../src/scene/projects/pageScenes";
import ScenesPanel from "../../src/scene/projects/ScenesPanel.vue";
import { sceneName, startSceneTabs } from "../../src/scene/projects/sceneTabs";
import type { SceneBar } from "../../src/scene/sceneBar";
import type { ScenePageEditor } from "../../src/scene/sceneEditor";
import { pageKeys } from "../../src/scene/settings/pageKeys";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Fake open scenes: main and side, main active and dirty. */
function fakeScenes() {
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  let open: OpenSceneInfo[] = [
    { path: "scenes/main.scene.json", active: true, dirty: true, canUndo: true },
    { path: "scenes/side.scene.json", active: false, dirty: false, canUndo: false },
  ];
  const scenes = {
    list: () => open,
    listen: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    open: (path: string) => {
      calls.push(`open ${path}`);
      open = open.map((item) => ({ ...item, active: item.path === path }));
      for (const listener of listeners) listener();
      return Promise.resolve(null);
    },
    close: (path: string) => {
      calls.push(`close ${path}`);
      return Promise.resolve({ closed: true, active: null });
    },
    projectScenes: () =>
      Promise.resolve({
        files: [
          { path: "scenes/main.scene.json", id: "main", name: "Main room", picture: "posters/main.webp", listed: true },
          { path: "scenes/garden.scene.json", id: "garden", name: null, picture: null, listed: true },
        ],
      }),
    recent: { list: () => ["scenes/old.scene.json", "scenes/main.scene.json"] },
  };
  return { scenes: scenes as unknown as PageScenes, calls };
}

describe("the scene tabs", () => {
  it("show the open scenes, switch, close, and move by the arrow keys", async () => {
    const holder = document.createElement("div");
    holder.id = "scene-bar";
    document.body.append(holder);
    const { scenes, calls } = fakeScenes();
    const bar = { notice: () => undefined, state: () => undefined, noticeKind: null } as unknown as SceneBar;
    // The tabs run the commands of the window: here the commands call the fake scenes.
    const path = { path: { type: "string", description: "path", optional: true } } as const;
    const stop = pageKeys().register([
      { id: "scene.open", title: "open", args: path, run: (args) => scenes.open(String(args.path)) },
      { id: "scene.close", title: "close", args: path, run: (args) => scenes.close(String(args.path)) },
    ]);
    startSceneTabs(scenes, {} as ScenePageEditor, bar);
    const tabs = () => [...document.querySelectorAll<HTMLElement>('[data-testid="scene-tab"]')];
    expect(
      tabs().map((tab) => [tab.dataset.path, tab.hasAttribute("data-active"), tab.hasAttribute("data-dirty")]),
    ).toEqual([
      ["scenes/main.scene.json", true, true],
      ["scenes/side.scene.json", false, false],
    ]);
    expect(tabs()[0]?.textContent).toContain("main●");
    tabs()[1]?.querySelector<HTMLButtonElement>('[data-testid="scene-tab-name"]')?.click();
    await flushPromises();
    expect(tabs()[1]?.hasAttribute("data-active")).toBe(true);
    tabs()[0]?.querySelector<HTMLButtonElement>('[data-testid="scene-tab-close"]')?.click();
    await flushPromises();
    expect(calls).toEqual(["open scenes/side.scene.json", "close scenes/main.scene.json"]);
    const names = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    names[0]?.focus();
    names[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(names[1]);
    // The keyboard closes a scene with Delete on its tab (the × is out of the tab list for assistive tools).
    names[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await flushPromises();
    expect(calls.at(-1)).toBe("close scenes/side.scene.json");
    expect(tabs()[0]?.querySelector('[data-testid="scene-tab-close"]')?.getAttribute("tabindex")).toBe("-1");
    expect(sceneName("scenes/a/b.scene.json")).toBe("b");
    stop();
  });
});

describe("the Scenes panel", () => {
  it("lists the scenes of the project with their pictures, the open ones and the recent ones", async () => {
    const { scenes, calls } = fakeScenes();
    const made: string[] = [];
    mount(ScenesPanel, {
      props: { scenes, base: "/projects/room/", newScene: () => made.push("new") },
      attachTo: document.body,
    });
    await flushPromises();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="scenes-card"]')];
    expect(cards.map((card) => card.dataset.path)).toEqual(["scenes/main.scene.json", "scenes/garden.scene.json"]);
    expect(cards[0]?.querySelector("img")?.getAttribute("src")).toBe("/projects/room/posters/main.webp");
    expect(cards[0]?.querySelector('[data-testid="scenes-open-mark"]')?.textContent).toContain("unsaved");
    expect(cards[1]?.textContent).toContain("garden");
    cards[1]?.querySelector("button")?.click();
    document.querySelector<HTMLButtonElement>('[data-testid="scenes-new"]')?.click();
    expect(calls).toEqual(["open scenes/garden.scene.json"]);
    expect(made).toEqual(["new"]);
    expect(document.body.textContent).toContain("scenes/old.scene.json");
  });
});
