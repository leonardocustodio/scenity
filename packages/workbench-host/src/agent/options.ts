// SPDX-License-Identifier: Apache-2.0
/**
 * The options of a chat session. These are the rules:
 *
 * - The credential is a choice of the owner per session (credential.ts): the subscription (the default: the
 *   claude.ai login of the machine) or the API key of the `.env` file of the checkout. The host never gives a
 *   claude.ai token (`CLAUDE_CODE_OAUTH_TOKEN`) or a gateway token (`ANTHROPIC_AUTH_TOKEN`) to the SDK.
 * - `permissionMode` is explicit (an omitted mode is `auto`). `Edit`, `Write` and `Bash` never go into
 *   `allowedTools`, because a bare entry skips `canUseTool`. Only the workbench tools go there.
 * - `systemPrompt` is the `claude_code` preset with the workbench lines at its end. `settingSources` stays at its
 *   default (user, project, local). `env` is the environment of the host plus the workbench variables, because the
 *   option replaces the whole environment.
 * - `strictMcpConfig: true` with the in-process `workbench` server only: the claude.ai connectors do not load.
 * - The mode "all" (`bypassPermissions`) runs with `maxBudgetUsd` and a high `maxTurns` (it counts the model
 *   requests of one prompt). `enableFileCheckpointing` stays off: the turns of the host (turns.ts) do the undo.
 */
import type { AgentEffort, AgentStartParams } from "../agentProtocol";
import type { AgentMode } from "../protocol";
import { claudeExecutableOption } from "../hostRuntime";
import { EDITOR_LINE, MCP_SERVER_NAME, ORIGIN_ENV, PICKED_LINE, RUN_TOOL_LINE, TOOLS_RULE } from "../settings";
import type { CanUseTool, McpSdkServerConfigWithInstance, Options } from "./sdk";

/** The variable that tells a program that it runs in the chat mode of the workbench. */
export const CHAT_ENV = "SCENITY_WORKBENCH_CHAT";
/** The defaults of the mode "all": the spend in USD and the model requests of one prompt. */
export const ALL_DEFAULTS = { maxBudgetUsd: 5, maxTurns: 200 } as const;

/**
 * The variables of an outer Claude Code session, and the credentials that the host environment can hold. The
 * credential of the session (credential.ts) adds the API key again for an `api-key` session only.
 */
const DROPPED =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SSE_PORT|CHILD_SESSION|SESSION_\w+|MESSAGING_\w+|OAUTH_TOKEN)|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)$/;

/**
 * The environment of a session: the host environment without the dropped variables, plus the workbench ones. It
 * holds no credential variable.
 */
export function agentEnv(
  base: Readonly<Record<string, string | undefined>>,
  origin: string | null,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !DROPPED.test(key)) env[key] = value;
  }
  env[CHAT_ENV] = "1";
  if (origin !== null) env[ORIGIN_ENV] = origin;
  return env;
}

/** The lines that the host appends to the `claude_code` system prompt. */
export function workbenchPrompt(toolNames: readonly string[]): string {
  const tools = toolNames.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`).join(", ");
  return [
    // The prompt names no document, because the container has no docs folder.
    "# The workbench of the 3D lab",
    "You run in the chat panel of the workbench of the 3D lab. The owner looks at the lab page of this checkout in " +
      "the same window, under its Vite dev server.",
    "- Each prompt carries a 'Workbench context' packet: the surface URL, the clock, the camera, the open item, " +
      "the checks and the tunes. Words such as 'this', 'that hand' and 'now' refer to it. The tool lab_state gives " +
      "it again on demand.",
    `- The workbench tools read and drive that page: ${tools}.`,
    "- To see a frame, call lab_frame (one picture and the metrics of the frame). Use lab_sheet for a motion and " +
      "lab_measure for a distance. The tools of the project plugins (for example checks or the files behind a " +
      "frame) come after the core tools; their descriptions say when to use them. Do not run `labs shot` to see " +
      "the page of the owner.",
    "- After an edit, the dev server applies it (HMR). A lab_frame call at the same URL shows the result.",
    PICKED_LINE,
    EDITOR_LINE,
    RUN_TOOL_LINE,
    "- Every frame is a URL: give frames as lab URLs, never as 'the current frame' alone.",
    "- Do not commit, push or change the Git history. The owner commits from the Changes tab.",
  ].join("\n");
}

/** The inputs of `sessionOptions`. */
export interface SessionOptionsInput {
  readonly checkout: string;
  readonly params: AgentStartParams;
  readonly env: Readonly<Record<string, string>>;
  readonly server: McpSdkServerConfigWithInstance;
  readonly toolNames: readonly string[];
  readonly hooks: NonNullable<Options["hooks"]>;
  readonly canUseTool: CanUseTool;
  readonly resume?: string;
  readonly stderr?: (data: string) => void;
  /** False in the remote mode: then the SDK never gets the flag of the mode "all". The default is true. */
  readonly allowBypass?: boolean;
}

/** The limits of a session: the mode "all" always has both; another mode has the ones that the owner gave. */
export function sessionLimits(params: AgentStartParams): { maxBudgetUsd?: number; maxTurns?: number } {
  const all = params.mode === "bypassPermissions";
  const budget = params.maxBudgetUsd ?? (all ? ALL_DEFAULTS.maxBudgetUsd : undefined);
  const turns = params.maxTurns ?? (all ? ALL_DEFAULTS.maxTurns : undefined);
  return {
    ...(budget === undefined ? {} : { maxBudgetUsd: budget }),
    ...(turns === undefined ? {} : { maxTurns: turns }),
  };
}

/** The SDK options of one session. */
export function sessionOptions(input: SessionOptionsInput): Options {
  const { params } = input;
  const limits = sessionLimits(params);
  const effort: AgentEffort | undefined = params.effort;
  return {
    cwd: input.checkout,
    permissionMode: params.mode satisfies AgentMode,
    // A session with a budget may move to the mode "all" later (agent.setMode); the SDK needs this flag for it.
    allowDangerouslySkipPermissions: input.allowBypass !== false && limits.maxBudgetUsd !== undefined,
    systemPrompt: { type: "preset", preset: "claude_code", append: workbenchPrompt(input.toolNames) },
    env: { ...input.env },
    mcpServers: { [MCP_SERVER_NAME]: input.server },
    strictMcpConfig: true,
    allowedTools: [TOOLS_RULE],
    includePartialMessages: true,
    enableFileCheckpointing: false,
    hooks: input.hooks,
    canUseTool: input.canUseTool,
    // A compiled host names the Claude Code binary of the SDK (hostRuntime.ts). From the sources, the option is empty.
    ...claudeExecutableOption(),
    ...limits,
    ...(params.model === undefined ? {} : { model: params.model }),
    ...(effort === undefined ? {} : { effort }),
    ...(input.resume === undefined ? {} : { resume: input.resume }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  };
}
