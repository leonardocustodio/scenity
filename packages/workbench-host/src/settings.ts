// SPDX-License-Identifier: Apache-2.0
/**
 * The generated Claude Code files of the workbench: the MCP config with the `workbench` stdio server and the
 * settings with the `http` hooks and the permission rule. They go to `<state>/claude/` and never into the
 * repository. A check with the CLI 2.1.296 showed that these shapes work: an `http` hook with the token header from
 * an environment variable named in `allowedEnvVars`, and a stdio server entry in `--mcp-config`.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { bunPath, hostSourceFile } from "./hostRuntime";
import { HOST_PATHS, TOKEN_ENV, TOKEN_HEADER, type HookEvent, type HostEndpoint } from "./protocol";

/** The environment variable with the origin of the host (the stdio MCP server reads it). */
export const ORIGIN_ENV = "SCENITY_WORKBENCH_ORIGIN";
/** The variable with the ID of the workbench terminal of the CLI. The hooks send it as a header. */
export const TERMINAL_ENV = "SCENITY_WORKBENCH_TERMINAL";
/** The header of a hook with the workbench terminal (the `SessionStart` hook records the session ID with it). */
export const TERMINAL_HEADER = "x-workbench-terminal";
/** The name of the MCP server: its tools are `mcp__workbench__<tool>`. */
export const MCP_SERVER_NAME = "workbench";
/** The permission rule that lets the workbench tools run without a prompt. */
export const TOOLS_RULE = "mcp__workbench__*";
/** The absolute path of the stdio MCP server script. */
// The source file also for a compiled host (hostRuntime.ts).
export const MCP_SCRIPT = hostSourceFile("mcp.ts");

/** The hooks of the generated settings: the event, the matcher of the tool name and the timeout (s). */
export const HOOKS: readonly { readonly event: HookEvent; readonly matcher?: string; readonly timeout: number }[] = [
  { event: "UserPromptSubmit", timeout: 30 },
  { event: "PreToolUse", matcher: "Bash", timeout: 30 },
  // Also `Bash`, because a command can change files (the turn and its undo must know them).
  { event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash", timeout: 30 },
  { event: "Notification", timeout: 30 },
  { event: "Stop", timeout: 300 },
  { event: "SessionStart", timeout: 30 },
  { event: "SessionEnd", timeout: 30 },
];

/** The settings JSON: one `http` hook per event to `<origin>/hooks/<event>`, and the allow rule of the tools. */
export function settingsJson(origin: string): Record<string, unknown> {
  const hooks = Object.fromEntries(
    HOOKS.map(({ event, matcher, timeout }) => [
      event,
      [
        {
          ...(matcher === undefined ? {} : { matcher }),
          hooks: [
            {
              type: "http",
              url: `${origin}${HOST_PATHS.hooks}${event}`,
              headers: { [TOKEN_HEADER]: `$${TOKEN_ENV}`, [TERMINAL_HEADER]: `$${TERMINAL_ENV}` },
              allowedEnvVars: [TOKEN_ENV, TERMINAL_ENV],
              timeout,
            },
          ],
        },
      ],
    ]),
  );
  return { hooks, permissions: { allow: [TOOLS_RULE] } };
}

/** The MCP config JSON: the stdio server `workbench` (`bun <abs>/src/mcp.ts`) with the endpoint of the host. */
export function mcpConfigJson(endpoint: HostEndpoint, bun: string, script = MCP_SCRIPT): Record<string, unknown> {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: bun,
        args: [script],
        env: { [ORIGIN_ENV]: endpoint.origin, [TOKEN_ENV]: endpoint.token },
      },
    },
  };
}

/** The generated files and the environment that the CLI needs. */
export interface ClaudeFiles {
  /** `<state>/claude`. */
  readonly dir: string;
  readonly mcpConfig: string;
  readonly settings: string;
  /** The variables for the environment of the CLI: the hooks read the token from it. */
  readonly env: Readonly<Record<string, string>>;
}

export interface ClaudeSettingsOptions {
  /** The state folder of the host. */
  readonly stateDir: string;
  readonly endpoint: HostEndpoint;
  /** The Bun program for the MCP server. The default is the program of the host. */
  readonly bun?: string;
  /** Folders that must not get the files (the checkouts). A state folder inside one is an error. */
  readonly forbidden?: readonly string[];
  /** More MCP servers next to `workbench` (the owner's Blender server, blender.ts), without secrets. */
  readonly extraServers?: Readonly<Record<string, unknown>>;
}

