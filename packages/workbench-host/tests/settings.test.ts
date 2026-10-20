// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the generated Claude Code files: the shapes of the files, the file modes, the refusal of a folder in a
 * checkout and the CLI flags.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  claudeArgs,
  MCP_SCRIPT,
  mcpConfigJson,
  ORIGIN_ENV,
  settingsJson,
  terminalPrompt,
  writeClaudeSettings,
} from "../src/settings";
import { scaleTestTimeouts } from "./ciTiming";
import { tempDir } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const ENDPOINT = { origin: "http://127.0.0.1:52141", token: "ab".repeat(32) };

describe("the generated files", () => {
  test("settings.json has one http hook per event with the token header from the environment", () => {
    const settings = settingsJson(ENDPOINT.origin) as {
      hooks: Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]>;
      permissions: unknown;
    };
    expect(Object.keys(settings.hooks)).toEqual([
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "Stop",
      "SessionStart",
      "SessionEnd",
    ]);
    expect(settings.hooks.UserPromptSubmit).toEqual([
      {
        hooks: [
          {
            type: "http",
            url: "http://127.0.0.1:52141/hooks/UserPromptSubmit",
            headers: {
              "x-workbench-token": "$SCENITY_WORKBENCH_TOKEN",
              "x-workbench-terminal": "$SCENITY_WORKBENCH_TERMINAL",
            },
            allowedEnvVars: ["SCENITY_WORKBENCH_TOKEN", "SCENITY_WORKBENCH_TERMINAL"],
            timeout: 30,
          },
        ],
      },
    ]);
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit|Bash");
    expect(settings.hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(settings.hooks.Stop?.[0]?.matcher).toBeUndefined();
    expect(settings.permissions).toEqual({ allow: ["mcp__workbench__*"] });
    expect(JSON.stringify(settings)).not.toContain(ENDPOINT.token);
  });

  test("mcp.json starts the stdio server with Bun and the endpoint", () => {
    expect(mcpConfigJson(ENDPOINT, "/bin/bun")).toEqual({
      mcpServers: {
        workbench: {
          type: "stdio",
          command: "/bin/bun",
          args: [MCP_SCRIPT],
          env: { [ORIGIN_ENV]: ENDPOINT.origin, SCENITY_WORKBENCH_TOKEN: ENDPOINT.token },
        },
      },
    });
    expect(MCP_SCRIPT).toEndWith("/packages/workbench-host/src/mcp.ts");
  });

  test("writeClaudeSettings writes both files with mode 600 into <state>/claude", () => {
    const state = tempDir("settings");
    const files = writeClaudeSettings({ stateDir: state, endpoint: ENDPOINT, bun: "/bin/bun" });
    expect(files.dir).toBe(join(state, "claude"));
    for (const path of [files.mcpConfig, files.settings]) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(() => JSON.parse(readFileSync(path, "utf8")) as unknown).not.toThrow();
    }
    expect(statSync(files.dir).mode & 0o777).toBe(0o700);
    expect(files.env).toEqual({ SCENITY_WORKBENCH_TOKEN: ENDPOINT.token, [ORIGIN_ENV]: ENDPOINT.origin });
    // The workbench lines go into the system prompt. They ask for workbench_run for the labs commands.
    expect(claudeArgs(files)).toEqual([
      "--mcp-config",
      files.mcpConfig,
      "--settings",
      files.settings,
      "--append-system-prompt",
      terminalPrompt(),
    ]);
    expect(terminalPrompt()).toContain("workbench_run, not with Bash");
    // The tools of the scene editor and the rule of the proposals.
    expect(terminalPrompt()).toContain("scene_commands lists its commands and scene_command runs one");
    expect(terminalPrompt()).toContain("only the owner's switch of the session lets an edit apply at once");
  });

  test("refuses a state folder inside a checkout", () => {
    const repo = tempDir("repo");
    expect(() =>
      writeClaudeSettings({ stateDir: join(repo, ".state"), endpoint: ENDPOINT, forbidden: [repo] }),
    ).toThrow("must not go into the checkout");
  });
});
