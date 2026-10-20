// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the hooks of the workbench: the Git refusal list, the
 * hook JSON of each event, the files of a turn and the HTTP routes of the agent parts.
 */
import { describe, expect, test } from "bun:test";
import { createAgentHttp } from "../src/agentHttp";
import { createFrontPackets } from "../src/frontPacket";
import { createPacketCache } from "../src/context";
import { gitRefusal, shellWords, simpleCommands } from "../src/gitGuard";
import { createTurnLog, handleHook, type HookDeps } from "../src/hooks";
import { fakeContext, fakeLab } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

describe("gitRefusal", () => {
  const refused = [
    "git push",
    "git push --force origin main",
    "git -C /tmp/x push",
    "cd apps/editor && git push origin HEAD",
    "git reset --hard HEAD~1",
    "git checkout .",
    "git checkout -- src/a.ts",
    "git checkout -f main",
    "git restore src/a.ts",
    "git restore --staged --worktree src/a.ts",
    "git clean -fd",
    "git stash drop",
    "git stash clear",
    "git branch -D old",
    "git branch --delete --force old",
    "git rebase -i HEAD~3",
    "git commit --amend -m x",
    "git switch --discard-changes main",
    "git filter-branch --tree-filter x",
    "bash -c 'git push origin'",
    "FOO=1 git push",
    "/usr/bin/git reset --hard",
    "git status\ngit push",
  ];
  const allowed = [
    "git status",
    "git diff -- src/a.ts",
    "git log --oneline -5",
    "git add src/a.ts",
    'git commit -m "Fix the hat"',
    "git restore --staged src/a.ts",
    "git checkout -b feature/x",
    "git checkout main",
    "git switch -c feature/y",
    "git stash",
    "git stash pop",
    "git branch -d merged",
    "git clean -n",
    "git reset src/a.ts",
    'echo "git push"',
    "bun run labs motion greet",
    "grep -rn 'reset --hard' docs",
  ];
  test.each(refused)("refuses %p", (command) => {
    expect(gitRefusal(command)).toContain("The workbench refuses git");
  });
  test.each(allowed)("allows %p", (command) => {
    expect(gitRefusal(command)).toBeNull();
  });

  test("reads quotes and operators as the shell does", () => {
    expect(shellWords(`a "b c" 'd' e\\ f&&g|h`)).toEqual(["a", "b c", "d", "e f", "&&", "g", "|", "h"]);
    expect(simpleCommands("a; b || c & d")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });
});

function deps(packet: string | null = "PACKET"): { deps: HookDeps; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    deps: {
      packet: () => packet,
      turns: createTurnLog(),
      onPrompt: (info) => seen.push(`prompt ${String(info.turn)} ${info.prompt}`),
      onEdit: (info) => seen.push(`edit ${String(info.turn)} ${info.tool} ${info.files.join(",")}`),
      onRefuse: (info) => seen.push(`refuse ${info.command}`),
      onNotification: (info) => seen.push(`notify ${info.message} ${info.kind ?? ""}`),
      onStop: (info) => {
        seen.push(`stop ${String(info.turn)} ${info.files.join(",")}`);
      },
      onSessionStart: (info) => seen.push(`start ${info.source ?? ""} ${info.transcript ?? ""}`),
      onSessionEnd: (info) => seen.push(`end ${info.reason ?? ""}`),
    },
  };
}

