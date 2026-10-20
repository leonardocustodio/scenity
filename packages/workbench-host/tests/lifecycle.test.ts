// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the life of the host process: the supervisor of main.ts with a
 * lab dev server, a terminal and a run.
 *
 * - SIGTERM ends every child: no process stays in the process groups of the children (`ps` by process group).
 * - SIGKILL of the worker: the supervisor ends the groups that the worker left.
 * - `host.restart`: the same port and token, the lab URL returns, the terminal and the run of the old host show
 *   that they ended, and the old groups end.
 *
 * The checkout is a temporary repository with a fake `vite` (node_modules/.bin of apps/editor) and a fake `labs`
 * script.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGroups } from "../src/children";
import { RESTART_ENDED_TEXT } from "../src/hostProtocol";
import { TOKEN_ENV, parseReadyLine, type HostEndpoint, type HostEvent } from "../src/protocol";
import { cleanup, FakePage, makeRepo, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { hostProgram } from "./hostProgram";
import { stopTracked, trackProcess } from "./hygiene";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "5a".repeat(32);
const folders: string[] = [];
afterAll(async () => {
  // A supervisor that a failed test did not stop ends here, before the removal of its folders.
  await stopTracked();
  cleanup(...folders);
});

/** The fake `vite` of the lab: an HTTP server on `--port` with a child `sleep`, as fixtures/fakeServer.ts. */
const FAKE_VITE = `#!/usr/bin/env bun
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] });
Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("fake lab") });
`;

/** The fake `labs` script of a run: a child `sleep` and a long wait. */
const FAKE_LABS = `Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] });
console.log("fake labs run");
await Bun.sleep(300_000);
`;

/** A repository with the fake lab server and the fake labs script. */
async function fakeCheckout(): Promise<{ repo: string; state: string }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("life-state");
  folders.push(parent, state);
  const bin = join(repo, "apps", "editor", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "vite"), FAKE_VITE);
  chmodSync(join(bin, "vite"), 0o755);
  const web = repo;
  writeFileSync(join(web, "package.json"), JSON.stringify({ name: "fake", scripts: { labs: "bun labs.ts" } }));
  writeFileSync(join(web, "labs.ts"), FAKE_LABS);
  return { repo, state };
}

/** Read the first stdout line of a process. */
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text.split("\n")[0] ?? "";
}

/** The process groups that have a process now. */
function liveGroups(groups: readonly number[]): number[] {
  const out = Bun.spawnSync(["ps", "-A", "-o", "pgid="]).stdout.toString();
  const all = new Set(out.split("\n").map((line) => Number(line.trim())));
  return groups.filter((group) => all.has(group));
}

/** The process IDs of the children of a process. */
function childrenOf(pid: number): number[] {
  const out = Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout.toString();
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(Number);
}

interface Started {
  readonly host: Bun.Subprocess<"ignore", "pipe", "inherit">;
  readonly endpoint: HostEndpoint;
  readonly page: FakePage;
  readonly state: string;
  readonly terminal: string;
  readonly run: string;
}

function isLabReady(event: HostEvent): boolean {
  return event.type === "surface.state" && event.surface.id === "lab" && event.surface.server.status === "ready";
}

