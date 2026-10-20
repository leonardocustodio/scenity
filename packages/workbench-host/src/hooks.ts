// SPDX-License-Identifier: Apache-2.0
/**
 * The Claude Code hooks of the workbench as pure functions.
 * The host serves them at `POST /hooks/<event>` (the `http` hooks of the generated settings, settings.ts). The chat
 * mode calls the same function from its SDK callbacks. `handleHook` gives the hook JSON:
 *
 * - `UserPromptSubmit`: the cached context packet as `additionalContext`; a prompt of the owner starts a new turn of
 *   the session. A message that Claude Code made (another session, a task notice) starts no turn (ownerPrompt.ts).
 * - `PreToolUse` on `Bash`: a deny with a reason for a Git command that changes the history (gitGuard.ts), else the
 *   start time of the command, and for a run of the project a note that names `workbench_run` (runHint.ts).
 * - `PostToolUse` on the edit tools: the file of the edit goes into the files of the turn; the host gets a callback
 *   (it captures the "after" frame). On `Bash`: the host gets a callback with the start time of the
 *   command, and adds the files that the command changed to the turn.
 * - `Notification`, `Stop`, `SessionStart`, `SessionEnd`: a callback to the host and `{}`.
 */
import { gitRefusal } from "./gitGuard";
import { runHint } from "./runHint";
import { isOwnerPrompt } from "./ownerPrompt";
import { HOOK_EVENTS, isRecord, type HookEvent } from "./protocol";

/** The JSON answer of a hook (`{}` lets Claude Code continue). */
export type HookOutput = Record<string, unknown>;

/** The fields of a hook payload that the host reads (the other fields stay in `payload`). */
export interface HookInfo {
  readonly session: string | null;
  readonly cwd: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  /** The workbench terminal of the CLI (the `x-workbench-terminal` header of the hook), or null. */
  readonly terminal: string | null;
}

/** The edit tools of Claude Code that the `PostToolUse` hook matches. */
export const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

/** The files and the number of the turn of each session. */
export interface TurnLog {
  /** Start a new turn of a session and give its number (1 for the first). */
  start(session: string): number;
  /** Add a file to the turn of a session; give the turn and its files. */
  add(session: string, file: string): { turn: number; files: string[] };
  /** The turn of a session and its files. */
  turn(session: string): { turn: number; files: string[] };
  /** Forget a session. */
  end(session: string): void;
  /** Keep the start time (ms) of a shell command (the key is the ID of the tool call). */
  commandStart(key: string, ms: number): void;
  /** Give and forget the start time of a shell command, or null when it is not known. */
  commandEnd(key: string): number | null;
}

/** Make an empty turn log. */
export function createTurnLog(): TurnLog {
  const sessions = new Map<string, { turn: number; files: string[] }>();
  const commands = new Map<string, number>();
  const get = (session: string): { turn: number; files: string[] } => {
    let entry = sessions.get(session);
    if (entry === undefined) {
      entry = { turn: 0, files: [] };
      sessions.set(session, entry);
    }
    return entry;
  };
  return {
    start(session) {
      const entry = get(session);
      entry.turn += 1;
      entry.files = [];
      return entry.turn;
    },
    add(session, file) {
      const entry = get(session);
      if (!entry.files.includes(file)) entry.files.push(file);
      return { turn: entry.turn, files: [...entry.files] };
    },
    turn(session) {
      const entry = get(session);
      return { turn: entry.turn, files: [...entry.files] };
    },
    end(session) {
      sessions.delete(session);
    },
    commandStart(key, ms) {
      commands.set(key, ms);
    },
    commandEnd(key) {
      const ms = commands.get(key);
      commands.delete(key);
      return ms ?? null;
    },
  };
}

/** What the hooks need from the host. Every callback is optional. */
export interface HookDeps {
  /** The text of the cached context packet for a prompt, or null (no context then). */
  packet(info: HookInfo): string | null | Promise<string | null>;
  readonly turns: TurnLog;
  onPrompt?(info: HookInfo & { readonly turn: number; readonly prompt: string }): void;
  onEdit?(
    info: HookInfo & {
      readonly turn: number;
      readonly tool: string;
      readonly file: string;
      readonly files: readonly string[];
    },
  ): void;
  /**
   * The end of a shell command (`PostToolUse` on `Bash`). A command can change files (a script, `sed -i`), and
   * its hook names no file. Thus the host finds the files that changed after `startedMs` (null: no known start).
   */
  onCommand?(
    info: HookInfo & { readonly turn: number; readonly command: string; readonly startedMs: number | null },
  ): void;
  /** The clock of the command start times (ms; tests give a fake). */
  now?(): number;
  onRefuse?(info: HookInfo & { readonly command: string; readonly reason: string }): void;
  onNotification?(info: HookInfo & { readonly message: string; readonly kind: string | null }): void;
  /** An answer that is an object (or a promise of one) is the hook JSON. The `Stop` gate blocks with it. */
  onStop?(info: HookInfo & { readonly turn: number; readonly files: readonly string[] }): unknown;
  onSessionStart?(info: HookInfo & { readonly source: string | null; readonly transcript: string | null }): void;
  onSessionEnd?(info: HookInfo & { readonly reason: string | null }): void;
}