function inside(child: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Write `<state>/claude/mcp.json` and `<state>/claude/settings.json` (mode 600; they hold the launch token or its
 * variable) and give their paths and the environment of the CLI. The host writes them again at each start, because
 * the token and the port change.
 */
export function writeClaudeSettings(options: ClaudeSettingsOptions): ClaudeFiles {
  const dir = join(options.stateDir, "claude");
  for (const folder of options.forbidden ?? []) {
    if (inside(dir, folder)) throw new Error(`The Claude Code files must not go into the checkout ${folder}.`);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mcpConfig = join(dir, "mcp.json");
  const settings = join(dir, "settings.json");
  const mcp = mcpConfigJson(options.endpoint, options.bun ?? bunPath());
  const servers = { ...options.extraServers, ...(mcp.mcpServers as Record<string, unknown>) };
  writePrivate(mcpConfig, { ...mcp, mcpServers: servers });
  writePrivate(settings, settingsJson(options.endpoint.origin));
  return {
    dir,
    mcpConfig,
    settings,
    env: { [TOKEN_ENV]: options.endpoint.token, [ORIGIN_ENV]: options.endpoint.origin },
  };
}

/** The line of the appended prompt (terminal and chat) that asks for `workbench_run` for the `labs` commands. */
export const RUN_TOOL_LINE =
  "- Run a `labs` subcommand (motion, verify, review, sheet, shot, clip, stills, scenes, catalog, asset, promote) " +
  "with the tool workbench_run, not with Bash: the owner then sees the run, its summary and its images in the Runs " +
  "tab.";

/** The line about the item that the owner picked in the lab (point and ask). */
export const PICKED_LINE =
  "- A 'Picked:' block in the packet is the item that the owner selected in the scene (a prop, a device, a member " +
  "or another item, the bone, the near work points and the files): 'this' and 'it' refer to it. lab_pick reads it " +
  "again or picks a point; lab_marks gives the circles and arrows that the owner drew on the frame.";

/**
 * The line about the generic tools of the scene editor. The edits of Claude are proposals. Only the switch of the
 * session of the owner lets them apply immediately. The line names only core tools. A host plugin
 * gives its own tools with their descriptions, and its examples for core tools through `toolNotes`.
 */
export const EDITOR_LINE =
  "- The scene editor: call studio_state first (the project, the open scene, the selection, the problems in one " +
  "small answer); scene_query gives the entities of the open scene, scene_commands lists its commands and " +
  "scene_command runs one. An edit is a proposal (a ghost in the frame) that the owner accepts or rejects; only " +
  "the owner's switch of the session lets an edit apply at once. lab_measure gives a distance or a reach.";

/** The lines that the terminal mode appends to the system prompt of the CLI (`--append-system-prompt`). */
export function terminalPrompt(): string {
  return [
    // The prompt names no document, because the container has no docs folder.
    "# The workbench of the 3D lab",
    "You run in the Claude tab of the workbench of the 3D lab. The owner looks at the lab page of this checkout in " +
      "the same window, under its Vite dev server.",
    "- Each prompt of the owner carries a 'Workbench context' packet: the surface URL, the clock, the camera, the " +
      "open item, the checks and the tunes. The tool lab_state gives it again on demand.",
    "- To see a frame, call lab_frame; use lab_sheet for a motion and lab_measure for a distance. The tools of the " +
      "project plugins (for example checks or the files behind a frame) come after the core tools; their " +
      "descriptions say when to use them. Do not run `labs shot` to see the page of the owner.",
    PICKED_LINE,
    EDITOR_LINE,
    RUN_TOOL_LINE,
    "- Do not commit, push or change the Git history. The owner commits from the Changes tab.",
  ].join("\n");
}

/**
 * The CLI flags that load the generated files and the workbench lines: `--mcp-config <file> --settings <file>
 * --append-system-prompt <text>`.
 */
export function claudeArgs(files: Pick<ClaudeFiles, "mcpConfig" | "settings">): string[] {
  return ["--mcp-config", files.mcpConfig, "--settings", files.settings, "--append-system-prompt", terminalPrompt()];
}
