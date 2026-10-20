// SPDX-License-Identifier: Apache-2.0
/**
 * The bridge calls of the scene page: the calls that the generic Claude tools of the workbench host need, over the
 * script API of the page (`globalThis.__scenity`).
 *
 * - `scene.query`: `queryScene` of `@scenity/editor-core` over the open document, with the world bounds of the
 *   inspect report of the last frame.
 * - `commands`: each command of the editor window (settings/pageKeys.ts `list`): the page commands, the scene
 *   commands and the commands of the open sequence, with their metadata.
 * - `command` (args `[id, args?, how?]`): a command of the window (`execute`); `how` is `{ by: "claude" }` for the tool
 *   `scene_command`, so a proposal waits on the proposal card unless the switch of the session says "apply". A sequence
 *   edit of Claude waits as a proposal of the open sequence too (the Timeline shows its keys as ghosts).
 * - `proposalMode`: the switch of the session.
 * - `contextLines`: the lines of the context packet (the file, the entities, the selection, the proposals).
 * - `tools`, `tools.call`: the page tools of the studio faces of the plugins.
 * - The UI calls, the one state call, the checkpoints and the undo of a turn, and the gate of a background task.
 */
import {
  COMMAND_BATCH_CALL,
  COMMAND_CALL,
  COMMANDS_CALL,
  CONTEXT_LINES_CALL,
  PAGE_TOOL_CALL,
  PAGE_TOOLS_CALL,
  PROPOSAL_MODE_CALL,
  SCENE_QUERY_CALL,
  serveBridgeCall,
  STUDIO_STATE_CALL,
  TASK_FRAMES_CALL,
  TASK_DOCUMENT_CALL,
  TASK_GATE_CALL,
  TURN_CHECKPOINT_CALL,
  TURN_RESTORE_CALL,
  TURN_UNDO_CALL,
  UI_HIGHLIGHT_CALL,
  UI_NOTIFY_CALL,
  UI_REVEAL_CALL,
  UI_STATE_CALL,
  type CommandBatchArgs,
  type CommandInfo,
  type SceneQueryArgs,
  type SceneQueryAnswer,
} from "@scenity/bridge";
import { queryScene, type Actor, type CommandOptions, type QueryBox } from "@scenity/editor-core";
import type { ScenePageApi } from "./main";
import { uiHighlight, uiNotify, uiReveal, uiState } from "./uiCalls";
import { studioState } from "./studioState";
import { pageTaskGate, type TaskGate } from "./review/taskGate";
import { pluginContextLines, pluginPageTools, runPluginPageTool } from "./extensions/pageAgentParts";
import { canonicalJson } from "@scenity/scene/canonical";

/** The current script API of the page. */
function pageApi(): ScenePageApi {
  const api = globalThis.__scenity;
  if (api === undefined) throw new Error("The scene page API is not ready.");
  return api;
}

/** The script API with the commands of the edit mode. */
function editApi(): Required<Pick<ScenePageApi, "command" | "commands" | "proposalMode">> & ScenePageApi {
  const api = pageApi();
  if (api.command === undefined || api.commands === undefined || api.proposalMode === undefined) {
    throw new Error("The scene page has no commands: open it with edit=1.");
  }
  return api as Required<Pick<ScenePageApi, "command" | "commands" | "proposalMode">> & ScenePageApi;
}

/** Answer a query: the document of the page and the bounds of the last frame (none when the report fails). */
export async function sceneQuery(query: SceneQueryArgs): Promise<SceneQueryAnswer> {
  const api = pageApi();
  const report = await api.inspect?.().catch(() => null);
  const boxes = new Map((report?.entities ?? []).map((entity) => [entity.id, entity.bounds]));
  const bounds = (id: string): QueryBox | null => boxes.get(id) ?? null;
  return queryScene(api.document(), query, bounds);
}

/** The commands of the editor window. */
export function pageCommands(): CommandInfo[] {
  return editApi().commands();
}

/**
 * The actor of an agent session in the `how` argument (`session: { id, name, colour?, turn? }`), or undefined. The
 * turn makes the change set of the edit.
 */
function sessionActor(value: unknown): Actor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, name, colour, turn } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  return {
    kind: "agent",
    session: id,
    name,
    ...(typeof colour === "string" ? { colour } : {}),
    ...(typeof turn === "number" && Number.isInteger(turn) ? { turn } : {}),
  };
}

/** The options of a run from the `how` argument of the bridge (default: a run of Claude). */
function optionsOf(how: unknown): CommandOptions {
  const given = typeof how === "object" && how !== null ? (how as Record<string, unknown>) : {};
  const by = given.by === "owner" || given.by === "script" ? given.by : "claude";
  const mode = given.mode === "apply" || given.mode === "propose" ? given.mode : undefined;
  const actor = by === "claude" ? sessionActor(given.session) : undefined;
  return { by, ...(mode === undefined ? {} : { mode }), ...(actor === undefined ? {} : { actor }) };
}

/** The task gate of the page; an error for a page with no edit mode. */
function taskGateOf(): TaskGate {
  const gate = pageTaskGate();
  if (gate === null) throw new Error("The scene page has no review: open it with edit=1.");
  return gate;
}

