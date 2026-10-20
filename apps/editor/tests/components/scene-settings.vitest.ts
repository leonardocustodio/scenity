// SPDX-License-Identifier: Apache-2.0
// The editor settings and the key map of the scene page: the one key listener of the page with the contexts of the
// focus, and a key of the user over the default key. Also the project file of the settings (a write, a conflict, a
// reload), the layout of a project, and the settings tab (a key capture and a setting).
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { sceneTextHash } from "@scenity/editor-core";
import type { SceneSaveParams, SceneSaveResult } from "@scenity/cli/sceneFileContract";
import { contextsOf, PageKeys, pageKeys } from "../../src/scene/settings/pageKeys";
import { PageSettings, pageSettings } from "../../src/scene/settings/pageSettings";
import { PageLayoutView } from "../../src/scene/settings/pageLayout";
import SettingsPanel from "../../src/scene/settings/SettingsPanel.vue";

afterEach(() => {
  globalThis.localStorage.clear();
  document.body.replaceChildren();
});

/** A key press on an element (or the window), as the browser gives it. */
function press(target: EventTarget, code: string, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** A files port of one project folder in the memory: the read and the save of the scene files. */
function memoryFiles() {
  const disk = new Map<string, string>();
  return {
    disk,
    read: (path: string) => {
      const text = disk.get(path);
      if (text === undefined) return Promise.reject(new Error(`no file ${path}`));
      return Promise.resolve({ path, text, hash: sceneTextHash(text) });
    },
    save: (params: SceneSaveParams): Promise<SceneSaveResult> => {
      const now = disk.get(params.path);
      const hash = now === undefined ? null : sceneTextHash(now);
      if (hash !== params.baseHash) return Promise.resolve({ ok: false, path: params.path, conflict: true, hash });
      disk.set(params.path, params.text);
      const done = { ok: true as const, path: params.path, text: params.text, changed: true };
      return Promise.resolve({ ...done, hash: sceneTextHash(params.text) });
    },
  };
}

describe("the keys of the scene page", () => {
  it("gives the contexts of the focus: the panels, then scene outside the dock, then global", () => {
    const dock = document.createElement("div");
    dock.dataset.keyContext = "dock";
    const panel = document.createElement("div");
    panel.dataset.keyContext = "sequencer";
    dock.append(panel);
    document.body.append(dock);
    expect(contextsOf(panel)).toEqual(["sequencer", "dock", "global"]);
    expect(contextsOf(document.body)).toEqual(["scene", "global"]);
    expect(contextsOf(window)).toEqual(["scene", "global"]);
    // A press on a dock panel focuses the content container of the dock. The panel in it gives the context.
    const container = document.createElement("div");
    container.className = "dv-content-container";
    const part = document.createElement("div");
    const docked = document.createElement("div");
    docked.dataset.keyContext = "dock";
    part.append(docked);
    container.append(part);
    document.body.append(container);
    expect(contextsOf(container)).toEqual(["dock", "global"]);
  });

  it("runs the command of a key in its context, skips a command that cannot run, and keeps text fields", () => {
    const keys = new PageKeys();
    const ran: string[] = [];
    keys.register([
      { id: "view.frame", title: "Frame", keys: ["F"], keyContext: "scene", run: () => ran.push("frame") },
      {
        id: "sequencer.deleteKey",
        title: "Delete key",
        keys: ["Delete"],
        keyContext: "sequencer",
        run: () => ran.push("key"),
      },
      { id: "file.save", title: "Save", keys: ["Mod+S"], inText: true, run: () => ran.push("save") },
      {
        id: "camera.open1",
        title: "Camera",
        keys: ["1"],
        keyContext: "scene",
        when: () => "no camera",
        run: () => ran.push("1"),
      },
    ]);
    const handle = (target: EventTarget, code: string, key: string, init?: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, "target", { value: target });
      return keys.handle(event);
    };
    const panel = document.createElement("div");
    panel.dataset.keyContext = "sequencer";
    const field = document.createElement("input");
    document.body.append(panel, field);
    expect(handle(document.body, "KeyF", "f")).toBe(true);
    expect(handle(panel, "Delete", "Delete")).toBe(true);
    expect(handle(document.body, "Delete", "Delete")).toBe(false);
    expect(handle(document.body, "Digit1", "1")).toBe(false);
    expect(handle(field, "KeyF", "f")).toBe(false);
    expect(handle(field, "KeyS", "s", { metaKey: true })).toBe(true);
    expect(ran).toEqual(["frame", "key", "save"]);
  });

  it("lets a key of the user replace the default key, and the change holds in the browser storage", () => {
    const ran: string[] = [];
    const stop = pageKeys().register([
      { id: "view.frame", title: "Frame", keys: ["F"], keyContext: "scene", run: () => ran.push("frame") },
    ]);
    pageSettings().setKeys("view.frame", ["G"], ["F"]);
    expect(press(document.body, "KeyF", "f").defaultPrevented).toBe(false);
    expect(press(document.body, "KeyG", "g").defaultPrevented).toBe(true);
    expect(ran).toEqual(["frame"]);
    expect(JSON.parse(globalThis.localStorage.getItem("scenity.keymap.user") ?? "{}")).toEqual({
      format: "scenity.keymap/1",
      keys: { "view.frame": ["G"] },
    });
    expect(new PageSettings(globalThis.localStorage).keymap?.keys["view.frame"]).toEqual(["G"]);
    pageSettings().setKeys("view.frame", null, ["F"]);
    stop();
  });
});

