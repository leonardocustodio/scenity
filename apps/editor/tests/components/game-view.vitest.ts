// SPDX-License-Identifier: Apache-2.0
// The Game view: the play page in a frame with the options of the view. The options are the camera, a preset that fits
// in the panel, the tier, the backend, the worker and the stats. Also Play, which shows the documents again, and the
// render settings of Preferences, which fill the URL options of the scene page in the edit mode. A Game view behind
// another tab has no frame (no second player). It gets the documents again when it shows.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import { PANEL_VISIBLE_KEY } from "../../src/studio/shell/panelState";
import { DEFAULT_EDITOR_SETTINGS } from "@scenity/editor-core";
import { fitFrame, gameParams, statsLine, DEFAULT_GAME, type GameOptions } from "../../src/scene/game/gameView";
import GameView from "../../src/scene/game/GameView.vue";
import { renderParams } from "../../src/scene/settings/renderParams";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the Game view", () => {
  it("fits a preset in the panel, and gives the play page its options", () => {
    expect(fitFrame("free", { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitFrame("1920x1080", { width: 800, height: 600 })).toEqual({ width: 800, height: 450 });
    expect(fitFrame("1080x1920", { width: 800, height: 600 })).toEqual({ width: 337, height: 600 });
    expect(gameParams(DEFAULT_GAME)).toEqual({ embed: "1", tier: "high", backend: "auto" });
    expect(gameParams({ ...DEFAULT_GAME, worker: false, tier: "low" })).toMatchObject({ worker: "0", tier: "low" });
    expect(statsLine({ intervalP50: 16.7, drawCalls: 40, triangles: 9000, tier: "high", mode: "worker" }).fps).toBe(60);
  });

  it("shows the play page and asks for a new handoff after a change and at Play", async () => {
    const asked: GameOptions[] = [];
    let start: (() => void) | null = null;
    mount(GameView, {
      props: {
        url: (options: GameOptions) => {
          asked.push(options);
          return `about:blank#k${String(asked.length)}`;
        },
        cameras: () => [{ id: "front", label: "Front camera" }],
        listen: (listener: () => void) => {
          start = listener;
          return () => undefined;
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    const frame = () => document.querySelector<HTMLIFrameElement>('[data-testid="game-frame"]');
    expect(frame()?.getAttribute("src")).toBe("about:blank#k1");
    const worker = document.querySelector<HTMLInputElement>('[data-testid="game-worker"]');
    if (worker === null) throw new Error("no worker switch");
    worker.checked = false;
    worker.dispatchEvent(new Event("change"));
    await flushPromises();
    expect(asked.at(-1)?.worker).toBe(false);
    expect(frame()?.getAttribute("src")).toBe("about:blank#k2");
    (start as (() => void) | null)?.();
    await flushPromises();
    expect(frame()?.getAttribute("src")).toBe("about:blank#k3");
  });
});

describe("the Game view behind another tab", () => {
  it("runs no player while it does not show, and gets the documents when it shows", async () => {
    const visible = ref(false);
    let asked = 0;
    let start: (() => void) | null = null;
    mount(GameView, {
      props: {
        url: () => `about:blank#k${String((asked += 1))}`,
        cameras: () => [],
        listen: (listener: () => void) => {
          start = listener;
          return () => undefined;
        },
      },
      global: { provide: { [PANEL_VISIBLE_KEY as symbol]: visible } },
      attachTo: document.body,
    });
    await flushPromises();
    const frame = () => document.querySelector('[data-testid="game-frame"]');
    expect(frame()).toBeNull();
    (start as (() => void) | null)?.();
    await flushPromises();
    expect(frame()).toBeNull();
    expect(asked).toBe(0);
    visible.value = true;
    await flushPromises();
    expect(frame()?.getAttribute("src")).toBe("about:blank#k1");
    visible.value = false;
    await flushPromises();
    expect(frame()).toBeNull();
  });
});

describe("the render settings", () => {
  const render = DEFAULT_EDITOR_SETTINGS.render;

  it("fill the URL options of the edit mode; a URL parameter wins; a page with no edit mode stays", () => {
    const edit = (query: string) => new URLSearchParams(`edit=1&${query}`);
    const changed = { ...render, tier: "low" as const, worker: false, backend: "webgpu" as const, audio: false };
    const out = renderParams(edit("project=room"), changed);
    expect(out.get("tier")).toBe("low");
    expect(out.get("worker")).toBe("0");
    expect(out.get("backend")).toBe("webgpu");
    expect(out.get("audio")).toBe("0");
    expect(renderParams(edit("tier=ultra"), changed).get("tier")).toBe("ultra");
    const plain = renderParams(edit(""), render);
    expect(["tier", "backend", "worker", "gpu", "assets", "audio"].map((key) => plain.get(key))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(renderParams(new URLSearchParams("project=room"), changed).get("tier")).toBeNull();
  });
});
