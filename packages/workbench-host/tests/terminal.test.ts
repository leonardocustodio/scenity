// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the terminals of the host: a real `Bun.Terminal` runs small shell scripts in
 * place of the `claude` CLI and the login shell. No test starts `claude`, so no test calls a model.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost } from "../src/host";
import { isEventOf, type HostEvent, type TerminalKind, type TerminalOpened } from "../src/protocol";
import { ScrollRing, TerminalManager, terminalEnv, type TerminalManagerOptions } from "../src/terminal";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const dir = tempDir("terminal");
afterAll(() => cleanup(dir));

/** A script that echoes, gives the size of its TTY on "size" and exits with the code of "exit <n>". */
const ECHO_SCRIPT = join(dir, "echo.sh");
writeFileSync(
  ECHO_SCRIPT,
  [
    'echo "hello $TERM $COLORTERM"',
    "while read -r line; do",
    '  case "$line" in',
    '    size) echo "size=$(stty size)" ;;',
    '    exit*) exit "${line#exit }" ;;',
    '    *) echo "got:$line" ;;',
    "  esac",
    "done",
  ].join("\n"),
);
/** A script that ignores SIGHUP: only SIGKILL ends it. */
const STUBBORN_SCRIPT = join(dir, "stubborn.sh");
writeFileSync(STUBBORN_SCRIPT, "trap '' HUP\necho stubborn\nwhile :; do sleep 1; done\n");

interface Harness {
  readonly terminals: TerminalManager;
  readonly events: HostEvent[];
  /** The output of a terminal so far. */
  output(id: string): string;
  waitOutput(id: string, pattern: RegExp, timeoutMs?: number): Promise<void>;
  waitExit(id: string): Promise<HostEvent<"terminal.exit">>;
}

function harness(options: Partial<TerminalManagerOptions> = {}): Harness {
  const events: HostEvent[] = [];
  const terminals = new TerminalManager({
    emit: (event) => events.push(event),
    checkout: () => dir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: "/bin/sh" },
    program: (kind) => ["/bin/sh", kind === "shell" ? ECHO_SCRIPT : STUBBORN_SCRIPT],
    killAfterMs: 300,
    ...options,
  });
  const output = (id: string): string =>
    events
      .filter((event) => isEventOf(event, "terminal.output") && event.terminal === id)
      .map((event) => (event as HostEvent<"terminal.output">).data)
      .join("");
  const exitOf = (id: string): HostEvent<"terminal.exit"> | undefined =>
    events.find(
      (event): event is HostEvent<"terminal.exit"> => isEventOf(event, "terminal.exit") && event.terminal === id,
    );
  return {
    terminals,
    events,
    output,
    waitOutput: (id, pattern, timeoutMs = 5000) => until(() => pattern.test(output(id)), timeoutMs, pattern.source),
    waitExit: async (id) => {
      await until(() => exitOf(id) !== undefined, 5000, "the exit event");
      return exitOf(id)!;
    },
  };
}

const open = (h: Harness, kind: TerminalKind, extra: object = {}): Promise<TerminalOpened> =>
  h.terminals.open({ kind, cols: 80, rows: 24, ...extra });

