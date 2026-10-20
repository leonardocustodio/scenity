// SPDX-License-Identifier: Apache-2.0
// The Console panel. The log folds a repeated line into one entry with its count. It keeps the entity and the file that
// a line names. It takes the lines of the page, the worker, the dev server, the jobs and the agent tools. The panel
// filters by level, source and words. A click selects the entity or opens the scene file.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import ConsolePanel from "../../src/scene/console/ConsolePanel.vue";
import { CONSOLE_MAX, ConsoleStore, filterEntries, refsOf } from "../../src/scene/console/consoleStore";
import {
  tapJobs,
  tapPageConsole,
  tapServer,
  tapWorkerLog,
  type PageLogHost,
} from "../../src/scene/console/consoleTaps";
import { watchAgentErrors } from "../../src/scene/agent/agentPanel";
import type { AgentSessionView } from "../../src/scene/agent/agentClient";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the log of the Console", () => {
  it("folds a repeated line, counts the levels and keeps the refs of a line", () => {
    const store = new ConsoleStore();
    for (let at = 0; at < 3; at += 1) store.add({ level: "error", source: "worker", text: "boom at entity:lamp", at });
    store.add({ level: "error", source: "page", text: "boom at entity:lamp" });
    store.add({ level: "warn", source: "page", text: "slow load of scenes/main.scene.json:12" });
    const [boom, page, slow] = store.entries.value;
    expect(boom).toMatchObject({ count: 3, first: 0, last: 2, entity: "lamp", source: "worker" });
    expect(page?.count).toBe(1);
    expect(slow?.file).toEqual({ path: "scenes/main.scene.json", line: 12 });
    expect(store.counts()).toEqual({ error: 4, warn: 1, info: 0 });
    expect(refsOf("no refs here")).toEqual({ entity: null, file: null });
    const levels = new Set(["warn"] as const);
    expect(filterEntries(store.entries.value, { levels, source: null, text: "" })).toHaveLength(1);
    expect(
      filterEntries(store.entries.value, { levels: new Set(["error"]), source: "worker", text: "BOOM" }),
    ).toHaveLength(1);
    for (let at = 0; at < CONSOLE_MAX + 5; at += 1)
      store.add({ level: "info", source: "page", text: `line ${String(at)}` });
    expect(store.entries.value).toHaveLength(CONSOLE_MAX);
  });

  it("takes the console of the page, the worker, the dev server, the jobs and the agent tools", async () => {
    const store = new ConsoleStore();
    const written: unknown[][] = [];
    const listeners = new Map<string, (event: Event) => void>();
    const host: PageLogHost = {
      console: {
        error: (...values: unknown[]) => written.push(values),
        warn: (...values: unknown[]) => written.push(values),
        info: (...values: unknown[]) => written.push(values),
        log: (...values: unknown[]) => written.push(values),
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    const stop = tapPageConsole(store, host);
    host.console.error("bad value", { a: 1 });
    host.console.log("hello");
    listeners.get("unhandledrejection")?.({ reason: new Error("lost") } as unknown as Event);
    expect(written).toHaveLength(2);
    stop();
    host.console.error("after the stop");
    let send: ((message: { readonly type: string }) => void) | null = null;
    tapWorkerLog(store, {
      mode: "worker",
      send: () => undefined,
      listen: (listener) => {
        send = listener;
      },
      tick: () => undefined,
      hold: () => undefined,
    });
    (send as ((message: { readonly type: string }) => void) | null)?.({
      type: "workerLog",
      level: "warn",
      text: "worker says\nmore",
    } as { readonly type: string });
    let viteError: ((payload: { err?: { message?: string } }) => void) | null = null;
    tapServer(store, { on: (_event, listener) => (viteError = listener) });
    (viteError as ((payload: { err?: { message?: string } }) => void) | null)?.({
      err: { message: "transform failed" },
    });
    const socket = new EventTarget() as EventTarget & { close(): void };
    socket.close = () => undefined;
    tapJobs(store, () => socket as unknown as WebSocket);
    const job = { type: "jobs.state", job: { argv: ["check"], state: "failed", exitCode: 2 } };
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(job) }));
    const sessions = shallowRef<readonly AgentSessionView[]>([
      {
        id: "s1",
        name: "Chairs",
        items: [
          { id: 3, kind: "tool", name: "scene_command", input: {}, result: "no entity", isError: true, pictures: [] },
        ],
      } as unknown as AgentSessionView,
    ]);
    watchAgentErrors({ sessions }, store);
    await flushPromises();
    expect(store.entries.value.map((entry) => [entry.source, entry.level, entry.text])).toEqual([
      ["page", "error", 'bad value {"a":1}'],
      ["page", "info", "hello"],
      ["page", "error", expect.stringContaining("Unhandled rejection: Error: lost") as string],
      ["worker", "warn", "worker says"],
      ["server", "error", "transform failed"],
      ["job", "error", "scenity check failed (exit 2)"],
      ["agent", "error", "Chairs: scene_command: no entity"],
    ]);
    expect(store.entries.value[3]?.detail).toBe("more");
  });
});

describe("the Console panel", () => {
  it("filters by level and words, and a click selects the entity or opens the scene file", async () => {
    const store = new ConsoleStore();
    store.add({ level: "error", source: "worker", text: "boom at entity:lamp" });
    store.add({ level: "error", source: "worker", text: "boom at entity:lamp" });
    store.add({ level: "warn", source: "page", text: "check scenes/side.scene.json" });
    const calls: string[] = [];
    mount(ConsolePanel, {
      props: {
        store,
        select: (id: string) => calls.push(`select ${id}`),
        openFile: (path: string) => calls.push(`open ${path}`),
      },
      attachTo: document.body,
    });
    const lines = () => document.querySelectorAll<HTMLButtonElement>('[data-testid="console-line"]');
    expect(lines()).toHaveLength(2);
    expect(document.querySelector('[data-testid="console-count"]')?.textContent).toBe("2");
    lines()[0]?.click();
    lines()[1]?.click();
    expect(calls).toEqual(["select lamp", "open scenes/side.scene.json"]);
    await flushPromises();
    expect(document.querySelector('[data-testid="console-detail"]')?.textContent).toContain(
      "check scenes/side.scene.json",
    );
    document.querySelector<HTMLButtonElement>('[data-testid="console-counter"][data-level="warn"]')?.click();
    await flushPromises();
    expect(lines()).toHaveLength(1);
    const search = document.querySelector<HTMLInputElement>('[data-testid="console-search"]');
    if (search === null) throw new Error("no search");
    search.value = "nothing";
    search.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(lines()).toHaveLength(0);
  });
});