/** Start the supervisor, wait for the lab server, open a terminal and start a run. */
async function startAll(): Promise<Started> {
  const { repo, state } = await fakeCheckout();
  const host = trackProcess(
    Bun.spawn([...hostProgram(), "--checkout", repo, "--port", "0", "--state", state], {
      env: {
        ...process.env,
        [TOKEN_ENV]: TOKEN,
        SHELL: "/bin/sh",
      },
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const endpoint = parseReadyLine(await firstLine(host.stdout));
  if (endpoint === null) throw new Error("No READY line.");
  const page = await FakePage.open(endpoint);
  await page.call("host.hello", { origin: "http://127.0.0.1:5999" });
  await page.waitEvent(isLabReady, 20_000);
  const opened = (await page.call("terminal.open", { kind: "shell", cols: 80, rows: 24 })) as { terminal: string };
  const { run } = (await page.call("runs.start", { command: "scenes", args: [] })) as { run: string };
  await until(() => readGroups(state).length >= 3, 10_000, "three child groups");
  return { host, endpoint, page, state, terminal: opened.terminal, run };
}

describe("the end of the host process", () => {
  test(
    "SIGTERM ends the lab server, the terminal and the run with every child",
    async () => {
      const { host, page, state } = await startAll();
      const groups = readGroups(state).map((group) => group.pgid);
      expect(
        readGroups(state)
          .map((group) => group.kind)
          .sort(),
      ).toEqual(["editor dev server", "run", "shell terminal"]);
      expect(liveGroups(groups)).toEqual(groups);
      page.close();
      host.kill("SIGTERM");
      expect(await host.exited).toBe(0);
      await until(() => liveGroups(groups).length === 0, 5_000, "the end of the child groups");
      expect(readGroups(state)).toEqual([]);
    },
    ciWaitMs(60_000),
  );

  test(
    "SIGKILL of the worker: the supervisor ends the groups that it left",
    async () => {
      const { host, page, state } = await startAll();
      const groups = readGroups(state).map((group) => group.pgid);
      const [worker] = childrenOf(host.pid);
      expect(worker).toBeDefined();
      page.close();
      process.kill(worker ?? 0, "SIGKILL");
      expect(await host.exited).toBe(1);
      await until(() => liveGroups(groups).length === 0, 8_000, "the end of the left groups");
    },
    ciWaitMs(60_000),
  );
});

describe("the restart of the host", () => {
  test(
    "host.restart keeps the endpoint and the lab URL; the terminal and the run show their end",
    async () => {
      const { host, endpoint, page, state, terminal, run } = await startAll();
      const groups = readGroups(state).map((group) => group.pgid);
      const lab = (page.events.findLast(isLabReady) as HostEvent<"surface.state">).surface;
      const url = new URL(lab.url ?? "");
      url.searchParams.set("take", "greet");
      url.searchParams.set("t", "6350");
      const event = { workbench: 1, event: "url", url: url.toString() };
      await page.call("surface.report", { surface: "lab", where: "visible", event });
      expect(await page.call("host.restart")).toEqual({ restarting: true });
      await page.waitEvent((item) => item.type === "host.restarting");
      await until(() => liveGroups(groups).length === 0, 10_000, "the end of the old groups");

      let next: FakePage | null = null;
      await until(
        () => {
          if (next === null)
            void FakePage.open(endpoint).then(
              (made) => (next = made),
              () => undefined,
            );
          return next !== null;
        },
        20_000,
        "the new host",
      );
      const fresh = next as unknown as FakePage;
      await fresh.call("host.hello", { origin: "http://127.0.0.1:5999" });
      const ready = await fresh.waitEvent(isLabReady, 20_000);
      const back = new URL((ready as HostEvent<"surface.state">).surface.url ?? "");
      expect([back.searchParams.get("take"), back.searchParams.get("t")]).toEqual(["greet", "6350"]);

      const reopened = (await fresh.call("terminal.open", { kind: "shell", cols: 80, rows: 24, terminal })) as {
        replay: string;
        exit: { signal: string | null } | null;
      };
      expect(reopened.replay).toContain(RESTART_ENDED_TEXT);
      expect(reopened.exit?.signal).toBe("host restart");
      const runs = (await fresh.call("runs.list")) as { run: string; status: string; summary: string }[];
      expect(runs.find((item) => item.run === run)).toMatchObject({ status: "cancelled", summary: RESTART_ENDED_TEXT });

      fresh.close();
      page.close();
      host.kill("SIGTERM");
      expect(await host.exited).toBe(0);
    },
    ciWaitMs(90_000),
  );
});