describe("handleHook", () => {
  const base = { session_id: "s1", cwd: "/repo", transcript_path: "/t.jsonl" };

  test("UserPromptSubmit adds the packet as additional context and starts a turn", async () => {
    const { deps: d, seen } = deps();
    const out = await handleHook("UserPromptSubmit", { ...base, prompt: "what does Jo draw now" }, d);
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "PACKET" } });
    expect(seen).toEqual(["prompt 1 what does Jo draw now"]);
    expect(await handleHook("UserPromptSubmit", base, deps(null).deps)).toEqual({});
  });

  test("PreToolUse denies a history-changing Git command with a reason and allows the rest", async () => {
    const { deps: d, seen } = deps();
    const denied = await handleHook(
      "PreToolUse",
      { ...base, tool_name: "Bash", tool_input: { command: "git push" } },
      d,
    );
    expect(denied).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    const reason = (denied.hookSpecificOutput as { permissionDecisionReason: string }).permissionDecisionReason;
    expect(reason).toContain("git push");
    expect(reason).toContain("Git panel");
    expect(seen).toEqual(["refuse git push"]);
    expect(
      await handleHook("PreToolUse", { ...base, tool_name: "Bash", tool_input: { command: "git status" } }, d),
    ).toEqual({});
    expect(
      await handleHook("PreToolUse", { ...base, tool_name: "Read", tool_input: { command: "git push" } }, d),
    ).toEqual({});
  });

  test("PostToolUse records the files of the turn and calls the host once per edit", async () => {
    const { deps: d, seen } = deps();
    await handleHook("UserPromptSubmit", base, d);
    await handleHook("PostToolUse", { ...base, tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } }, d);
    await handleHook("PostToolUse", { ...base, tool_name: "Write", tool_input: { file_path: "/repo/b.ts" } }, d);
    await handleHook("PostToolUse", { ...base, tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } }, d);
    await handleHook(
      "PostToolUse",
      { ...base, tool_name: "NotebookEdit", tool_input: { notebook_path: "/repo/n.ipynb" } },
      d,
    );
    await handleHook("PostToolUse", { ...base, tool_name: "Read", tool_input: { file_path: "/repo/c.ts" } }, d);
    expect(seen.slice(1)).toEqual([
      "edit 1 Edit /repo/a.ts",
      "edit 1 Write /repo/a.ts,/repo/b.ts",
      "edit 1 Edit /repo/a.ts,/repo/b.ts",
      "edit 1 NotebookEdit /repo/a.ts,/repo/b.ts,/repo/n.ipynb",
    ]);
    await handleHook("Stop", base, d);
    await handleHook("UserPromptSubmit", base, d);
    await handleHook("Stop", base, d);
    expect(seen.slice(-3)).toEqual(["stop 1 /repo/a.ts,/repo/b.ts,/repo/n.ipynb", "prompt 2 ", "stop 2 "]);
  });

  test("Notification, SessionStart and SessionEnd call the host and give {}", async () => {
    const { deps: d, seen } = deps();
    const results = [
      await handleHook(
        "Notification",
        { ...base, message: "Claude needs your permission", notification_type: "permission_prompt" },
        d,
      ),
      await handleHook("SessionStart", { ...base, source: "startup" }, d),
      await handleHook("SessionEnd", { ...base, reason: "prompt_input_exit" }, d),
      await handleHook("Stop", "not an object", d),
    ];
    expect(results).toEqual([{}, {}, {}, {}]);
    expect(seen).toEqual([
      "notify Claude needs your permission permission_prompt",
      "start startup /t.jsonl",
      "end prompt_input_exit",
      "stop 0 ",
    ]);
  });
});

describe("createAgentHttp", () => {
  const lab = fakeLab();
  const packets = createPacketCache(() =>
    Promise.resolve({ surface: "lab", made: "", checkout: "", url: null, text: "THE PACKET" }),
  );
  const front = createFrontPackets({ packets });
  const handler = createAgentHttp({ context: () => fakeContext(lab.port), hooks: deps().deps, front });
  const post = (path: string, body: string) =>
    handler(new Request(`http://127.0.0.1:1${path}`, { method: "POST", body }), new URL(`http://127.0.0.1:1${path}`));

  test("runs a tool, answers a hook and gives the packet", async () => {
    const tool = await post("/tools/lab_tunes", "{}");
    expect(await tool?.json()).toMatchObject({ content: [{ type: "text" }] });
    const hook = await post(
      "/hooks/PreToolUse",
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" } }),
    );
    expect(await hook?.json()).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    const url = new URL("http://127.0.0.1:1/context?surface=lab");
    expect(await (await handler(new Request(url), url))?.text()).toBe("THE PACKET");
  });

  test("gives null for an unknown path or event and 400 for a body that is not JSON", async () => {
    expect(await post("/hooks/Unknown", "{}")).toBeNull();
    expect(await post("/other", "{}")).toBeNull();
    expect((await post("/tools/lab_state", "{bad"))?.status).toBe(400);
  });
});
