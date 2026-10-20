// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the sessions of the Claude terminals and the export of a transcript: the records by launch and hook, the
 * folder fallback, the requests through a host, and the Markdown of a session file with the denylist. The home folder
 * of the CLI is a temporary folder.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addSessionHandlers, projectKey, TerminalSessions, transcriptFolder } from "../src/terminalSessions";
import { exportFolder, exportTranscript, transcriptMarkdown } from "../src/transcript";
import { Router } from "../src/router";
import type { ClaudeTerminalInfo } from "../src/terminal";
import { cleanup, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const home = tempDir("sessions-home");
const state = tempDir("sessions-state");
const checkout = tempDir("sessions-checkout");
afterAll(() => cleanup(home, state, checkout));

const ID_A = "0b5c2d3e-1111-4222-8333-944455556666";
const ID_B = "1c6d3e4f-2222-4333-9444-a55566667777";
const ID_C = "2d7e4f50-3333-4444-a555-b66677778888";

function line(value: unknown): string {
  return JSON.stringify(value);
}

/** A session file of the CLI with a prompt, a text, a Read of a denylisted file and a Bash call. */
const JSONL = [
  line({ type: "permission-mode", permissionMode: "auto", sessionId: ID_A }),
  line({ type: "user", timestamp: "2026-10-12T22:09:56Z", message: { role: "user", content: "Fix the reach here" } }),
  line({ type: "user", isMeta: true, timestamp: "2026-10-12T22:09:59Z", message: { content: "skill text" } }),
  line({
    type: "assistant",
    timestamp: "2026-10-12T22:10:02Z",
    message: {
      content: [
        { type: "thinking", thinking: "secret plan" },
        { type: "text", text: "I look at the frame first." },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/config/.env" } },
        { type: "tool_use", id: "t2", name: "Bash", input: { command: "bun run labs motion greet" } },
      ],
    },
  }),
  line({
    type: "user",
    timestamp: "2026-10-12T22:10:03Z",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "API_KEY=sk-not-for-the-record" },
        { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "9 pass, 1 known ```" }] },
      ],
    },
  }),
  "not json",
  line({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "side work" }] } }),
].join("\n");

describe("the records of the sessions", () => {
  test("launch, hook and the list of a checkout", () => {
    const sessions = new TerminalSessions({ stateDir: state, home, env: {} });
    sessions.record({ session: ID_A, terminal: "claude-a", checkout, source: "launch" });
    sessions.record({ session: "not-a-uuid", terminal: "claude-a", checkout, source: "launch" });
    sessions.record({ session: ID_B, terminal: "claude-a", checkout, source: "hook" });
    sessions.record({ session: ID_C, terminal: "claude-z", checkout: "/other", source: "launch" });
    expect(sessions.ofTerminal("claude-a")).toBe(ID_B);
    const list = sessions.list(checkout, new Set(["claude-a"]));
    expect(list.map((item) => [item.session, item.source, item.live, item.transcript])).toEqual([
      [ID_B, "hook", true, false],
      [ID_A, "launch", true, false],
    ]);
    expect(projectKey("/Users/leo/Development/Snowpine/scenity")).toBe("-Users-leo-Development-Snowpine-scenity");
    expect(transcriptFolder(checkout, { CLAUDE_CONFIG_DIR: "/cfg" }, home)).toBe(
      join("/cfg", "projects", projectKey(checkout)),
    );
  });

  test("the folder fallback takes the new transcript that names the host, through the request", () => {
    const stateB = tempDir("sessions-state-b");
    const sessions = new TerminalSessions({ stateDir: stateB, home, env: {} });
    const folder = transcriptFolder(checkout, {}, home);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${ID_A}.jsonl`), line({ type: "mode" }));
    writeFileSync(join(folder, `${ID_B}.jsonl`), `${line({ url: "http://127.0.0.1:52180/hooks/PreToolUse" })}\n`);
    // A newer file of another session that does not name the host.
    writeFileSync(join(folder, `${ID_C}.jsonl`), line({ type: "mode" }));
    utimesSync(join(folder, `${ID_C}.jsonl`), new Date(), new Date(Date.now() + 5_000));
    const terminals: ClaudeTerminalInfo[] = [{ id: "claude-f", checkout, startedMs: Date.now() - 1_000, live: true }];
    const router = new Router();
    addSessionHandlers(router, {
      sessions,
      claudeTerminals: () => terminals,
      current: () => checkout,
      origin: "http://127.0.0.1:52180",
    });
    expect(sessions.findInFolder(checkout, Date.now() - 1_000, "http://127.0.0.1:52180")).toBe(ID_B);
    expect(sessions.findInFolder(checkout, Date.now() - 1_000, null)).toBe(ID_C);
    expect(sessions.findInFolder(checkout, Date.now() + 60_000, null)).toBeNull();
    const client = { id: 1, origin: null, role: "admin" as const, send: () => undefined };
    return router.dispatch(JSON.stringify({ id: 1, type: "terminal.sessions" }), client).then((answer) => {
      if (!answer?.ok) throw new Error(`no sessions: ${JSON.stringify(answer)}`);
      const list = (answer.result as { sessions: unknown[] }).sessions;
      expect(list).toEqual([
        expect.objectContaining({ session: ID_B, source: "folder", live: true, transcript: true }),
      ]);
      cleanup(stateB);
    });
  });
});

describe("the export of a transcript", () => {
  test("the Markdown has the prompt, the text and the calls; a denylisted file shows no result", () => {
    const { markdown, messages } = transcriptMarkdown(JSONL, ID_A);
    expect(messages).toBe(2);
    expect(markdown).toContain(`# Transcript of the Claude session ${ID_A}`);
    expect(markdown).toMatch(/## \d\d:\d\d:\d\d Prompt\n\n```text\nFix the reach here\n```/);
    expect(markdown).toContain("Claude:** I look at the frame first.");
    expect(markdown).toContain("call `Bash`:");
    expect(markdown).toContain("(hidden: the call names a file of the workbench denylist)");
    expect(markdown).not.toContain("sk-not-for-the-record");
    expect(markdown).not.toContain("secret plan");
    expect(markdown).not.toContain("skill text");
    expect(markdown).not.toContain("side work");
    // A result with a fence gets a longer fence.
    expect(markdown).toContain("````text\n9 pass, 1 known ```\n````");
  });

  test("the file goes into a folder of the checkout; a folder outside or on the denylist fails", () => {
    const file = join(home, "session.jsonl");
    writeFileSync(file, JSONL);
    const result = exportTranscript({ checkout, session: ID_A, folder: "records/run-1", file });
    expect(result.path).toEndWith(join("records", "run-1", `transcript-${ID_A.slice(0, 8)}.md`));
    expect(readFileSync(result.path, "utf8")).toContain("Fix the reach here");
    expect(() => exportFolder(checkout, "../elsewhere")).toThrow("must be in the checkout");
    expect(() => exportFolder(checkout, ".env.d")).toThrow("does not show or send");
    expect(() => exportTranscript({ checkout, session: ID_B, folder: "records", file: `${file}.absent` })).toThrow(
      "has no transcript",
    );
  });
});