/** True for a hook event that the host serves. */
export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value);
}

function field(payload: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" ? value : null;
}

/** The file of an edit tool call (`file_path`, or `notebook_path` of NotebookEdit), or null. */
export function editedFile(payload: Readonly<Record<string, unknown>>): string | null {
  const input = payload.tool_input;
  if (!isRecord(input)) return null;
  return field(input, "file_path") ?? field(input, "notebook_path");
}

async function promptHook(info: HookInfo, deps: HookDeps): Promise<HookOutput> {
  const prompt = field(info.payload, "prompt") ?? "";
  // Only a prompt of the owner starts a turn; a message of another session keeps the turn of the owner.
  if (isOwnerPrompt(prompt)) {
    const turn = info.session === null ? 0 : deps.turns.start(info.session);
    deps.onPrompt?.({ ...info, turn, prompt });
  }
  const packet = await deps.packet(info);
  if (packet === null || packet === "") return {};
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: packet } };
}

function preToolHook(info: HookInfo, deps: HookDeps): HookOutput {
  if (field(info.payload, "tool_name") !== "Bash") return {};
  const input = info.payload.tool_input;
  const command = isRecord(input) ? field(input, "command") : null;
  const reason = command === null ? null : gitRefusal(command);
  if (command !== null && reason === null) deps.turns.commandStart(commandKey(info), (deps.now ?? Date.now)());
  if (command === null) return {};
  if (reason === null) {
    // A `labs` command still runs; Claude gets a note that names `workbench_run`.
    const hint = runHint(command);
    return hint === null ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: hint } };
  }
  deps.onRefuse?.({ ...info, command, reason });
  return {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  };
}

/** The key of the start time of a shell command: the ID of the tool call, else the session. */
function commandKey(info: HookInfo): string {
  return field(info.payload, "tool_use_id") ?? `session:${info.session ?? ""}`;
}

/** The end of a shell command. The host finds the files that it changed. */
function commandHook(info: HookInfo, deps: HookDeps): HookOutput {
  const input = info.payload.tool_input;
  const command = (isRecord(input) ? field(input, "command") : null) ?? "";
  const startedMs = deps.turns.commandEnd(commandKey(info));
  deps.onCommand?.({ ...info, turn: deps.turns.turn(info.session ?? "").turn, command, startedMs });
  return {};
}

function postToolHook(info: HookInfo, deps: HookDeps): HookOutput {
  const tool = field(info.payload, "tool_name") ?? "";
  if (tool === "Bash") return commandHook(info, deps);
  const file = editedFile(info.payload);
  if (!(EDIT_TOOLS as readonly string[]).includes(tool) || file === null) return {};
  const { turn, files } = deps.turns.add(info.session ?? "", file);
  deps.onEdit?.({ ...info, turn, tool, file, files });
  return {};
}

/**
 * Answer one hook of Claude Code. `payload` is the JSON body of the hook (`session_id`, `cwd`, `hook_event_name`
 * and the fields of the event); `terminal` is the workbench terminal of the CLI, or null. The answer is the hook JSON;
 * a bad payload gives `{}`.
 */
export async function handleHook(
  event: HookEvent,
  payload: unknown,
  deps: HookDeps,
  terminal: string | null = null,
): Promise<HookOutput> {
  const body = isRecord(payload) ? payload : {};
  const info: HookInfo = { session: field(body, "session_id"), cwd: field(body, "cwd"), payload: body, terminal };
  switch (event) {
    case "UserPromptSubmit":
      return promptHook(info, deps);
    case "PreToolUse":
      return preToolHook(info, deps);
    case "PostToolUse":
      return postToolHook(info, deps);
    case "Notification":
      deps.onNotification?.({ ...info, message: field(body, "message") ?? "", kind: field(body, "notification_type") });
      return {};
    case "Stop": {
      const out: unknown = await deps.onStop?.({ ...info, ...deps.turns.turn(info.session ?? "") });
      return isRecord(out) ? out : {};
    }
    case "SessionStart":
      deps.onSessionStart?.({ ...info, source: field(body, "source"), transcript: field(body, "transcript_path") });
      return {};
    case "SessionEnd":
      deps.onSessionEnd?.({ ...info, reason: field(body, "reason") });
      if (info.session !== null) deps.turns.end(info.session);
      return {};
  }
}