describe("a PTY with a shell script", () => {
  test("echo, the environment, the size, a resize and the exit code", async () => {
    const h = harness();
    const { terminal, attached, exit } = await open(h, "shell");
    expect(attached).toBe(false);
    expect(exit).toBeNull();
    await h.waitOutput(terminal, /hello xterm-256color truecolor/);
    h.terminals.input(terminal, "size\r");
    await h.waitOutput(terminal, /size=24 80/);
    h.terminals.resize(terminal, 100, 30);
    h.terminals.input(terminal, "size\r");
    await h.waitOutput(terminal, /size=30 100/);
    h.terminals.input(terminal, "exit 7\r");
    const ended = await h.waitExit(terminal);
    expect(ended.code).toBe(7);
    expect(ended.signal).toBeNull();
    // The exit event comes after the last output.
    const last = h.events.findLastIndex((event) => isEventOf(event, "terminal.output"));
    expect(h.events.indexOf(ended)).toBeGreaterThan(last);
  });

  test("a page that opens the same ID again gets the scrollback; an unknown ID starts a new terminal", async () => {
    const h = harness();
    const first = await open(h, "shell");
    h.terminals.input(first.terminal, "one\r");
    await h.waitOutput(first.terminal, /got:one/);
    const again = await open(h, "shell", { terminal: first.terminal, cols: 90, rows: 20 });
    expect(again).toMatchObject({ terminal: first.terminal, attached: true, exit: null, checkout: dir });
    expect(again.replay).toContain("hello xterm-256color");
    expect(again.replay).toContain("got:one");
    h.terminals.input(first.terminal, "size\r");
    await h.waitOutput(first.terminal, /size=20 90/);
    const fresh = await open(h, "shell", { terminal: "shell-unknown" });
    expect(fresh.attached).toBe(false);
    expect(fresh.terminal).not.toBe(first.terminal);
    h.terminals.input(first.terminal, "exit 0\r");
    await h.waitExit(first.terminal);
    const ended = await open(h, "shell", { terminal: first.terminal });
    expect(ended.exit).toEqual({ code: 0, signal: null });
    await h.terminals.closeAll();
    expect(h.terminals.ids()).toEqual([]);
  });

  test("close() ends the program; SIGKILL ends a program that ignores SIGHUP", async () => {
    const h = harness();
    const shell = await open(h, "shell");
    await h.waitOutput(shell.terminal, /hello/);
    await h.terminals.close(shell.terminal);
    expect(h.terminals.ids()).not.toContain(shell.terminal);
    const stubborn = await open(h, "claude");
    await h.waitOutput(stubborn.terminal, /stubborn/);
    const start = performance.now();
    await h.terminals.close(stubborn.terminal);
    expect(performance.now() - start).toBeGreaterThanOrEqual(250);
    expect((await h.waitExit(stubborn.terminal)).signal).toBe("SIGKILL");
  });

  test("bad requests give errors", async () => {
    const h = harness();
    expect(() => h.terminals.input("nope", "x")).toThrow('no terminal "nope"');
    await rejectsWith(h.terminals.open({ kind: "shell", cols: -1, rows: 24 }), "sizes");
    await rejectsWith(h.terminals.open({ kind: "shell", cols: 80.5, rows: 24 }), "sizes");
    await rejectsWith(h.terminals.open({ kind: "other" as TerminalKind, cols: 80, rows: 24 }), "kind");
    await rejectsWith(open(h, "claude", { resume: "a b" }), "session ID");
  });
});

