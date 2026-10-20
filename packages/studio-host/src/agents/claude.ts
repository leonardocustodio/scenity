// SPDX-License-Identifier: Apache-2.0
/**
 * The Claude driver of the agent sessions. Each turn is one `query` of the Agent SDK with an in-process MCP server
 * `scenity` over the tools of the turn. The next turn of a session resumes the SDK session of the last turn. The first
 * turn of a fork resumes the SDK session of its source as a new SDK session. The driver gives the text blocks of the
 * assistant messages, the cost of the turn and the share of the context window.
 *
 * The rules of the options (as in the workbench host, `@scenity/workbench-host` agent/options.ts):
 *
 * - The SDK bundles its own zod, and its JSON schema step fails on the schemas of the agent tools. Thus the driver
 *   gives its own `tools/list` and `tools/call` handlers to the protocol server.
 * - The tools of `scenity` and the read tools of Claude Code (Read, Glob, Grep) run. The file tools (Edit, Write,
 *   MultiEdit, NotebookEdit) and the network tools (WebFetch, WebSearch) go through the gate of their kind (the mode,
 *   the preferences, an approval card). A file tool keeps a snapshot of its file first and works only on a file of the
 *   project. `canUseTool` refuses each other tool (Bash, the Git commands).
 * - The environment has no credential variable and no variable of an outer Claude Code session.
 */
import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { contextPacket } from "./context";
import type { AgentDriver, TurnInput } from "./driver";

/** The name of the MCP server of the tools. */
export const STUDIO_MCP_SERVER = "scenity";
/** The read tools of Claude Code that a session may use. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
/** The file tools of Claude Code: the gate of the file writes (a snapshot first). */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** The network tools of Claude Code: the gate of the network. */
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);
/** The variables of an outer Claude Code session and the credentials that the host environment can hold. */
const DROPPED =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SSE_PORT|CHILD_SESSION|SESSION_\w+|MESSAGING_\w+|OAUTH_TOKEN)|ANTHROPIC_AUTH_TOKEN)$/;

/** The lines that the driver appends to the `claude_code` system prompt. */
export function studioPrompt(input: Pick<TurnInput, "session" | "instructions">): string {
  const { mode } = input.session;
  const rule =
    mode === "ask"
      ? "The session is in Ask mode: read and explain; the edit tools refuse."
      : mode === "review"
        ? "The session is in Review mode: each edit is a proposal that the person accepts or rejects."
        : "The session is in Auto mode: the edits apply at once, as one undo step each. You may edit the files of " +
          "the project with Edit and Write; the person can undo the whole turn.";
  const files =
    mode === "review"
      ? "- A file write needs the approval of the person: the call waits for it."
      : "- Git and shell commands are the owner's only.";
  const plan = input.session.planFirst
    ? "- Plan first: before any edit, write or run, call plan_propose with the steps and wait for the approval. Tick " +
      "each step with plan_step during the run, and end with plan_done and a summary."
    : "- For a large request, call plan_propose first and wait for the approval.";
  return [
    "# Scenity Studio",
    `You run in the agent panel of Scenity Studio, in the session "${input.session.name}". The person looks at the ` +
      "editor window of the project in the same browser.",
    `- The tools of the server ${STUDIO_MCP_SERVER} read and drive the editor window. Call studio_state first: ` +
      "it gives the project, the open scene, the selection and the panels.",
    `- ${rule}`,
    files,
    plan,
    "- To ask the person, call ask_person with 2 to 4 choices; the call waits for the answer.",
    "- Use the editor commands (scene_commands lists them) for each change, so the person can undo it.",
    // "Show me how": the agent teaches, and the person does each step.
    "- When the person asks how to do something in the editor, show it: call ui_highlight on each control in turn " +
      "with a short text, and let the person do each step (do not do it for them). Help → Tutorials has guided " +
      "tutorials for the first scene, a prefab and a sequence.",
    "- Do not commit, push or change the Git history.",
    ...(input.instructions === "" ? [] : ["", "# Project instructions", input.instructions]),
  ].join("\n");
}

/** The environment of a turn: the host environment without the dropped variables. */
function turnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !DROPPED.test(key)) env[key] = value;
  }
  return env;
}

/** The in-process MCP server over the tools of a turn. */
function toolServer(input: TurnInput) {
  const config = createSdkMcpServer({
    name: STUDIO_MCP_SERVER,
    version: "0.1.0",
    tools: input.tools.listings.map((listing) =>
      tool(
        listing.name,
        listing.description,
        {},
        (args) => input.tools.run(listing.name, args) as Promise<CallToolResult>,
        listing._meta === undefined ? {} : { alwaysLoad: true },
      ),
    ),
  });
  const server = config.instance.server;
  server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [...input.tools.listings] }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => (await input.tools.run(request.params.name, request.params.arguments ?? {})) as CallToolResult,
  );
  return config;
}

/** The diff text of a file tool for its approval card. */
function writeDetail(input: Record<string, unknown>): string {
  if (typeof input.content === "string") return input.content;
  const before = typeof input.old_string === "string" ? input.old_string : "";
  const after = typeof input.new_string === "string" ? input.new_string : "";
  return before === "" && after === "" ? JSON.stringify(input) : `- ${before}\n+ ${after}`;
}

