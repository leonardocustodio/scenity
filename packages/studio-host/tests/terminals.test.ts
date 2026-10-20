// SPDX-License-Identifier: Apache-2.0
// The terminals of the studio: the cases of the workbench terminal tests
// (packages/workbench-host/tests/terminal.test.ts) on the studio terminals. A real `Bun.Terminal` runs small shell
// scripts in place of the claude CLI and the login shell, so no test calls a model.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER } from "../src/access";
import { freePort } from "../src/process";
import { startStudio } from "../src/server";
import { ScrollRing, terminalEnv, Terminals, type TerminalEvent, type TerminalKind } from "../src/terminals";

const dir = mkdtempSync(join(tmpdir(), "studio-terminals-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

async function until(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await Bun.sleep(10);
  }
}

function harness(refuseShell = false) {
  const events: TerminalEvent[] = [];
  const terminals = new Terminals({
    emit: (event) => events.push(event),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: "/bin/sh" },
    program: (kind) => ["/bin/sh", kind === "shell" ? ECHO_SCRIPT : STUBBORN_SCRIPT],
    killAfterMs: 300,
    refuseShell,
  });
  const output = (id: string): string =>
    events.flatMap((event) => (event.type === "terminal.output" && event.terminal === id ? [event.data] : [])).join("");
  const exitOf = (id: string) => events.find((event) => event.type === "terminal.exit" && event.terminal === id);
  const open = (kind: TerminalKind, extra: object = {}) =>
    terminals.open({ kind, project: "showroom", cwd: dir, cols: 80, rows: 24, ...extra });
  return {
    terminals,
    events,
    output,
    open,
    waitOutput: (id: string, pattern: RegExp) => until(() => pattern.test(output(id)), pattern.source),
    waitExit: async (id: string) => {
      await until(() => exitOf(id) !== undefined, "the exit event");
      return exitOf(id) as Extract<TerminalEvent, { type: "terminal.exit" }>;
    },
  };
}

describe("a PTY of the studio with a shell script", () => {
  test("echo, the environment, the size, a resize and the exit code", async () => {
    const h = harness();
    const { terminal, attached, exit, cwd } = h.open("shell");
    expect([attached, exit, cwd]).toEqual([false, null, dir]);
    await h.waitOutput(terminal, /hello xterm-256color truecolor/);
    h.terminals.input(terminal, "size\r");
    await h.waitOutput(terminal, /size=24 80/);
    h.terminals.resize(terminal, 100, 30);
    h.terminals.input(terminal, "size\r");
    await h.waitOutput(terminal, /size=30 100/);
    h.terminals.input(terminal, "exit 7\r");
    const ended = await h.waitExit(terminal);
    expect([ended.code, ended.signal]).toEqual([7, null]);
    const last = h.events.findLastIndex((event) => event.type === "terminal.output");
    expect(h.events.indexOf(ended)).toBeGreaterThan(last);
  });

  test("a page that opens the same ID again gets the scrollback; an unknown ID starts a new terminal", async () => {
    const h = harness();
    const first = h.open("shell");
    h.terminals.input(first.terminal, "one\r");
    await h.waitOutput(first.terminal, /got:one/);
    const again = h.open("shell", { terminal: first.terminal, cols: 90, rows: 20 });
    expect(again).toMatchObject({ terminal: first.terminal, attached: true, exit: null });
    expect(again.replay).toContain("hello xterm-256color");
    expect(again.replay).toContain("got:one");
    h.terminals.input(first.terminal, "size\r");
    await h.waitOutput(first.terminal, /size=20 90/);
    const fresh = h.open("shell", { terminal: "t-unknown" });
    expect(fresh.attached).toBe(false);
    expect(fresh.terminal).not.toBe(first.terminal);
    await h.terminals.closeAll();
    expect(h.terminals.list()).toEqual([]);
  });

  test("close() ends the program; SIGKILL ends a program that ignores SIGHUP", async () => {
    const h = harness();
    const stubborn = h.open("claude");
    await h.waitOutput(stubborn.terminal, /stubborn/);
    const start = performance.now();
    await h.terminals.close(stubborn.terminal);
    expect(performance.now() - start).toBeGreaterThanOrEqual(250);
    expect((await h.waitExit(stubborn.terminal)).signal).toBe("SIGKILL");
  });

  test("bad requests give errors, and a host that refuses shells refuses the kind shell", () => {
    const h = harness();
    expect(() => h.terminals.input("nope", "x")).toThrow("No terminal nope.");
    expect(() => h.open("shell", { cols: -1 })).toThrow("sizes");
    expect(() => h.open("shell", { cols: 80.5 })).toThrow("sizes");
    expect(() => h.open("other" as TerminalKind)).toThrow("kind");
    expect(() => harness(true).open("shell")).toThrow("no shell");
  });
});

describe("the parts of the terminals", () => {
  test("the environment drops the variables of an outer Claude Code session; the ring keeps the last text", () => {
    const env = terminalEnv({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", TERM_PROGRAM: "iTerm", HOME: "/h" });
    expect(env).toEqual({ HOME: "/h", TERM: "xterm-256color", COLORTERM: "truecolor" });
    const ring = new ScrollRing(5);
    ring.push("abc");
    ring.push("defg");
    expect(ring.text()).toBe("cdefg");
  });

  test("the API of a running studio: open, input, output events and close", async () => {
    const studio = await startStudio({
      port: await freePort(),
      stateDir: join(dir, "state"),
      sceneServer: () => null,
      roots: [dir],
      terminalProgram: () => ["/bin/sh", ECHO_SCRIPT],
    });
    const headers = { [TOKEN_HEADER]: studio.access.secret, "content-type": "application/json" };
    const api = async (path: string, method: string, body?: unknown) =>
      (await (
        await fetch(`${studio.origin}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      ).json()) as Record<string, unknown>;
    try {
      const socket = new WebSocket(`${studio.origin.replace("http", "ws")}/events`, { headers } as never);
      let output = "";
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as { type: string; data?: string };
        if (event.type === "terminal.output") output += event.data ?? "";
      };
      await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
      expect(await api("/api/terminals", "POST", { kind: "shell", project: "none", cols: 80, rows: 24 })).toMatchObject(
        {
          error: "no project none",
        },
      );
      const project = join(dir, "project");
      cpSync(
        join(import.meta.dir, "..", "..", "..", "samples", "showroom", "scenity.project.json"),
        join(project, "scenity.project.json"),
      );
      const key = studio.context.registry.add(project).key;
      const opened = await api("/api/terminals", "POST", { kind: "shell", project: key, cols: 80, rows: 24 });
      expect(opened).toMatchObject({ kind: "shell", cwd: project, attached: false });
      const id = String(opened.terminal);
      await api(`/api/terminals/${id}/input`, "POST", { data: "ping\r" });
      await until(() => output.includes("got:ping"), "the output event");
      expect(await api("/api/terminals", "GET")).toMatchObject({ terminals: [{ terminal: id }] });
      expect(await api(`/api/terminals/${id}`, "DELETE")).toEqual({ ok: true });
      socket.close();
    } finally {
      await studio.stop();
    }
  });
});
