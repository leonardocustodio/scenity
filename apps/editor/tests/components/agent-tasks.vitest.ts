// SPDX-License-Identifier: Apache-2.0
// The background tasks in the editor window. The gate of the page checks the rules on the document after the change
// sets of the session (the core draws it for the check). The Tasks panel starts, lists, searches, opens and stops
// tasks. A group of variants shows a grid of frames when each task is at its end. Keep accepts the change sets of one
// task and rejects the change sets of the other tasks.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { ChangeSet } from "@scenity/editor-core";
import { builtinRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { AgentTaskInfo } from "../../src/scene/agent/agentClient";
import TasksPanel from "../../src/scene/agent/TasksPanel.vue";
import { keepTask, mergeGroup, taskGroups } from "../../src/scene/agent/taskGroups";
import type { PageOp } from "../../src/scene/hierarchy/sceneCommands";
import { createTaskGate, sessionDoc } from "../../src/scene/review/taskGate";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: { lamp: { name: "Lamp", parent: null, index: 0, components: {} } },
} as unknown as SceneDocument;

const SET: ChangeSet<PageOp> = {
  key: "s1#2",
  actor: { kind: "agent", session: "s1", name: "Lamps", colour: "agent-2", turn: 2 },
  title: "Name the lamp",
  ops: [
    {
      key: "p1:0",
      proposal: "p1",
      op: { kind: "scene", op: { op: "set", path: "/entities/lamp/name", value: "Desk lamp" } },
      entity: "lamp",
    },
  ],
} as unknown as ChangeSet<PageOp>;

function gateOf() {
  const shown: (string | null)[] = [];
  const checked: { name: string | undefined; showing: string | null }[] = [];
  let key: string | null = null;
  const gate = createTaskGate({
    editor: { doc: DOC, registry: builtinRegistry() },
    review: { sets: shallowRef([SET]) },
    preview: {
      key: shallowRef(null),
      show: (next) => {
        key = next;
        shown.push(next);
      },
      hide: () => {
        key = null;
        shown.push(null);
      },
    },
    check: (doc) => {
      checked.push({ name: doc.entities.lamp?.name, showing: key });
      return Promise.resolve([{ id: "onFloor", level: "block", status: "fail", detail: "low" }]);
    },
    picture: () => Promise.resolve(null),
  });
  return { gate, shown, checked };
}

describe("the gate of a background task", () => {
  it("checks the rules on the document after the change sets of the session", async () => {
    const { gate, shown, checked } = gateOf();
    expect(
      sessionDoc(
        { editor: { doc: DOC, registry: builtinRegistry() }, review: { sets: shallowRef([SET]) } } as never,
        "s1",
      ).sets,
    ).toBe(1);
    const answer = await gate.gate("s1");
    expect(answer).toEqual({ passed: false, message: expect.stringContaining("onFloor: low") as string, sets: 1 });
    // The core drew the document of the session for the check, and the editor document after it.
    expect(checked).toEqual([{ name: "Desk lamp", showing: "task:s1" }]);
    expect(shown).toEqual(["task:s1", null]);
  });

  it("checks the editor document for a session with no change set, with no preview", async () => {
    const { gate, shown, checked } = gateOf();
    expect((await gate.gate("s9")).sets).toBe(0);
    expect(checked).toEqual([{ name: "Lamp", showing: null }]);
    expect(shown).toEqual([]);
    expect(await gate.frames("s9")).toEqual([]);
  });
});

const TASK: AgentTaskInfo = {
  id: "t1",
  project: "showroom",
  session: "s1",
  name: "Name the lamps",
  colour: "agent-2",
  prompt: "Name the lamps",
  state: "running",
  startedAt: 0,
  endedAt: null,
  budgetUsd: 5,
  maxTurns: 200,
  maxMinutes: 30,
  costUsd: 0.25,
  sets: ["s1#1"],
  branch: "main",
  gate: "rules",
  refusals: 0,
  check: null,
  reason: null,
  pack: null,
};

describe("the Tasks panel", () => {
  it("starts a task, lists the tasks, opens, reviews and stops them, and searches old ones", async () => {
    const calls: string[] = [];
    const done: AgentTaskInfo = {
      ...TASK,
      id: "t0",
      session: "s0",
      name: "Light the chair",
      state: "done",
      check: { passed: true, message: "The rules pass.", at: 1 },
      pack: ".scenity/tasks/t0",
    };
    const tasks = shallowRef<readonly AgentTaskInfo[]>([TASK, done]);
    mounted.push(
      mount(TasksPanel, {
        props: {
          tasks: () => tasks.value,
          start: (request) => {
            calls.push(`start ${JSON.stringify(request)}`);
            return Promise.resolve(TASK);
          },
          stop: (id) => {
            calls.push(`stop ${id}`);
            return Promise.resolve();
          },
          search: (text) => {
            calls.push(`search ${text}`);
            return Promise.resolve([done]);
          },
          waiting: (sets: readonly string[]) => (sets.includes("s1#1") ? 3 : 0),
          open: (session) => calls.push(`open ${session}`),
          review: () => calls.push("review"),
          picture: () => Promise.resolve(null),
          keep: () => null,
          merge: () => null,
        },
        attachTo: document.body,
      }),
    );
    const prompt = document.querySelector<HTMLTextAreaElement>('[data-testid="tasks-prompt"]');
    if (prompt === null) throw new Error("no prompt field");
    prompt.value = "Tidy the names";
    prompt.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>('[data-testid="tasks-start"]')?.click();
    await flushPromises();
    expect(calls).toEqual(['start {"prompt":"Tidy the names","budgetUsd":5,"maxMinutes":30,"gate":"rules"}']);
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="tasks-row"]');
    expect([...rows].map((row) => row.dataset.state)).toEqual(["running", "done"]);
    expect(rows[0]?.textContent).toContain("3 changes wait");
    expect(rows[1]?.querySelector('[data-testid="tasks-gate"]')?.textContent).toBe("The rules pass.");
    expect(rows[1]?.querySelector('[data-testid="tasks-pack"]')?.textContent).toContain(".scenity/tasks/t0/REVIEW.md");
    expect(rows[1]?.querySelector('[data-testid="tasks-stop"]')).toBeNull();
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="tasks-open"]')?.click();
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="tasks-review"]')?.click();
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="tasks-stop"]')?.click();
    expect(calls.slice(1)).toEqual(["open s1", "review", "stop t1"]);
    vi.useFakeTimers();
    const search = document.querySelector<HTMLInputElement>('[data-testid="tasks-search"]');
    if (search === null) throw new Error("no search field");
    search.value = "chair";
    search.dispatchEvent(new Event("input"));
    await flushPromises();
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(calls.at(-1)).toBe("search chair");
    expect(document.querySelectorAll('[data-testid="tasks-row"]')).toHaveLength(1);
  });
});