/**
 * The permission rule of a turn: the tools of `scenity` and the read tools run. A file tool and a network tool go
 * through the gate of their kind. A file tool keeps a snapshot of its file first. The rule refuses each other tool.
 */
function canUseToolOf(input: TurnInput): CanUseTool {
  const allow = (toolInput: Record<string, unknown>) => ({ behavior: "allow" as const, updatedInput: toolInput });
  return async (name, toolInput) => {
    if (READ_TOOLS.has(name) || name.startsWith(`mcp__${STUDIO_MCP_SERVER}__`)) return allow(toolInput);
    try {
      if (WRITE_TOOLS.has(name)) {
        const raw = toolInput.file_path ?? toolInput.notebook_path;
        const path = input.files.snapshot(typeof raw === "string" ? raw : "");
        const outcome = await input.permit({
          kind: "files",
          title: `${name} ${path}`,
          detail: writeDetail(toolInput),
          path,
        });
        return outcome.allowed ? allow(toolInput) : { behavior: "deny", message: outcome.reason };
      }
      if (NETWORK_TOOLS.has(name)) {
        const target = toolInput.url ?? toolInput.query;
        const detail = typeof target === "string" ? target : "";
        const outcome = await input.permit({ kind: "network", title: `${name} ${detail}`, detail });
        return outcome.allowed ? allow(toolInput) : { behavior: "deny", message: outcome.reason };
      }
    } catch (error) {
      return { behavior: "deny", message: error instanceof Error ? error.message : String(error) };
    }
    return { behavior: "deny", message: `The studio session does not use ${name}.` };
  };
}

/** The SDK session that the next turn of a session resumes. `fork`: the turn starts a new SDK session from it. */
interface Resume {
  readonly id: string;
  readonly fork: boolean;
}

/** The SDK options of a turn. */
function turnOptions(input: TurnInput, abort: AbortController, resume: Resume | undefined): Options {
  return {
    cwd: input.dir ?? process.cwd(),
    permissionMode: "default",
    systemPrompt: { type: "preset", preset: "claude_code", append: studioPrompt(input) },
    env: turnEnv(),
    mcpServers: { [STUDIO_MCP_SERVER]: toolServer(input) },
    strictMcpConfig: true,
    allowedTools: [`mcp__${STUDIO_MCP_SERVER}__*`, ...READ_TOOLS],
    canUseTool: canUseToolOf(input),
    abortController: abort,
    model: input.session.model,
    effort: input.session.effort,
    ...(resume === undefined ? {} : { resume: resume.id, ...(resume.fork ? { forkSession: true } : {}) }),
  };
}

const usageShape = z.looseObject({
  input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
});

/** The tokens of the context of an assistant message. */
function contextTokens(usage: unknown): number | null {
  const parsed = usageShape.safeParse(usage);
  if (!parsed.success) return null;
  const { input_tokens: plain, cache_read_input_tokens: read, cache_creation_input_tokens: made } = parsed.data;
  return (plain ?? 0) + (read ?? 0) + (made ?? 0);
}

/** An input of the SDK with one message: the query ends after the result of that message. */
async function* once(message: Promise<SDKUserMessage>): AsyncGenerator<SDKUserMessage> {
  yield await message;
}

/** The one message of a turn: the prompt, the context packet and the pictures of the chips. */
function turnMessage(input: TurnInput): SDKUserMessage {
  const packet = contextPacket(input.context);
  const text = packet === "" ? input.prompt : `${input.prompt}\n\n${packet}`;
  const pictures = input.context.flatMap((chip) =>
    chip.picture === undefined
      ? []
      : [
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: chip.picture.mime, data: chip.picture.data },
          },
        ],
  );
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }, ...pictures] },
    parent_tool_use_id: null,
  };
}

/** The Claude driver. */
export function claudeDriver(): AgentDriver {
  const resumes = new Map<string, Resume>();
  return {
    name: "claude",
    async turn(input) {
      const abort = new AbortController();
      input.signal.addEventListener("abort", () => abort.abort(), { once: true });
      let tokens: number | null = null;
      const options = turnOptions(input, abort, resumes.get(input.session.id));
      const run = query({ prompt: once(Promise.resolve(turnMessage(input))), options });
      for await (const message of run) {
        if (message.type === "system" && message.subtype === "init")
          resumes.set(input.session.id, { id: message.session_id, fork: false });
        if (message.type === "assistant") {
          for (const block of message.message.content) if (block.type === "text") input.say(block.text);
          tokens = contextTokens(message.message.usage) ?? tokens;
        }
        if (message.type === "result") {
          const window = Object.values(message.modelUsage)[0]?.contextWindow ?? 0;
          const share = tokens === null || window <= 0 ? null : Math.min(1, tokens / window);
          const used = Object.values(message.modelUsage).reduce(
            (sum, item) => sum + item.inputTokens + item.outputTokens,
            0,
          );
          input.usage(message.total_cost_usd, share, used);
          if (message.subtype !== "success" && !input.signal.aborted)
            throw new Error(`The turn ended: ${message.subtype}.`);
        }
      }
    },
    close: (session) => resumes.delete(session),
    fork: (from, to) => {
      const resume = resumes.get(from);
      if (resume !== undefined) resumes.set(to, { id: resume.id, fork: true });
    },
  };
}
