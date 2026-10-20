// SPDX-License-Identifier: Apache-2.0
// The workbench bridge of the scene page: the calls of the generic Claude tools over a real page editor and the
// commands of the page. `scene.query` gives the entities with the bounds of the inspect report. `commands` lists the
// transform commands. A `command` of Claude waits as a proposal on the proposal card until the owner accepts it (one
// undo step). The switch "apply" applies it immediately. The bridge answers only the workbench parent.
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { PROPOSAL_MODE_KEY } from "@scenity/editor-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandApi, sceneCommands, type SelectionPort } from "../../src/scene/hierarchy/sceneCommands";
import type { ScenePageApi } from "../../src/scene/main";
import { listenEntityKeys } from "../../src/scene/entityKeys";
import { startProposalCard } from "../../src/scene/proposalCard";
import { startSceneBridge } from "../../src/scene/sceneBridge";
import { SCENE_PAGE_CALLS } from "../../src/scene/sceneBridgeCalls";
import { sceneIndexJob } from "../../src/scene/sceneIndex";
import { sceneSheet, sceneSheetArgs } from "../../src/scene/sceneSheet";
import { ScenePageEditor } from "../../src/scene/sceneEditor";

const registry = builtinRegistry();
const ORIGIN = "http://127.0.0.1:4800";

const SCENE = {
  format: "scenity.scene/1",
  id: "garden",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { transform: { position: [1, 0, 0] } } },
    lamp: {
      name: "Lamp",
      parent: "table",
      index: 0,
      components: { transform: { position: [0, 1, 0] }, light: { type: "point" } },
    },
  },
};

function selection(): SelectionPort & { ids: readonly string[] } {
  const port = {
    ids: [] as readonly string[],
    set(ids: readonly string[]) {
      port.ids = [...ids];
    },
    listen: () => () => undefined,
  };
  return port;
}

const stops: (() => void)[] = [];

/** A scene page: the editor, the commands, the card and the script API in `globalThis.__scenity`. */
function page() {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  const doc: SceneDocument = read.doc;
  const editor = new ScenePageEditor({
    doc,
    path: "scenes/garden.scene.json",
    diskText: JSON.stringify(SCENE),
    registry,
    patch: () => Promise.resolve({ ok: true as const, warnings: [] }),
  });
  const commands = sceneCommands(editor, selection());
  const stopCard = startProposalCard(commands);
  // The script API reads the one command registry of the window, and the scene commands connect to it.
  stops.push(listenEntityKeys({ canvas: document.createElement("canvas"), commands, live: () => false }));
  const box = { min: [0.5, 0, -0.5] as const, max: [1.5, 1, 0.5] as const };
  const api = {
    ...commandApi(commands, editor),
    frame: () => Promise.resolve(),
    document: () => editor.doc,
    file: () => ({ path: editor.file.path, baseHash: null, dirty: editor.dirty }),
    selection: () => [],
    inspect: () => Promise.resolve({ entities: [{ id: "table", bounds: box }] }),
  } as unknown as ScenePageApi;
  globalThis.__scenity = api;
  return { editor, commands, stopCard, box };
}

const place = (editor: ScenePageEditor, id: string): unknown =>
  (editor.doc.entities[id]?.components.transform as { position?: unknown } | undefined)?.position;

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  globalThis.__scenity = undefined;
  sessionStorage.removeItem(PROPOSAL_MODE_KEY);
  document.body.replaceChildren();
});