/** A change set of one op of a session. */
function setOf(session: string, value: string): ChangeSet<PageOp> {
  return {
    ...SET,
    key: `${session}#1`,
    actor: { ...SET.actor, session },
    ops: [{ ...SET.ops[0], key: `${session}:0`, proposal: session }],
    title: value,
  } as unknown as ChangeSet<PageOp>;
}

describe("the groups of parallel tasks", () => {
  const group = (index: number, state: AgentTaskInfo["state"] = "done"): AgentTaskInfo => ({
    ...TASK,
    id: `t${String(index)}`,
    session: `v${String(index)}`,
    name: `Moods ${String(index)}/3`,
    state,
    sets: [`v${String(index)}#1`],
    group: { id: "g1", kind: "variants", index, count: 3 },
  });

  it("keeps one variant: its sets go in, the sets of the other variants go", () => {
    const [view] = taskGroups([group(3), group(1), group(2), { ...TASK, id: "alone" }]);
    if (view === undefined) throw new Error("no group");
    expect(view.tasks.map((task) => task.id)).toEqual(["t1", "t2", "t3"]);
    expect(view.ended).toBe(true);
    const sets = shallowRef<readonly ChangeSet<PageOp>[]>(["v1", "v2", "v3"].map((session) => setOf(session, session)));
    const calls: string[] = [];
    const review = {
      sets,
      accept: (set: ChangeSet<PageOp>, keys: readonly string[]) => (
        calls.push(`accept ${set.key} ${keys.join()}`),
        null
      ),
      reject: (set: ChangeSet<PageOp>) => void calls.push(`reject ${set.key}`),
    };
    expect(keepTask(review, view, "v2")).toBeNull();
    expect(calls).toEqual(["accept v2#1 v2:0", "reject v1#1", "reject v3#1"]);
    calls.length = 0;
    expect(mergeGroup(review, view)).toBeNull();
    expect(calls).toEqual(["accept v1#1 v1:0", "accept v2#1 v2:0", "accept v3#1 v3:0"]);
    expect(taskGroups([group(1), group(2, "running")])[0]?.ended).toBe(false);
  });

  it("starts variants from the panel, and Compare shows the grid when each task is at its end", async () => {
    const started: unknown[] = [];
    const tasks = shallowRef<readonly AgentTaskInfo[]>([group(1), group(2), group(3)]);
    const kept: string[] = [];
    mounted.push(
      mount(TasksPanel, {
        props: {
          tasks: () => tasks.value,
          start: (request) => (started.push(request), Promise.resolve(TASK)),
          stop: () => Promise.resolve(),
          search: () => Promise.resolve([]),
          waiting: () => 1,
          open: () => undefined,
          review: () => undefined,
          picture: () => Promise.resolve(null),
          keep: (_group: unknown, session: string) => (kept.push(session), null),
          merge: () => null,
        },
        attachTo: document.body,
      }),
    );
    const prompt = document.querySelector<HTMLTextAreaElement>('[data-testid="tasks-prompt"]');
    const count = document.querySelector<HTMLInputElement>('[data-testid="tasks-variants"]');
    if (prompt === null || count === null) throw new Error("no form");
    prompt.value = "Three moods";
    prompt.dispatchEvent(new Event("input"));
    count.value = "3";
    count.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>('[data-testid="tasks-start"]')?.click();
    await flushPromises();
    expect(started).toEqual([{ prompt: "Three moods", budgetUsd: 5, maxMinutes: 30, gate: "rules", variants: 3 }]);
    // One Compare button for the group, on its first task.
    const compare = document.querySelectorAll<HTMLButtonElement>('[data-testid="tasks-compare"]');
    expect(compare).toHaveLength(1);
    compare[0]?.click();
    await flushPromises();
    expect(document.querySelectorAll('[data-testid="task-grid-cell"]')).toHaveLength(3);
    document.querySelectorAll<HTMLButtonElement>('[data-testid="task-grid-keep"]')[1]?.click();
    await flushPromises();
    expect(kept).toEqual(["v2"]);
    expect(document.querySelector('[data-testid="task-grid"]')).toBeNull();
  });
});
