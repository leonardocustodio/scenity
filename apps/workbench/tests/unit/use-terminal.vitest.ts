// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the terminal of the Claude panel: `useTerminal` with a fake host client and a fake xterm.js screen, and
 * the panel with its tabs.
 */
import type {
  EventPayload,
  EventType,
  RequestParams,
  RequestResult,
  RequestType,
  TerminalOpened,
} from "@scenity/workbench-host/protocol";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import ClaudePanel from "../../src/claude/ClaudePanel.vue";
import { isWorkbenchKey, useTerminal, type TerminalClient, type XtermKit } from "../../src/claude/useTerminal";

class FakeXterm {
  cols = 80;
  rows = 24;
  written = "";
  resets = 0;
  disposed = false;
  parent: HTMLElement | null = null;
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  #data: ((data: string) => void) | null = null;
  #resize: ((size: { cols: number; rows: number }) => void) | null = null;

  open(parent: HTMLElement): void {
    this.parent = parent;
  }
  /** The callback of the last write; the test runs it to end the parse. */
  parsed: (() => void) | null = null;
  write(data: string, done?: () => void): void {
    this.written += data;
    this.parsed = done ?? null;
  }
  reset(): void {
    this.resets += 1;
    this.written = "";
  }
  focused = 0;
  focus(): void {
    this.focused += 1;
  }
  onData(listener: (data: string) => void) {
    this.#data = listener;
    return { dispose: () => (this.#data = null) };
  }
  onResize(listener: (size: { cols: number; rows: number }) => void) {
    this.#resize = listener;
    return { dispose: () => (this.#resize = null) };
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }
  dispose(): void {
    this.disposed = true;
  }
  /** The owner types. */
  type(data: string): void {
    this.#data?.(data);
  }
  /** The fit addon gives a new size. */
  resizeTo(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.#resize?.({ cols, rows });
  }
}

type Calls = { type: RequestType; params: unknown }[];

/** A fake host client: answers from a table, and a function that sends an event. */
function fakeClient(answers: Partial<Record<RequestType, (params: unknown) => unknown>>) {
  const calls: Calls = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const hellos = new Set<() => void>();
  const client: TerminalClient = {
    request: <T extends RequestType>(type: T, params: RequestParams<T>) => {
      calls.push({ type, params });
      const answer = answers[type];
      if (answer === undefined) return Promise.reject(new Error(`No answer for ${type}.`));
      return Promise.resolve(answer(params) as RequestResult<T>);
    },
    on: <T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void) => {
      const wrapped = (payload: unknown): void => listener(payload as EventPayload<T>);
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    onHello: (listener) => {
      const wrapped = (): void => listener({ protocol: 1, checkout: null, surfaces: [] });
      hellos.add(wrapped);
      return () => hellos.delete(wrapped);
    },
  };
  const emit = <T extends EventType>(type: T, payload: EventPayload<T>): void => {
    for (const listener of listeners.get(type) ?? []) listener(payload);
  };
  const hello = (): void => {
    for (const listener of hellos) listener();
  };
  return { client, calls, emit, hello, listeners };
}

function opened(patch: Partial<TerminalOpened> = {}): TerminalOpened {
  return { terminal: "claude-1", kind: "claude", checkout: "/repo", attached: false, replay: "", exit: null, ...patch };
}

/** A map storage like the session storage. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(answers: Partial<Record<RequestType, (params: unknown) => unknown>>, storage = memoryStorage()) {
  const host = fakeClient(answers);
  const xterm = new FakeXterm();
  const kit: XtermKit = { term: xterm, fit: () => undefined };
  const terminal = useTerminal({
    client: host.client,
    kind: "claude",
    storageKey: "key",
    makeXterm: () => kit,
    storage,
  });
  return { ...host, xterm, terminal, storage };
}

describe("useTerminal", () => {
  it("opens a new PTY with the size of the screen, writes its output and sends the keys", async () => {
    const t = setup({ "terminal.open": () => opened(), "terminal.input": () => null, "terminal.resize": () => null });
    await t.terminal.attach(document.createElement("div"));
    expect(t.calls[0]).toEqual({ type: "terminal.open", params: { kind: "claude", cols: 80, rows: 24 } });
    expect(t.terminal.phase.value).toBe("running");
    expect(t.storage.getItem("key")).toBe("claude-1");
    t.emit("terminal.output", { terminal: "claude-1", data: "\u001b[38;2;1;2;3mhi" });
    t.emit("terminal.output", { terminal: "other", data: "nope" });
    expect(t.xterm.written).toBe("\u001b[38;2;1;2;3mhi");
    t.xterm.type("\u0003");
    t.xterm.resizeTo(100, 30);
    expect(t.calls.slice(1)).toEqual([
      { type: "terminal.input", params: { terminal: "claude-1", data: "\u0003" } },
      { type: "terminal.resize", params: { terminal: "claude-1", cols: 100, rows: 30 } },
    ]);
  });

  it("opens the stored PTY again and writes its scrollback on a clean screen", async () => {
    const storage = memoryStorage();
    storage.setItem("key", "claude-9");
    const t = setup(
      {
        "terminal.open": () => opened({ terminal: "claude-9", attached: true, replay: "old screen" }),
        "terminal.input": () => null,
      },
      storage,
    );
    t.xterm.written = "stale";
    await t.terminal.attach(document.createElement("div"));
    expect(t.calls[0]?.params).toMatchObject({ terminal: "claude-9" });
    expect(t.xterm.resets).toBe(1);
    expect(t.xterm.written).toBe("old screen");
    // The screen answers an old query of the scrollback: the answer must not reach the program.
    t.xterm.type("\u001b[?1;2c");
    t.xterm.parsed?.();
    t.xterm.type("k");
    expect(t.calls.filter((call) => call.type === "terminal.input").map((call) => call.params)).toEqual([
      { terminal: "claude-9", data: "k" },
    ]);
  });

  it("shows the exit, and Restart closes the old PTY and opens a new one", async () => {
    let next = 1;
    const t = setup({
      "terminal.open": () => opened({ terminal: `claude-${String(next++)}` }),
      "terminal.close": () => null,
    });
    await t.terminal.attach(document.createElement("div"));
    t.emit("terminal.exit", { terminal: "claude-1", code: 0, signal: null });
    expect(t.terminal.phase.value).toBe("exited");
    expect(t.terminal.exit.value).toEqual({ code: 0, signal: null });
    t.xterm.type("x");
    expect(t.calls.filter((call) => call.type === "terminal.input")).toEqual([]);
    await t.terminal.restart();
    expect(t.calls.map((call) => call.type)).toEqual(["terminal.open", "terminal.close", "terminal.open"]);
    expect(t.calls[2]?.params).toEqual({ kind: "claude", cols: 80, rows: 24 });
    expect(t.terminal.id.value).toBe("claude-2");
    expect(t.terminal.phase.value).toBe("running");
    expect(t.storage.getItem("key")).toBe("claude-2");
  });

  it("fails without a host and opens again at the next hello", async () => {
    let up = false;
    const t = setup({
      "terminal.open": () => {
        if (!up) throw new Error("The host is not connected.");
        return opened();
      },
    });
    await t.terminal.attach(document.createElement("div"));
    expect(t.terminal.phase.value).toBe("failed");
    expect(t.terminal.error.value).toContain("not connected");
    up = true;
    t.hello();
    await flush();
    expect(t.terminal.phase.value).toBe("running");
  });

  it("ignores the ⌘ chords and removes its listeners at the dispose", async () => {
    const t = setup({ "terminal.open": () => opened() });
    await t.terminal.attach(document.createElement("div"));
    expect(t.xterm.keyHandler?.(new KeyboardEvent("keydown", { key: "\\", metaKey: true }))).toBe(false);
    expect(t.xterm.keyHandler?.(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true);
    expect(isWorkbenchKey(new KeyboardEvent("keydown", { key: "v", metaKey: true }))).toBe(true);
    t.terminal.dispose();
    expect(t.xterm.disposed).toBe(true);
    expect([...t.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});

describe("ClaudePanel", () => {
  it("starts the Claude terminal first, the shell at the first show of its tab, and shows the chat", async () => {
    const host = fakeClient({
      "terminal.open": (params) => opened({ terminal: `${(params as { kind: string }).kind}-1` }),
    });
    const wrapper = mount(ClaudePanel, {
      props: {
        client: host.client,
        checkout: "/repo",
        makeXterm: () => ({ term: new FakeXterm(), fit: () => undefined }),
      },
    });
    await flush();
    expect(host.calls.map((call) => (call.params as { kind: string }).kind)).toEqual(["claude"]);
    expect(wrapper.find("[data-testid=terminal-shell]").exists()).toBe(false);
    await wrapper.get("[data-testid=claude-tab-shell]").trigger("click");
    await flush();
    expect(host.calls.map((call) => (call.params as { kind: string }).kind)).toEqual(["claude", "shell"]);
    expect(wrapper.get("[data-testid=terminal-shell] [data-testid=terminal-restart]").text()).toBe("New shell");
    await wrapper.get("[data-testid=claude-tab-chat]").trigger("click");
    await nextTick();
    // The chat loads in a chunk of its own at the first show of its tab.
    await vi.waitFor(() => expect(wrapper.find("[data-testid=chat-start]").exists()).toBe(true));
    wrapper.unmount();
  });

  it("shows no terminal without a host", () => {
    const wrapper = mount(ClaudePanel, { props: { client: null, checkout: "/repo" } });
    expect(wrapper.find("[data-testid=terminal-claude]").exists()).toBe(false);
    expect(wrapper.text()).toContain("host is connected");
  });
});
