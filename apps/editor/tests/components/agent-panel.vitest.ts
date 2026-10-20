// SPDX-License-Identifier: Apache-2.0
// The agent panel. The store reads the sessions of the host and follows its events. A prompt with no session makes a
// session. The mode of the active session sets the proposal switch of the window. The panel shows the tabs, the
// transcript, the cost and the context share, and it sends and stops.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentClient,
  AgentEvent,
  AgentPatch,
  AgentSessionInfo,
  AgentSessionView,
} from "../../src/scene/agent/agentClient";
import AgentPanel from "../../src/scene/agent/AgentPanel.vue";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { t } from "../../src/texts";
import { agentCommands } from "../../src/scene/agent/agentPanel";
import { applyEvent, createAgentStore, exportText } from "../../src/scene/agent/agentStore";
import { autoChips, mentionChip } from "../../src/scene/agent/agentContext";
import type { AgentContextPort } from "../../src/scene/agent/agentChips";
import { regionOf } from "../../src/scene/agent/viewRegion";
import { cardOf } from "../../src/scene/agent/agentCards";
import AgentToolCard from "../../src/scene/agent/AgentToolCard.vue";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

const find = (testId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

/** A fake host: its sessions, the calls and the event listener. */
function fakeHost() {
  const calls: string[] = [];
  const sent: string[][] = [];
  let listener: ((event: AgentEvent) => void) | null = null;
  let count = 0;
  const info = (id: string, patch: Partial<AgentSessionInfo> = {}): AgentSessionInfo => ({
    id,
    project: "showroom",
    name: `Session ${id}`,
    colour: "agent-1",
    mode: "review",
    model: "opus",
    effort: "high",
    running: false,
    queued: 0,
    costUsd: 0,
    contextShare: null,
    ...patch,
  });
  const client: AgentClient = {
    list: () =>
      Promise.resolve({
        driver: "script",
        modes: ["ask", "review", "auto"],
        models: ["opus", "sonnet"],
        efforts: ["low", "high"],
        sessions: [],
      }),
    create: () => {
      count += 1;
      calls.push("create");
      return Promise.resolve({ ...info(`s${String(count)}`), items: [] } satisfies AgentSessionView);
    },
    update: (id, patch: AgentPatch) => {
      calls.push(`update ${JSON.stringify(patch)}`);
      return Promise.resolve(info(id, patch));
    },
    prompt: (id, text, context = []) => {
      calls.push(`prompt ${id} ${text}`);
      sent.push(context.map((chip) => chip.text));
      return Promise.resolve({ queued: 0 });
    },
    stop: (id) => {
      calls.push(`stop ${id}`);
      return Promise.resolve();
    },
    close: (id) => {
      calls.push(`close ${id}`);
      return Promise.resolve();
    },
    fork: (id) => {
      calls.push(`fork ${id}`);
      return Promise.resolve({ ...info("f1", { name: "Fork" }), items: [] });
    },
    undoTurn: (id, turn) => {
      calls.push(`undo ${id} ${String(turn)}`);
      return Promise.resolve({});
    },
    restore: (id, turn) => {
      calls.push(`restore ${id} ${String(turn)}`);
      return Promise.resolve({});
    },
    status: () => Promise.resolve({ available: true, driver: "script" }),
    tasks: () => Promise.resolve({ tasks: [] }),
    startTask: () => Promise.reject(new Error("no tasks")),
    stopTask: () => Promise.reject(new Error("no tasks")),
    connections: () => Promise.resolve({ connections: [] }),
    allowConnection: () => Promise.resolve(),
    denyConnection: () => Promise.resolve(),
    addConnection: () => Promise.reject(new Error("no host")),
    revokeConnection: () => Promise.resolve(),
    recipes: () => Promise.resolve({ recipes: [] }),
    instructions: () => Promise.resolve({ agents: null, claude: null, skills: [] }),
    saveInstructions: (_project, agents) => Promise.resolve({ agents, claude: null, skills: [] }),
    answerQuestion: (id, question, answer) => {
      calls.push(`question ${id} ${question} ${answer}`);
      return Promise.resolve();
    },
    answer: (id, approval, decision) => {
      calls.push(`answer ${id} ${approval} ${decision}`);
      return Promise.resolve();
    },
    turns: () => Promise.resolve({ turns: [{ turn: 1, files: ["notes.md"] }] }),
    events: (next, opened) => {
      listener = next;
      opened?.();
      return () => (listener = null);
    },
  };
  return { client, calls, sent, info, emit: (event: AgentEvent) => listener?.(event) };
}

describe("the agent store", () => {
  it("applies the events: a new session, an item, a change of an item and a closed session", () => {
    const host = fakeHost();
    let sessions = applyEvent([], { type: "agent.session", session: host.info("a") });
    sessions = applyEvent(sessions, { type: "agent.item", session: "a", item: { id: 1, kind: "text", text: "hi" } });
    sessions = applyEvent(sessions, { type: "agent.item", session: "a", item: { id: 1, kind: "text", text: "ho" } });
    expect(sessions[0]?.items).toEqual([{ id: 1, kind: "text", text: "ho" }]);
    expect(applyEvent(sessions, { type: "agent.closed", session: "a" })).toEqual([]);
    expect(exportText(sessions[0]!, t)).toBe("# Session a\n\nMode review, model opus, effort high.\n\nho\n");
  });

  it("makes a session for a prompt, and the mode sets the switch of the window", async () => {
    const host = fakeHost();
    const switches: string[] = [];
    const store = createAgentStore({
      project: "showroom",
      client: host.client,
      setSwitch: (mode) => switches.push(mode),
    });
    store.start();
    await flushPromises();
    expect(store.choices.value?.driver).toBe("script");
    store.draft.value = "add a lamp";
    await store.submit();
    expect(host.calls).toEqual(["create", "prompt s1 add a lamp"]);
    expect(store.draft.value).toBe("");
    await store.patch({ mode: "auto" });
    expect(switches).toEqual(["propose", "apply"]);
    host.emit({ type: "agent.session", session: host.info("other", { project: "spin" }) });
    expect(store.sessions.value.map((item) => item.id)).toEqual(["s1"]);
  });
});

describe("the agent panel", () => {
  it("shows the tabs, the transcript and the cost, and sends and stops", async () => {
    const host = fakeHost();
    const store = createAgentStore({ project: "showroom", client: host.client, setSwitch: () => undefined });
    store.start();
    await flushPromises();
    await store.create();
    mounted.push(mount(AgentPanel, { props: { store, run: () => undefined }, attachTo: document.body }));
    host.emit({
      type: "agent.session",
      session: host.info("s1", { running: true, costUsd: 0.42, contextShare: 0.18 }),
    });
    host.emit({ type: "agent.item", session: "s1", item: { id: 1, kind: "prompt", text: "add a lamp" } });
    host.emit({
      type: "agent.item",
      session: "s1",
      item: {
        id: 2,
        kind: "tool",
        name: "scene_command",
        input: { command: "entity.create" },
        result: null,
        isError: false,
        pictures: [],
      },
    });
    await flushPromises();
    expect(document.querySelectorAll('[data-testid="agent-tab"]')).toHaveLength(1);
    expect(find("agent-transcript")?.textContent).toContain("add a lamp");
    expect(find("agent-card-title")?.textContent).toBe("entity.create");
    expect(find("agent-cost")?.textContent.replace(/\s+/g, " ").trim()).toBe("$0.42 · 18 % context");
    find("agent-stop")?.click();
    await flushPromises();
    expect(host.calls).toContain("stop s1");
    const notices = new WindowNotices();
    const commands = agentCommands(store, { showPanel: () => undefined, notices });
    const rename = commands.find((command) => command.id === "agent.rename")?.run({});
    notices.answer("go", "Chairs");
    await rename;
    expect(host.calls).toContain('update {"name":"Chairs"}');
    const send = commands.find((command) => command.id === "agent.send");
    expect(send?.when?.()).not.toBeNull();
    const composer = find("agent-composer") as HTMLTextAreaElement;
    composer.value = "warmer";
    composer.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(send?.when?.()).toBeNull();
    find("agent-send")?.click();
    await flushPromises();
    expect(host.calls).toContain("prompt s1 warmer");
    await commands.find((command) => command.id === "agent.fork")?.run({});
    expect(store.active.value).toBe("f1");
    expect(document.querySelectorAll('[data-testid="agent-tab"]')).toHaveLength(2);
  });
});

/** A context port with a selection, a camera and two mentions. */
function contextPort(selection: string[]): AgentContextPort {
  return {
    auto: () =>
      autoChips({
        scene: () => "scenes/main.scene.json",
        selection: () => selection.map((id) => ({ id, name: id === "table" ? "Table" : id })),
        time: () => ({ sequence: "sequences/intro.sequence.json", ms: 2500 }),
        camera: () => ({ name: "editor camera", position: [1, 2, 3], target: [0, 0, 0] }),
        panel: () => "inspector",
      }),
    mentions: (query) =>
      [mentionChip("entity", "lamp", "Desk lamp"), mentionChip("rule", "max-lights", "max-lights")].filter((chip) =>
        chip.label.toLowerCase().includes(query.toLowerCase()),
      ),
    entity: (id) => mentionChip("entity", id, id),
    region: () => Promise.resolve(null),
    names: { command: (id) => id, entity: (id) => id },
    known: () => true,
    show: () => undefined,
    waiting: () => 0,
    openReview: () => undefined,
    acceptAll: () => null,
    checkpointDiff: () => [],
    previewCheckpoint: () => undefined,
    previewKey: () => null,
  };
}

describe("the context chips", () => {
  it("come by themselves from the window, and a mention has a stable reference", () => {
    const chips = autoChips({
      scene: () => "scenes/main.scene.json",
      selection: () => [{ id: "table", name: "Table" }],
      time: () => ({ sequence: "sequences/intro.sequence.json", ms: 2500 }),
      camera: () => ({ name: "editor camera", position: [1, 2, 3], target: [0, 0, 0] }),
      panel: () => "inspector",
    });
    expect(chips.map((chip) => [chip.kind, chip.label, chip.text])).toEqual([
      ["scene", "main.scene.json", "scenes/main.scene.json"],
      ["selection", "Table", "table (Table)"],
      ["time", "t=2.5 s", "2.5 s in sequences/intro.sequence.json"],
      ["camera", "Scene view", "editor camera at (1, 2, 3) looking at (0, 0, 0)"],
      ["panel", "Inspector", "the person looks at the inspector panel"],
    ]);
    expect(mentionChip("entity", "lamp", "Desk lamp").text).toBe('entity:lamp "Desk lamp"');
    expect(mentionChip("sequence", "sequences/a.sequence.json", "a").text).toBe('sequences/a.sequence.json "a"');
  });

  it("a removed chip leaves the packet of the next prompt only; a mention from @ joins it", async () => {
    const host = fakeHost();
    const selection = ["table"];
    const store = createAgentStore({
      project: "showroom",
      client: host.client,
      setSwitch: () => undefined,
      context: contextPort(selection),
    });
    store.start();
    await flushPromises();
    await store.create();
    mounted.push(mount(AgentPanel, { props: { store, run: () => undefined }, attachTo: document.body }));
    await flushPromises();
    const kinds = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="agent-chip"]')].map((chip) => chip.dataset.kind ?? "");
    expect(kinds()).toEqual(["scene", "selection", "time", "camera", "panel"]);
    document.querySelector<HTMLElement>('[data-key="auto:camera"] [data-testid="agent-chip-remove"]')?.click();
    await flushPromises();
    expect(kinds()).not.toContain("camera");
    const composer = find("agent-composer") as HTMLTextAreaElement;
    composer.value = "light @desk";
    composer.setSelectionRange(composer.value.length, composer.value.length);
    composer.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(document.querySelectorAll('[data-testid="agent-mention"]')).toHaveLength(1);
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(store.draft.value).toBe("light ");
    expect(kinds()).toContain("entity");
    await store.submit();
    expect(host.sent.at(-1)).toEqual([
      "scenes/main.scene.json",
      "table (Table)",
      "2.5 s in sequences/intro.sequence.json",
      "the person looks at the inspector panel",
      'entity:lamp "Desk lamp"',
    ]);
    // After the prompt, the camera chip returns and the mention goes.
    await flushPromises();
    expect(kinds()).toEqual(["scene", "selection", "time", "camera", "panel"]);
  });

  it("a drag gives the region of the view as shares, or the whole view for a click", () => {
    const box = new DOMRect(100, 100, 400, 200);
    expect(regionOf(box, { x: 200, y: 150 }, { x: 300, y: 250 })).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.25,
      height: 0.5,
    });
    expect(regionOf(box, { x: 200, y: 150 }, { x: 202, y: 151 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("the tool cards", () => {
  const names = {
    command: (id: string) => (id === "entity.move" ? "Move" : id),
    entity: (id: string) => id.toUpperCase(),
  };
  const known = (id: string): boolean => ["chair", "table"].includes(id);
  const tool = (name: string, input: unknown, result: string | null, isError = false) => ({
    id: 1,
    kind: "tool" as const,
    name,
    input,
    result,
    isError,
    pictures: [] as string[],
  });

  it("gives each core tool a sentence, its targets and its state", () => {
    const move = cardOf(
      tool("scene_command", { command: "entity.move", args: { entity: "chair", x: 1 } }, "Proposal p1 (…)"),
      names,
      known,
    );
    expect(move).toMatchObject({ title: "Move ▸ CHAIR", targets: ["chair"], state: "proposed" });
    const batch = cardOf(
      tool(
        "scene_batch",
        { title: "Lay out", steps: [{ command: "entity.move", args: { entity: "table" } }, { command: "x" }] },
        "Applied",
      ),
      names,
      known,
    );
    expect(batch).toMatchObject({ title: "2 commands: Lay out", targets: ["table"], state: "done" });
    expect(cardOf(tool("job_run", { command: "check", args: ["--json"] }, null), names, known)).toMatchObject({
      title: "Run scenity check --json",
      state: "running",
    });
    expect(cardOf(tool("job_output", { job: "job-1" }, "ok"), names, known)).toMatchObject({ output: true });
    expect(cardOf(tool("scene_query", { ids: ["ghost"] }, "bad", true), names, known)).toMatchObject({
      title: "Read the entities",
      targets: [],
      state: "failed",
    });
    for (const name of [
      "studio_state",
      "scene_commands",
      "scene_frame",
      "scene_measure",
      "scene_pick",
      "scene_sheet",
    ]) {
      expect(cardOf(tool(name, {}, "ok"), names, known).title).not.toBe(name);
    }
    for (const name of ["ui_state", "ui_reveal", "ui_highlight", "ui_notify", "job_status"]) {
      expect(cardOf(tool(name, {}, "ok"), names, known).title).not.toBe(name);
    }
  });

  it("shows the pictures, the raw call and Show in the scene", async () => {
    const shown: (readonly string[])[] = [];
    const item = {
      ...tool("scene_command", { command: "entity.move", args: { entity: "chair" } }, "Applied"),
      pictures: ["p1"],
    };
    mounted.push(
      mount(AgentToolCard, {
        props: { item, names, known, show: (ids: readonly string[]) => shown.push(ids) },
        attachTo: document.body,
      }),
    );
    await flushPromises();
    expect(find("agent-card-picture")?.getAttribute("src")).toBe("/api/agent/pictures/p1");
    expect(find("agent-card-raw")?.textContent).toContain('"command": "entity.move"');
    find("agent-card-show")?.click();
    expect(shown).toEqual([["chair"]]);
  });
});
