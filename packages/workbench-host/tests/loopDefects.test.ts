// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the hooks for known loop defects. A message of another session starts no turn. A `labs` command in `Bash`
 * gets a note that names `workbench_run`. The `SessionStart` hook gives the session ID with the workbench terminal
 * of the header.
 */
import { describe, expect, test } from "bun:test";
import { hookTerminal } from "../src/agentHttp";
import { createTurnLog, handleHook, type HookDeps } from "../src/hooks";
import { runHint, runOfCommand } from "../src/runHint";
import { isOwnerPrompt } from "../src/ownerPrompt";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const CROSS_SESSION =
  '<cross-session-message from="uds:/tmp/cc-socks/20835.sock" from-name="scenity-06" from-mode="bypass">\n' +
  "CI restructure heads-up from session scenity-06: …\n</cross-session-message>";

function deps(): {
  deps: HookDeps;
  prompts: string[];
  sessions: { session: string | null; terminal: string | null }[];
} {
  const prompts: string[] = [];
  const sessions: { session: string | null; terminal: string | null }[] = [];
  return {
    prompts,
    sessions,
    deps: {
      packet: () => "Workbench context (lab)",
      turns: createTurnLog(),
      onPrompt: ({ prompt }) => prompts.push(prompt),
      onSessionStart: ({ session, terminal }) => sessions.push({ session, terminal }),
    },
  };
}

describe("the prompts of the owner", () => {
  test.each([
    ["Ada's hands do not reach the parcel here", true],
    ["/compact keep the lab notes", true],
    ["<b>bold</b> is fine in a prompt", true],
    ["the <cross-session-message> tag in the middle of a prompt", true],
    [CROSS_SESSION, false],
    ["<task-notification>\n<task-id>b12</task-id>\n</task-notification>", false],
    ["  <system-reminder>x</system-reminder>  ", false],
    ["<local-command-stdout>ok</local-command-stdout>", false],
    ['<some-new-wrapper kind="x">text</some-new-wrapper>', false],
  ] as const)("isOwnerPrompt(%p) is %p", (prompt, owner) => {
    expect(isOwnerPrompt(prompt)).toBe(owner);
  });

  test("a message of another session gets the packet but starts no turn", async () => {
    const { deps: d, prompts } = deps();
    const base = { session_id: "s1", cwd: "/repo" };
    await handleHook("UserPromptSubmit", { ...base, prompt: "fix the reach" }, d);
    await handleHook("PostToolUse", { ...base, tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } }, d);
    const out = await handleHook("UserPromptSubmit", { ...base, prompt: CROSS_SESSION }, d);
    expect(out).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "Workbench context (lab)" },
    });
    // The turn of the owner continues: its number and its files stay.
    expect(d.turns.turn("s1")).toEqual({ turn: 1, files: ["/repo/a.ts"] });
    expect(prompts).toEqual(["fix the reach"]);
    await handleHook("UserPromptSubmit", { ...base, prompt: "a bit less" }, d);
    expect(d.turns.turn("s1").turn).toBe(2);
  });
});

describe("the runs of the project in Bash", () => {
  test.each([
    ["bun run labs motion greet", "motion"],
    ["cd apps/editor && bun run labs verify --quick 2>&1 | tail -20", "verify"],
    ["SCENITY_X=1 bun run labs sheet --take greet --from 0 --to 2000", "sheet"],
    ["bun apps/editor/scripts/labs.ts shot --take storm", "shot"],
    ["(cd apps/editor; bun labs scenes)", "scenes"],
  ])("finds %p", (command, name) => {
    expect(runOfCommand(command)?.id).toBe(name);
    expect(runHint(command)).toContain(`workbench_run (command "${name}")`);
  });

  test.each([
    "bun run labs serve",
    "bun run labs tune-apply x:1",
    "echo bun run labs motion",
    "bun run typecheck",
    "grep -rn 'labs motion' docs",
  ])("leaves %p alone", (command) => {
    expect(runHint(command)).toBeNull();
  });

  test("PreToolUse adds the note and does not block; a Git refusal still wins", async () => {
    const { deps: d } = deps();
    const bash = (command: string) => ({ session_id: "s", tool_name: "Bash", tool_input: { command } });
    const out = await handleHook("PreToolUse", bash("bun run labs motion greet"), d);
    const specific = out.hookSpecificOutput as Record<string, unknown>;
    expect(specific.hookEventName).toBe("PreToolUse");
    expect(specific.permissionDecision).toBeUndefined();
    expect(String(specific.additionalContext)).toContain("mcp__workbench__workbench_run");
    expect(await handleHook("PreToolUse", bash("ls"), d)).toEqual({});
    const refused = await handleHook("PreToolUse", bash("bun run labs motion && git push"), d);
    expect((refused.hookSpecificOutput as Record<string, unknown>).permissionDecision).toBe("deny");
  });
});

describe("the session of a terminal", () => {
  test("the header names the workbench terminal; a literal variable or another text is null", () => {
    const request = (value: string | null) =>
      new Request("http://127.0.0.1/hooks/SessionStart", {
        method: "POST",
        headers: value === null ? {} : { "x-workbench-terminal": value },
      });
    expect(hookTerminal(request("claude-1a2b3c4d"))).toBe("claude-1a2b3c4d");
    expect(hookTerminal(request("$SCENITY_WORKBENCH_TERMINAL"))).toBeNull();
    expect(hookTerminal(request(""))).toBeNull();
    expect(hookTerminal(request(null))).toBeNull();
  });

  test("SessionStart gives the session ID and the terminal to the host", async () => {
    const { deps: d, sessions } = deps();
    const payload = { session_id: "0b5c2d3e-1111-4222-8333-944455556666", source: "startup" };
    expect(await handleHook("SessionStart", payload, d, "claude-1a2b3c4d")).toEqual({});
    expect(sessions).toEqual([{ session: "0b5c2d3e-1111-4222-8333-944455556666", terminal: "claude-1a2b3c4d" }]);
  });
});
