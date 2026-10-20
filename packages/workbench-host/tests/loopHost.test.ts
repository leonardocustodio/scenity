// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the agent loop through a running host. A fake workbench page relays the surface calls of the visible and
 * the shadow frame. The HTTP routes of the hooks and the tools work as Claude Code calls them. The lab file of the
 * turn is in the temporary repository, not in the lab.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost, type Host } from "../src/host";
import { pictureId } from "../src/pictures";
import { encodePictureFrame, isEventOf, TOKEN_HEADER, type HostEvent } from "../src/protocol";
import type { RunProcess, RunSpawner } from "../src/runs";
import { CHECK_REPORT } from "./fakeLab";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const PAGE = "http://127.0.0.1:5999";
const TOKEN = "44".repeat(32);
const SHEET = {
  width: 1280,
  height: 700,
  mime: "image/webp",
  simMs: [],
  take: "greet",
  lanes: null,
};
let host: Host;
let page: FakePage;
let parent = "";
let repo = "";
let labFile = "";
let clock = 6350;
const state = tempDir("loop-state");
const requests: { where: string; call: string; args: unknown[] }[] = [];
const runs: { argv: readonly string[]; end: (code: number) => void }[] = [];

const spawn: RunSpawner = (argv, options) => {
  let end: (code: number) => void = () => undefined;
  const exited = new Promise<{ code: number | null; signal: string | null }>((done) => {
    end = (code) => done({ code, signal: null });
  });
  runs.push({ argv, end });
  options.onOutput("stdout", "take greet: 9 pass, 0 fail\n");
  return { exited, signal: () => undefined } satisfies RunProcess;
};

function labUrl(): string {
  return `http://127.0.0.1:1/?take=greet&t=${String(clock)}&paused=1&camera=side`;
}

/** The fake frames: the answers of the lab bridge, the ready event of a new shadow. */
function relay(event: HostEvent): void {
  if (isEventOf(event, "surface.state") && typeof event.surface.shadowUrl === "string") {
    const ready = { workbench: 1, event: "ready", url: event.surface.shadowUrl };
    void page.request("surface.report", { surface: "lab", where: "shadow", event: ready });
  }
  if (!isEventOf(event, "surface.request")) return;
  const { request, call, args, where } = event;
  requests.push({ where, call, args });
  if (call === "seek") clock = Number(args[0]);
  const answers: Record<string, unknown> = {
    url: labUrl(),
    capture: { simMs: clock, width: 640, height: 400, mime: "image/webp" },
    check: CHECK_REPORT,
    moments: { start: 0, wave: 6350 },
    sheet: SHEET,
    console: { errors: [], warnings: [] },
    frame: { simMs: clock, stats: null },
  };
  // The picture of a capture or a sheet goes as a binary frame. Then the JSON answer names its byte count.
  const bytes = call === "capture" ? pictureOf(clock) : call === "sheet" ? new Uint8Array([82, 73, 70, 70]) : null;
  if (bytes !== null) page.sendBinary(encodePictureFrame(request, "image/webp", bytes));
  const result = bytes === null ? (answers[call] ?? null) : { ...(answers[call] as object), bytes: bytes.length };
  void page.request("surface.call", { request, result });
}

/** The bytes of the fake picture of a clock time. */
function pictureOf(at: number): Uint8Array {
  return new TextEncoder().encode(`pic${String(at)}`);
}

function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  return fetch(`${host.endpoint.origin}${path}`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: TOKEN, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json() as Promise<Record<string, unknown>>);
}

beforeAll(async () => {
  ({ parent, repo } = await makeRepo());
  labFile = join(repo, "apps/editor/src/core/tunable.ts");
  mkdirSync(join(repo, "apps/editor/src/core"), { recursive: true });
  writeFileSync(labFile, "export const HAT_Y = 0;\n");
  host = await startHost({
    checkout: repo,
    stateDir: state,
    token: TOKEN,
    serverCommand: fakeCommand,
    runSpawn: spawn,
  });
  page = await FakePage.open(host.endpoint);
  page.onEvent = relay;
  await page.call("host.hello", { origin: PAGE });
  await page.waitEvent((event) => isEventOf(event, "surface.state") && event.surface.server.status === "ready");
  const ready = { workbench: 1, event: "ready", url: labUrl() };
  await page.call("surface.report", { surface: "lab", where: "visible", event: ready });
});
afterAll(async () => {
  page.close();
  await host.stop();
  cleanup(parent, state);
});