/** Run a command of the editor window, then wait for the frame of the change. */
export async function pageCommand(id: string, ...rest: unknown[]): Promise<unknown> {
  const api = editApi();
  const args = (typeof rest[0] === "object" && rest[0] !== null ? rest[0] : {}) as Record<string, unknown>;
  const run = await api.command(id, args, optionsOf(rest[1]));
  await api.frame();
  return run;
}

/** Run a batch of scene commands as one named step of the history, then wait for the frame of the change. */
export async function pageBatch(steps: CommandBatchArgs[0], title?: string, how?: unknown): Promise<unknown> {
  const api = pageApi();
  if (api.commandBatch === undefined) throw new Error("The scene page has no commands: open it with edit=1.");
  const run = await api.commandBatch(steps, title, optionsOf(how));
  await api.frame();
  return run;
}

/** The lines of the scene page in the context packet. */
export function pageContextLines(): string[] {
  const api = pageApi();
  const file = api.file();
  const doc = api.document();
  const selected = api.selection?.() ?? [];
  const lines = [
    `Scene file: ${file.path} (${file.dirty ? "changed, not saved" : "saved"}); ${String(Object.keys(doc.entities).length)} entities.`,
    `Selection: ${selected.length === 0 ? "none" : selected.join(", ")}.`,
  ];
  const waiting = api.proposals?.() ?? [];
  if (waiting.length > 0)
    lines.push(`Proposals that wait for the owner: ${waiting.map((item) => item.id).join(", ")}.`);
  if (api.commands !== undefined) lines.push("Tools: scene_query, scene_commands, scene_command, scene_check.");
  // The lines of the studio faces of the plugins.
  return [...lines, ...pluginContextLines()];
}

/** The calls of the scene page for the generic Claude tools. */
export const SCENE_PAGE_CALLS = {
  [SCENE_QUERY_CALL.name]: serveBridgeCall(SCENE_QUERY_CALL, sceneQuery),
  [COMMANDS_CALL.name]: serveBridgeCall(COMMANDS_CALL, pageCommands),
  [COMMAND_CALL.name]: serveBridgeCall(COMMAND_CALL, pageCommand),
  [COMMAND_BATCH_CALL.name]: serveBridgeCall(COMMAND_BATCH_CALL, pageBatch),
  [PROPOSAL_MODE_CALL.name]: serveBridgeCall(PROPOSAL_MODE_CALL, () => editApi().proposalMode()),
  [CONTEXT_LINES_CALL.name]: serveBridgeCall(CONTEXT_LINES_CALL, pageContextLines),
  // The UI calls of the editor window.
  [UI_STATE_CALL.name]: serveBridgeCall(UI_STATE_CALL, uiState),
  // The one state call.
  [STUDIO_STATE_CALL.name]: serveBridgeCall(STUDIO_STATE_CALL, studioState),
  // The checkpoint at the start of a turn, and its restore.
  [TURN_CHECKPOINT_CALL.name]: serveBridgeCall(
    TURN_CHECKPOINT_CALL,
    (session, turn) => pageApi().checkpoint?.(session, turn) ?? false,
  ),
  [TURN_RESTORE_CALL.name]: serveBridgeCall(TURN_RESTORE_CALL, (session, turn) => {
    const api = pageApi();
    if (api.restoreCheckpoint === undefined) throw new Error("The scene page has no commands: open it with edit=1.");
    return api.restoreCheckpoint(session, turn);
  }),
  // "Undo the turn" of the studio host.
  [TURN_UNDO_CALL.name]: serveBridgeCall(TURN_UNDO_CALL, (session, turn) => {
    const api = pageApi();
    if (api.undoTurn === undefined) throw new Error("The scene page has no commands: open it with edit=1.");
    return api.undoTurn(session, turn);
  }),
  // The gate and the pictures of a background task.
  [TASK_GATE_CALL.name]: serveBridgeCall(TASK_GATE_CALL, (session) => taskGateOf().gate(session)),
  [TASK_FRAMES_CALL.name]: serveBridgeCall(TASK_FRAMES_CALL, (session) => taskGateOf().frames(session)),
  [TASK_DOCUMENT_CALL.name]: serveBridgeCall(TASK_DOCUMENT_CALL, (session) => {
    const { doc, sets } = taskGateOf().document(session);
    return { path: pageApi().file().path, text: canonicalJson(doc), sets };
  }),
  [UI_REVEAL_CALL.name]: serveBridgeCall(UI_REVEAL_CALL, uiReveal),
  [UI_HIGHLIGHT_CALL.name]: serveBridgeCall(UI_HIGHLIGHT_CALL, uiHighlight),
  [UI_NOTIFY_CALL.name]: serveBridgeCall(UI_NOTIFY_CALL, uiNotify),
  // The page tools of the studio faces of the plugins.
  [PAGE_TOOLS_CALL.name]: serveBridgeCall(PAGE_TOOLS_CALL, pluginPageTools),
  [PAGE_TOOL_CALL.name]: serveBridgeCall(PAGE_TOOL_CALL, runPluginPageTool),
} as const;