describe("the bridge calls of the scene page", () => {
  it("answers scene.query with the transforms and the bounds of the inspect report", async () => {
    const { box } = page();
    const answer = await SCENE_PAGE_CALLS["scene.query"]([{ name: "table" }]);
    expect(answer.entities.map((entity) => entity.id)).toEqual(["table"]);
    expect(answer.entities[0]?.bounds).toEqual(box);
    const lamp = await SCENE_PAGE_CALLS["scene.query"]([{ component: "light" }]);
    expect(lamp.entities[0]?.world?.position).toEqual([1, 1, 0]);
  });

  it("lists the transform commands; a run of Claude waits on the card until the owner accepts it", async () => {
    const { editor } = page();
    const listed = (await SCENE_PAGE_CALLS.commands([])) as { id: string }[];
    expect(listed.map((item) => item.id)).toEqual(
      expect.arrayContaining(["entity.move", "entity.turn", "entity.scale"]),
    );
    const run = (await SCENE_PAGE_CALLS.command(["entity.move", { entity: "table", x: 3 }, { by: "claude" }])) as {
      outcome: string;
      proposal: string;
    };
    expect(run).toMatchObject({ outcome: "proposed", proposal: "p1" });
    expect(place(editor, "table")).toEqual([1, 0, 0]);
    const card = document.querySelector<HTMLElement>('[data-testid="scene-proposals"]');
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).toContain("Move Table to x 3 (Claude)");
    const steps = editor.channel.history.steps().index;
    document.querySelector<HTMLButtonElement>('[data-testid="scene-proposal-accept"]')?.click();
    expect(place(editor, "table")).toEqual([3, 0, 0]);
    expect(editor.channel.history.steps().index).toBe(steps + 1);
    expect(card?.hidden).toBe(true);
    editor.channel.undo();
    expect(place(editor, "table")).toEqual([1, 0, 0]);
  });

  it("gives each command of the page a tool twin: scene_command runs every listed command (the gaps: none)", async () => {
    const { commands } = page();
    const listed = await SCENE_PAGE_CALLS.commands([]);
    const own = commands.listings().map((item) => item.id);
    // The owner actions (`proposal.*` of the lab) are the only commands that Claude cannot run; the page has none.
    const gaps = own.filter((id) => !listed.some((item) => item.id === id && !item.owner));
    expect(gaps).toEqual([]);
    // The gizmo drags have their twins: the transform commands.
    expect(own).toEqual(expect.arrayContaining(["entity.move", "entity.turn", "entity.scale", "entity.rename"]));
  });

  it("lets Claude set a field of a component with component.set; the step names the field", async () => {
    const { editor } = page();
    const args = { entity: "lamp", component: "light", field: "intensity", value: "3" };
    const run = (await SCENE_PAGE_CALLS.command(["component.set", args, { by: "claude" }])) as { outcome: string };
    expect(run.outcome).toBe("proposed");
    document.querySelector<HTMLButtonElement>('[data-testid="scene-proposal-accept"]')?.click();
    const light = editor.doc.entities.lamp?.components.light as { intensity?: number };
    expect(light.intensity).toBe(3);
    const { index, steps } = editor.channel.history.steps();
    expect(steps[index]?.label?.title).toContain("Light: intensity");
  });

  it("keeps the actor of each step: an agent session with its name and colour, and the person", async () => {
    page();
    const session = { id: "s1", name: "Layout helper", colour: "#7c3aed" };
    const args = { entity: "lamp", component: "light", field: "intensity", value: "2" };
    await SCENE_PAGE_CALLS.command(["component.set", args, { by: "claude", session }]);
    document.querySelector<HTMLButtonElement>('[data-testid="scene-proposal-accept"]')?.click();
    await globalThis.__scenity?.command?.("entity.rename", { entity: "lamp", name: "Desk lamp" }, { by: "owner" });
    const history = globalThis.__scenity?.history?.();
    const last = history?.steps.slice(-2) ?? [];
    expect(last[0]).toEqual({
      title: "Light: intensity",
      actor: { kind: "agent", session: "s1", name: "Layout helper", colour: "#7c3aed" },
    });
    expect(last[1]?.actor).toEqual({ kind: "person" });
  });

  it("runs a batch as one step, all or none: a failed step of 10 leaves the document as before", async () => {
    const { editor } = page();
    const before = JSON.stringify(editor.doc);
    const steps = editor.channel.history.steps().steps.length;
    const moves = Array.from({ length: 9 }, (_, index) => ({
      command: "entity.move",
      args: { entity: "table", x: index + 2 },
    }));
    const failed = [...moves, { command: "entity.move", args: { entity: "nobody", x: 1 } }];
    await expect(SCENE_PAGE_CALLS.commandBatch([failed, "Ten moves", { by: "owner" }])).rejects.toThrow(
      "Step 10 (entity.move)",
    );
    expect(JSON.stringify(editor.doc)).toBe(before);
    expect(editor.channel.history.steps().steps.length).toBe(steps);
    // Three steps: one named step of the history, and one undo takes them all back.
    const run = (await SCENE_PAGE_CALLS.commandBatch([moves.slice(0, 3), "Lay out the table", { by: "owner" }])) as {
      outcome: string;
    };
    expect(run.outcome).toBe("applied");
    expect(place(editor, "table")).toEqual([4, 0, 0]);
    const history = editor.channel.history.steps();
    expect(history.steps[history.index]?.label?.title).toBe("Lay out the table");
    editor.channel.undo();
    expect(JSON.stringify(editor.doc)).toBe(before);
  });

  it("keeps a batch of Claude as one proposal; Accept applies it as one step", async () => {
    const { editor } = page();
    const steps = [
      { command: "entity.move", args: { entity: "table", x: 5 } },
      { command: "entity.rename", args: { entity: "lamp", name: "Desk lamp" } },
    ];
    const run = (await SCENE_PAGE_CALLS.commandBatch([steps, "Move and rename", { by: "claude" }])) as {
      outcome: string;
    };
    expect(run.outcome).toBe("proposed");
    expect(place(editor, "table")).toEqual([1, 0, 0]);
    document.querySelector<HTMLButtonElement>('[data-testid="scene-proposal-accept"]')?.click();
    expect(place(editor, "table")).toEqual([5, 0, 0]);
    expect(editor.doc.entities.lamp?.name).toBe("Desk lamp");
    const history = editor.channel.history.steps();
    expect(history.steps[history.index]?.label?.title).toBe("Move and rename");
  });

  it("applies a run of Claude at once only with the switch of the session", async () => {
    const { editor } = page();
    expect(await SCENE_PAGE_CALLS.proposalMode([])).toBe("propose");
    globalThis.__scenity?.setProposalMode?.("apply");
    expect(sessionStorage.getItem(PROPOSAL_MODE_KEY)).toBe("apply");
    expect(await SCENE_PAGE_CALLS.proposalMode([])).toBe("apply");
    const run = await SCENE_PAGE_CALLS.command(["entity.move", { entity: "table", y: 2 }, { by: "claude" }]);
    expect(run).toMatchObject({ outcome: "applied", step: true });
    expect(place(editor, "table")).toEqual([1, 2, 0]);
    const lines = await SCENE_PAGE_CALLS.contextLines([]);
    expect(lines[0]).toContain("Scene file: scenes/garden.scene.json (changed, not saved); 2 entities.");
  });

  it("starts only in a frame with the workbench origin, and answers the calls of the parent", async () => {
    page();
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    const listeners: ((event: Event) => void)[] = [];
    const search = `?project=garden&edit=1&workbench=${encodeURIComponent(ORIGIN)}`;
    const host = {
      parent,
      location: { href: `http://127.0.0.1:5176/scene.html${search}`, search },
      console: { error: vi.fn(), warn: vi.fn() },
      history: { replaceState: () => undefined, pushState: () => undefined },
      document: { querySelector: () => null },
      addEventListener: (_type: string, listener: (event: Event) => void) => listeners.push(listener),
      removeEventListener: () => undefined,
    };
    const parts = {
      preview: () => Promise.resolve(null),
      camera: () => null,
      simMs: () => null,
      pick: () => Promise.resolve(null),
      scenePath: "scenes/garden.scene.json",
      diskText: JSON.stringify(SCENE),
    };
    expect(startSceneBridge({ ...parts, host: { ...host, location: { href: "x", search: "" } } })).toBeNull();
    const stop = startSceneBridge({ ...parts, host: host });
    await vi.advanceTimersByTimeAsync(100);
    expect(messages).toContainEqual({ workbench: 1, event: "ready", url: host.location.href });
    for (const listener of listeners) {
      listener({
        source: parent,
        origin: ORIGIN,
        data: { workbench: 1, id: 7, call: "scene.query", args: [{}] },
      } as never);
    }
    await vi.advanceTimersByTimeAsync(10);
    const answer = messages.find((message) => (message as { id?: unknown }).id === 7) as
      { result?: unknown } | undefined;
    expect(answer?.result).toMatchObject({ matches: 2, total: 2 });
    stop?.();
    vi.useRealTimers();
  });

  it("checks the sheet arguments; a sheet with times needs a sequence", async () => {
    page();
    expect(sceneSheetArgs({ cameras: ["front"] })).toMatchObject({ times: [], cameras: ["front"], cell: 400 });
    expect(() => sceneSheetArgs({ times: [-1] })).toThrow("must be a list of numbers of at least 0");
    expect(() =>
      sceneSheetArgs({ times: Array.from({ length: 9 }, () => 0), cameras: Array.from({ length: 8 }, () => "a") }),
    ).toThrow("at most 64 cells");
    const port = { preview: () => Promise.resolve(null), camera: () => "front" };
    await expect(sceneSheet(port, { times: [100] })).rejects.toThrow("the scene has no sequence");
  });

  it("draws an index job only for its own scene file as saved, and no free view", async () => {
    page();
    const previews: (string | null)[] = [];
    const port = {
      preview: (camera: string | null) => {
        previews.push(camera);
        return Promise.resolve(null);
      },
      scenePath: "scenes/garden.scene.json",
      diskText: JSON.stringify(SCENE),
    };
    const input = (doc: unknown, view: unknown = "front") => ({
      timeMs: 0,
      view,
      scene: { documents: { "scenes/garden.scene.json": doc }, sequence: null },
    });
    await expect(sceneIndexJob(port, { timeMs: 0, view: null }, 160)).rejects.toThrow("only the frames of a scene");
    await expect(sceneIndexJob(port, input({ ...SCENE, id: "other" }), 160)).rejects.toThrow("is not a frame of");
    await expect(sceneIndexJob(port, input(SCENE, [0, 1, 2, 0, 0, 0, 50]), 160)).rejects.toThrow("free view");
    await expect(sceneIndexJob(port, input(SCENE), 160)).rejects.toThrow("gave no picture");
    expect(previews).toEqual(["front"]);
  });
});