describe("the environment and the flags of the claude kind", () => {
  const base = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ANTHROPIC_API_KEY: "sk-test-not-real",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "outer",
    CLAUDE_CODE_USE_VERTEX: "0",
    TERM_PROGRAM: "iTerm.app",
    TERM: "dumb",
  };

  test("terminalEnv removes the API key for claude only, and the variables of an outer session", () => {
    const claude = terminalEnv(base, "claude");
    expect(claude.ANTHROPIC_API_KEY).toBeUndefined();
    expect(claude.CLAUDECODE).toBeUndefined();
    expect(claude.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(claude.TERM_PROGRAM).toBeUndefined();
    expect(claude.CLAUDE_CODE_USE_VERTEX).toBe("0");
    expect(claude).toMatchObject({ TERM: "xterm-256color", COLORTERM: "truecolor" });
    expect(terminalEnv(base, "claude", true).ANTHROPIC_API_KEY).toBe("sk-test-not-real");
    expect(terminalEnv(base, "shell").ANTHROPIC_API_KEY).toBe("sk-test-not-real");
  });

  test("the claude kind runs without ANTHROPIC_API_KEY unless the request asks for it", async () => {
    // The CLI gets `--session-id <uuid>`. The shell prints the environment and ignores the flags.
    const h = harness({ env: base, program: () => ["/bin/sh", "-c", "env", "sh"] });
    const plain = await open(h, "claude");
    await h.waitExit(plain.terminal);
    expect(h.output(plain.terminal)).toContain("TERM=xterm-256color");
    expect(h.output(plain.terminal)).toContain("COLORTERM=truecolor");
    expect(h.output(plain.terminal)).not.toContain("ANTHROPIC_API_KEY");
    expect(h.output(plain.terminal)).not.toContain("CLAUDECODE");
    const keyed = await open(h, "claude", { apiKey: true });
    await h.waitExit(keyed.terminal);
    expect(h.output(keyed.terminal)).toContain("ANTHROPIC_API_KEY=sk-test-not-real");
  });

  test("the claude kind gets the flags and the environment of the settings, and --resume", async () => {
    const h = harness({
      env: { PATH: process.env.PATH },
      program: () => ["/bin/sh", "-c", 'echo "args:$* token:$HOOK_TOKEN"', "sh"],
      claudeLaunch: () => Promise.resolve({ args: ["--settings", "/s.json"], env: { HOOK_TOKEN: "abc" } }),
    });
    const { terminal } = await open(h, "claude", { resume: "1234-abcd" });
    await h.waitExit(terminal);
    expect(h.output(terminal)).toContain("args:--settings /s.json --resume 1234-abcd token:abc");
  });

  test("a new claude terminal gets --session-id and its ID in the environment of the hooks", async () => {
    const recorded: { terminal: string; session: string }[] = [];
    const h = harness({
      env: { PATH: process.env.PATH },
      program: () => ["/bin/sh", "-c", 'echo "args:$* terminal:$SCENITY_WORKBENCH_TERMINAL"', "sh"],
      onSession: (entry) => recorded.push(entry),
    });
    const { terminal } = await open(h, "claude");
    await h.waitExit(terminal);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.terminal).toBe(terminal);
    expect(recorded[0]?.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.output(terminal)).toContain(`args:--session-id ${recorded[0]?.session ?? "?"} terminal:${terminal}`);
    expect(h.terminals.claudeTerminals().map((item) => item.id)).toEqual([terminal]);
  });
});

describe("the scrollback ring", () => {
  test("it keeps the last characters only", () => {
    const ring = new ScrollRing(10);
    ring.push("abcdef");
    ring.push("ghij");
    expect(ring.text()).toBe("abcdefghij");
    ring.push("kl");
    expect(ring.text()).toBe("cdefghijkl");
    ring.push("0123456789XYZ");
    expect(ring.text()).toBe("3456789XYZ");
  });
});

describe("the terminal requests of a running host", () => {
  test("open, input, output events, close and the stop of the host", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("terminal-state");
    const host = await startHost({
      checkout: repo,
      stateDir: state,
      token: "22".repeat(32),
      serverCommand: fakeCommand,
      watch: false,
      terminal: { program: () => ["/bin/sh", ECHO_SCRIPT] },
    });
    const page = await FakePage.open(host.endpoint);
    try {
      const opened = (await page.call("terminal.open", { kind: "shell", cols: 80, rows: 24 })) as TerminalOpened;
      expect(opened.checkout).toBe(repo);
      await page.call("terminal.input", { terminal: opened.terminal, data: "ping\r" });
      await page.waitEvent((event) => isEventOf(event, "terminal.output") && event.data.includes("got:ping"));
      await page.call("terminal.resize", { terminal: opened.terminal, cols: 70, rows: 20 });
      const second = (await page.call("terminal.open", { kind: "shell", cols: 80, rows: 24 })) as TerminalOpened;
      await page.call("terminal.close", { terminal: opened.terminal });
      expect(host.terminals.ids()).toEqual([second.terminal]);
      const bad = await page.request("terminal.resize", { terminal: second.terminal, cols: "wide", rows: 2 });
      expect(bad.ok).toBe(false);
    } finally {
      page.close();
      await host.stop();
      cleanup(parent, state);
    }
    expect(host.terminals.ids()).toEqual([]);
  });
});
