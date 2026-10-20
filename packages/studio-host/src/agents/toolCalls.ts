// SPDX-License-Identifier: Apache-2.0
/**
 * A tool call of an agent turn. The call goes into the transcript as a tool item, then through the gate of its kind
 * (a scene edit, a job run), then to the tool. Its result comes back with its pictures in the picture store and its
 * record in the turn record. Review sends each scene edit as a proposal.
 */
import { runToolOf, type SceneToolContext, type ToolDef, type ToolResult } from "@scenity/agent-tools";
import type { GateOutcome, GateRequest } from "./gate";
import { HOST_TOOL_NAMES } from "./hostTools";
import type { PictureStore } from "./pictures";
import type { AgentItem, AgentMode } from "./protocol";
import type { TurnRecords } from "./turns";

/** The tools that change a document: the gate of the scene edits. Review makes proposals of them. */
const EDIT_TOOLS = new Set(["scene_command", "scene_batch"]);
/** The longest text of a tool result in the transcript (characters). */
const RESULT_MAX_CHARS = 4000;

/** What a tool call reads of its session and of the host. */
export interface ToolCallParts {
  readonly session: { readonly id: string; readonly mode: AgentMode; readonly turn: number };
  readonly tools: readonly ToolDef[];
  readonly pictures: PictureStore;
  readonly turns: TurnRecords;
  /** The ID of a new item of the transcript. */
  nextId(): number;
  item(item: AgentItem): void;
  permit(request: GateRequest): Promise<GateOutcome>;
  context(): SceneToolContext;
  /** Run a tool of the host (the plan tools, `ask_person`). */
  host(name: string, input: unknown): Promise<ToolResult>;
  /** Tell the windows the work of the call (before the call), and its pictures (after the call). */
  present(name: string, input: unknown, pictures?: readonly string[]): void;
}

/** The gate request of a tool call: a scene edit or a job run. Null for a tool that only reads. */
export function gateRequest(name: string, input: Record<string, unknown>): GateRequest | null {
  if (EDIT_TOOLS.has(name)) {
    const what =
      typeof input.command === "string" ? input.command : typeof input.title === "string" ? input.title : name;
    return { kind: "scene", title: what, detail: JSON.stringify(input) };
  }
  if (name !== "job_run") return null;
  const job = typeof input.command === "string" ? input.command : "";
  const args = Array.isArray(input.args) ? input.args.filter((arg) => typeof arg === "string") : [];
  return { kind: "runs", title: `scenity ${[job, ...args].join(" ")}`, detail: job, job };
}

/** The text of a tool result, cut. */
function resultText(result: ToolResult): string {
  const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  return text.length <= RESULT_MAX_CHARS ? text : `${text.slice(0, RESULT_MAX_CHARS)}…`;
}

/** Run a tool call of a turn and record it in the transcript and in the turn record. */
export async function runToolCall(parts: ToolCallParts, name: string, input: unknown): Promise<ToolResult> {
  const id = parts.nextId();
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const sent = EDIT_TOOLS.has(name) && parts.session.mode === "review" ? { ...record, mode: "propose" } : record;
  parts.item({ id, kind: "tool", name, input: sent, result: null, isError: false, pictures: [] });
  parts.present(name, sent);
  const request = gateRequest(name, sent);
  const outcome = request === null ? null : await parts.permit(request);
  const result: ToolResult =
    outcome !== null && !outcome.allowed
      ? { content: [{ type: "text", text: `${name}: ${outcome.reason}` }], isError: true }
      : HOST_TOOL_NAMES.has(name)
        ? await parts.host(name, sent)
        : await runToolOf(parts.tools, name, sent, parts.context());
  const pictures = result.content.flatMap((block) =>
    block.type === "image"
      ? [parts.pictures.put(new Uint8Array(Buffer.from(block.data, "base64")), block.mimeType)]
      : [],
  );
  const text = resultText(result);
  const job = name === "job_run" ? (/Job (job-\d+) started/.exec(text)?.[1] ?? null) : null;
  parts.turns.tool(parts.session.id, parts.session.turn, { name, pictures, job });
  if (pictures.length > 0) parts.present(name, sent, pictures);
  parts.item({ id, kind: "tool", name, input: sent, result: text, isError: result.isError === true, pictures });
  return result;
}
