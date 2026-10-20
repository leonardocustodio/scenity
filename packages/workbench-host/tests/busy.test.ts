// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the busy state of the host (busy.ts). A run, a background run, a chat session and the output of the Claude
 * terminal make the host busy at once. The host is idle again after a pause. The signal line has the prefix that the
 * shell reads. The supervisor gives the signal lines to its stdout.
 */
import { describe, expect, test } from "bun:test";
import { BusyTracker, formatSignal, SIGNAL_PREFIX, watchBusy, type BusySources } from "../src/busy";
import type { HostEvent } from "../src/protocol";

function sources(runs = 0, claude: readonly string[] = ["t-claude"]): BusySources {
  return { runsRunning: () => runs, isClaudeTerminal: (id) => claude.includes(id) };
}

function tracker(idleAfterMs = 30): { tracker: BusyTracker; sent: boolean[] } {
  const sent: boolean[] = [];
  return { tracker: new BusyTracker({ emit: (busy) => sent.push(busy), idleAfterMs }), sent };
}

const agent = (state: string): HostEvent =>
  ({ type: "agent.status", info: { session: "chat-1", state } }) as unknown as HostEvent;

describe("the busy tracker", () => {
  test("a run makes the host busy at once, and idle after the pause", async () => {
    const { tracker: busy, sent } = tracker();
    busy.observe({ type: "runs.output", run: "r1", stream: "stdout", data: "x" }, sources(1));
    expect(sent).toEqual([true]);
    busy.observe({ type: "runs.output", run: "r1", stream: "stdout", data: "y" }, sources(1));
    expect(sent).toEqual([true]);
    busy.observe({ type: "runs.done", run: "r1", code: 0, summary: "", outDir: null, images: [] }, sources(0));
    expect(sent).toEqual([true]);
    await Bun.sleep(80);
    expect(sent).toEqual([true, false]);
    expect(busy.busy()).toBe(false);
  });

  test("a chat session is busy while it starts, runs or waits", async () => {
    const { tracker: busy, sent } = tracker();
    busy.observe(agent("running"), sources());
    busy.observe(agent("waiting"), sources());
    expect(sent).toEqual([true]);
    busy.observe(agent("idle"), sources());
    await Bun.sleep(80);
    expect(sent).toEqual([true, false]);
  });

  test("a background run is busy until it ends", () => {
    const { tracker: busy, sent } = tracker(10_000);
    const loop = (status: string): HostEvent =>
      ({ type: "loops.state", loop: { loop: "bg-1", status } }) as unknown as HostEvent;
    busy.observe(loop("running"), sources());
    busy.observe(loop("checking"), sources());
    expect(sent).toEqual([true]);
    expect(busy.working()).toBe(true);
    busy.observe(loop("done"), sources());
    expect(busy.working()).toBe(false);
    busy.stop();
  });

  test("only the output of a Claude terminal counts, and work in the pause keeps the host busy", async () => {
    const { tracker: busy, sent } = tracker(60);
    busy.observe({ type: "terminal.output", terminal: "t-shell", data: "ls" }, sources());
    expect(sent).toEqual([]);
    busy.observe({ type: "terminal.output", terminal: "t-claude", data: "✻" }, sources());
    expect(sent).toEqual([true]);
    await Bun.sleep(30);
    busy.observe({ type: "terminal.output", terminal: "t-claude", data: "✻" }, sources());
    await Bun.sleep(40);
    expect(sent).toEqual([true]);
    await Bun.sleep(120);
    expect(sent).toEqual([true, false]);
  });

  test("other events do not change the state", () => {
    const { tracker: busy, sent } = tracker();
    busy.observe({ type: "terminal.exit", terminal: "t-claude", code: 0, signal: null }, sources(3));
    expect(sent).toEqual([]);
  });
});

describe("the signal", () => {
  test("the line has the prefix of the shell and a JSON object", () => {
    expect(formatSignal({ busy: true })).toBe(`${SIGNAL_PREFIX}{"busy":true}`);
    expect(SIGNAL_PREFIX).toBe("WORKBENCH_SIGNAL ");
  });

  test("watchBusy sees every broadcast and keeps the broadcast", () => {
    const seen: HostEvent[] = [];
    const server = { broadcast: (event: HostEvent) => void seen.push(event) };
    const sent: boolean[] = [];
    watchBusy(server, sources(1), { emit: (busy) => sent.push(busy), idleAfterMs: 10 });
    const event: HostEvent = { type: "runs.output", run: "r", stream: "stdout", data: "x" };
    server.broadcast(event);
    expect(seen).toEqual([event]);
    expect(sent).toEqual([true]);
  });

  test("the supervisor gives a signal line of the worker to its stdout, and other lines to stderr", async () => {
    const script = [
      'process.stdout.write("WORKBENCH_READY {\\"origin\\":\\"http://127.0.0.1:1\\",\\"token\\":\\"x\\"}\\n");',
      'process.stdout.write("plain line\\nWORKBENCH_SIGNAL {\\"busy\\":true}\\n");',
    ].join("\n");
    const code = `
      const { supervise } = await import(${JSON.stringify(`${import.meta.dir}/../src/supervisor.ts`)});
      const file = ${JSON.stringify(`${import.meta.dir}/../.out-busy-worker.ts`)};
      await Bun.write(file, ${JSON.stringify(script)});
      const exit = await supervise({ checkout: "/nowhere", port: 0, stateDir: "/tmp/none-busy" }, { main: file, retries: 0, ready: () => undefined });
      (await import("node:fs")).rmSync(file);
      process.exit(exit);`;
    const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    expect(out).toBe('WORKBENCH_SIGNAL {"busy":true}\n');
    expect(err).toContain("plain line");
    expect(err).not.toContain("WORKBENCH_SIGNAL");
  });
});