describe("the editor settings of the scene page", () => {
  it("writes a project setting to the project file and a personal setting to the browser storage", async () => {
    const files = memoryFiles();
    const settings = new PageSettings(globalThis.localStorage);
    await settings.attach(files);
    expect(settings.info().loaded).toBe(true);
    expect(await settings.set("snaps.grid", 0.05)).toBeNull();
    expect(files.disk.get("scenity.editor.json")).toContain('"grid": 0.05');
    expect(await settings.set("view.mode", "unlit")).toBeNull();
    expect(files.disk.get("scenity.editor.json")).not.toContain("unlit");
    expect(await settings.set("snaps.grid", -2)).toContain("from");
    // A new page reads both documents again.
    const again = new PageSettings(globalThis.localStorage);
    await again.attach(files);
    expect(again.value.snaps.grid).toBe(0.05);
    expect(again.value.view.mode).toBe("unlit");
  });

  it("writes over a file that another writer changed: it reads the file again and applies the change to it", async () => {
    const files = memoryFiles();
    const settings = new PageSettings(globalThis.localStorage);
    await settings.attach(files);
    files.disk.set("scenity.editor.json", '{"format":"scenity.editor/1","snaps":{"angleDegrees":5}}');
    expect(await settings.set("snaps.grid", 0.25)).toBeNull();
    expect(JSON.parse(files.disk.get("scenity.editor.json") ?? "{}")).toEqual({
      format: "scenity.editor/1",
      snaps: { angleDegrees: 5, grid: 0.25 },
    });
  });

  it("reads and changes the layout through the dock of the editor window", () => {
    const open = new Set(["scene.view", "hierarchy", "inspector"]);
    const listeners: (() => void)[] = [];
    const dock = {
      isOpen: (id: string) => open.has(id),
      open: (id: string) => void open.add(id),
      close: (id: string) => void open.delete(id),
      reset: () => {
        open.clear();
        for (const id of ["scene.view", "hierarchy", "inspector"]) open.add(id);
      },
      state: () => ({
        workspace: "layout",
        panels: [...open],
        active: null,
        maximized: false,
        floating: [],
        folded: false,
        shown: null,
      }),
      onChange: (listener: () => void) => {
        listeners.push(listener);
        return () => undefined;
      },
    };
    const layout = new PageLayoutView(() => dock);
    expect(layout.value).toMatchObject({
      leftOpen: true,
      rightOpen: true,
      panels: ["scene.view", "hierarchy", "inspector"],
    });
    layout.update({ leftOpen: false });
    expect(layout.value.leftOpen).toBe(false);
    layout.reset();
    expect(layout.value.leftOpen).toBe(true);
    expect(new PageLayoutView(() => null).value).toEqual({
      leftOpen: false,
      rightOpen: false,
      workspace: "",
      panels: [],
      active: null,
      maximized: false,
      floating: [],
      folded: false,
      shown: null,
    });
  });
});

describe("the settings tab of the scene page", () => {
  it("changes a key with a key press and a setting with a field", async () => {
    const stop = pageKeys().register([
      { id: "view.frame", title: "Frame", keys: ["F"], keyContext: "scene", run: vi.fn() },
    ]);
    const wrapper = mount(SettingsPanel, { attachTo: document.body });
    await wrapper.get('[data-testid="key-change-view.frame"]').trigger("click");
    expect(wrapper.find('[data-testid="keymap-capture"]').exists()).toBe(true);
    press(window, "KeyG", "g");
    await nextTick();
    expect(wrapper.get('[data-testid="key-row-view.frame"]').attributes("data-keys")).toBe("G");
    await wrapper.get('[data-testid="key-reset-view.frame"]').trigger("click");
    await nextTick();
    expect(wrapper.get('[data-testid="key-row-view.frame"]').attributes("data-keys")).toBe("F");
    const fly = wrapper.get('[data-testid="setting-camera.flySpeed"]');
    await fly.setValue("4");
    await fly.trigger("change");
    await nextTick();
    expect(pageSettings().value.camera.flySpeed).toBe(4);
    expect(wrapper.get('[data-testid="setting-source-camera.flySpeed"]').attributes("data-source")).toBe("user");
    wrapper.unmount();
    stop();
  });
});