describe("the agent loop of a host", () => {
  test("the Claude Code files exist in the state folder", () => {
    expect(host.agent.files.mcpConfig.startsWith(state)).toBe(true);
    expect(host.agent.files.env.SCENITY_WORKBENCH_TOKEN).toBe(TOKEN);
  });

  test("UserPromptSubmit adds the packet; the pages get the context.packet event", async () => {
    const out = await post("/hooks/UserPromptSubmit", { session_id: "s1", prompt: "the hat lifts", cwd: repo });
    const context = (out.hookSpecificOutput as { additionalContext?: string }).additionalContext ?? "";
    expect(context).toContain("Workbench context");
    expect(context).toContain("take=greet");
    await page.waitEvent((event) => isEventOf(event, "context.packet"));
  });

  test("lab_sheet runs in the shadow frame; the visible clock does not move", async () => {
    const before = requests.length;
    const result = await post("/tools/lab_sheet", { from: 5000, to: 6000, step: 250 });
    expect(result.isError).toBeUndefined();
    const sheetCalls = requests.slice(before).filter((item) => item.call === "sheet");
    expect(sheetCalls.map((item) => item.where)).toEqual(["shadow"]);
    // The visible lab gives only the key input of its state (`indexInput`, a read). Its clock does not move.
    const visible = requests.slice(before).filter((item) => item.where === "visible");
    expect(visible.map((item) => item.call)).toEqual(["indexInput"]);
    expect(host.surfaces.state("lab").shadowUrl).toContain("panel=0");
  });

  test("an edit after a prompt gives the agent.turn event with before and after, and the turn keeps the file", async () => {
    clock = 6350;
    await post("/hooks/UserPromptSubmit", { session_id: "s2", prompt: "lower the hat hand", cwd: repo });
    const started = Date.now();
    writeFileSync(labFile, "export const HAT_Y = -0.004;\n");
    await post("/hooks/PostToolUse", { session_id: "s2", tool_name: "Edit", tool_input: { file_path: labFile } });
    // The owner moved the clock. Then Vite applied the edit.
    clock = 9000;
    // Vite sends its update after the file watcher saw the edit. The fake page sends it again until the turn comes.
    const hmr = { workbench: 1, event: "hmr", files: ["/src/core/tunable.ts"] };
    const isTurn = (event: HostEvent): boolean =>
      isEventOf(event, "agent.turn") && event.session === "s2" && event.files.length > 0;
    for (let tries = 0; tries < 12 && !page.events.some(isTurn); tries += 1) {
      await Bun.sleep(100);
      await page.call("surface.report", { surface: "lab", where: "visible", event: hmr });
    }
    const turn = await page.waitEvent(isTurn, 3000);
    expect(Date.now() - started).toBeLessThan(3000);
    if (!isEventOf(turn, "agent.turn")) throw new Error("no turn");
    // The event names the pictures by ID. The page reads the bytes at GET /pictures/<id>.
    expect(turn.before?.id).toBe(pictureId(pictureOf(6350)));
    expect(turn.after?.id).toBe(pictureId(pictureOf(6350)));
    const response = await fetch(`${host.endpoint.origin}/pictures/${String(turn.after?.id)}`, {
      headers: { [TOKEN_HEADER]: TOKEN },
    });
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(await response.text()).toBe("pic6350");
    expect(turn.files).toEqual(["apps/editor/src/core/tunable.ts"]);
    await until(() => host.turns.turnFiles(repo, "s2").length === 1, 3000, "the turn files");
  });

  test("PreToolUse refuses git push; Notification reaches the page", async () => {
    const out = await post("/hooks/PreToolUse", {
      session_id: "s2",
      tool_name: "Bash",
      tool_input: { command: "git push" },
    });
    expect((out.hookSpecificOutput as { permissionDecision?: string }).permissionDecision).toBe("deny");
    await post("/hooks/Notification", {
      session_id: "s2",
      message: "Claude needs your permission to use Bash",
      notification_type: "permission_prompt",
    });
    const notice = await page.waitEvent((event) => isEventOf(event, "agent.notify"));
    expect(notice).toMatchObject({ title: "Claude waits for an approval", kind: "permission_prompt" });
  });

  test("the Stop gate: off lets Claude stop; on refuses done while the checks fail", async () => {
    expect(await post("/hooks/Stop", { session_id: "s2" })).toEqual({});
    expect(await page.call("agent.setStopGate", { on: true })).toMatchObject({ on: true });
    const out = await post("/hooks/Stop", { session_id: "s2" });
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("hands.toTarget");
    const checks = requests.filter((item) => item.call === "check" && item.where === "shadow");
    expect(checks.at(-1)?.args).toEqual([[0, 6350]]);
    expect(await page.call("agent.setStopGate", { on: false })).toMatchObject({ on: false });
  });

  test("workbench_run starts the run and gives its summary", async () => {
    const answer = post("/tools/workbench_run", { command: "motion", args: ["greet"] });
    await until(() => runs.length === 1, 3000, "the run");
    runs[0]?.end(0);
    const result = await answer;
    const text = (result.content as { text?: string }[])[0]?.text ?? "";
    expect(text).toContain("labs motion greet");
    expect(text).toContain("passed (exit 0)");
    expect(runs[0]?.argv.slice(1, 5)).toEqual(["run", "labs", "motion", "greet"]);
  });
});
