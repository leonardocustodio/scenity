// SPDX-License-Identifier: Apache-2.0
/**
 * The state of one agent session of the studio host (sessions.ts) and the parts of its tool calls: the port to the
 * editor windows of its project (the page bridge, bridgeHub.ts) and the context of a tool call (the session, its
 * turn, the jobs of the studio in the project folder).
 */
import { reviveBytes, type SceneToolContext, type SurfacePort } from "@scenity/agent-tools";
import type { BridgeHub } from "../bridgeHub";
import type { JobService } from "../jobs";
import type { AgentChip } from "./context";
import { studioJobPort } from "./jobPort";
import type { ActionKind } from "./permissions";
import type { Plan } from "./plans";
import { SessionPresence, type PresenceMessage } from "./presence";
import type { AgentEffort, AgentItem, AgentMode, AgentSessionInfo } from "./protocol";

/** The state of a session. */
export interface Session {
  info: AgentSessionInfo;
  /** The number of the current turn (1 for the first prompt). */
  turn: number;
  readonly items: AgentItem[];
  readonly queue: { readonly text: string; readonly context: readonly AgentChip[] }[];
  abort: AbortController | null;
  nextItem: number;
  /** The kinds that the person allowed for the remaining part of the session. */
  readonly allowed: Set<ActionKind>;
  /** The current plan of the turn, its item and its approval. */
  plan: { readonly plan: Plan; readonly item: number; readonly approval: string } | null;
  /** The presence of the session in the windows of its project. */
  readonly presence: SessionPresence;
  /** The timer that ends the turn of an external agent after a pause, or null. */
  idle: ReturnType<typeof setTimeout> | null;
}

/** The port of the editor windows of a project: a call goes to the newest window of the project. */
export function sessionPort(hub: BridgeHub, project: string): SurfacePort {
  return {
    call: async (call, args = [], options = {}) =>
      reviveBytes(
        await hub.call(call, args, {
          project,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        }),
      ),
  };
}

/** The context of a tool call of a session: the editor windows of its project, the session and the jobs. */
export function sessionContext(
  session: Session,
  options: {
    readonly hub: BridgeHub;
    readonly jobs?: JobService;
    dirOf(project: string, session?: string): string | null;
  },
): SceneToolContext {
  const port = sessionPort(options.hub, session.info.project);
  const { id, name, colour, project } = session.info;
  // The jobs of a session of a task in a worktree run in the worktree.
  const dir = options.dirOf(project, session.info.id);
  const { jobs } = options;
  return {
    surface: () => port,
    session: { id, name, colour, turn: session.turn },
    ...(jobs === undefined || dir === null ? {} : { jobs: studioJobPort(jobs, dir, project) }),
  };
}

/** The choices of a new session (the patch of a create). */
export interface NewSessionPatch {
  readonly mode?: AgentMode;
  readonly model?: string;
  readonly effort?: AgentEffort;
  readonly budgetUsd?: number;
  readonly maxTurns?: number;
  readonly maxMinutes?: number;
  readonly planFirst?: boolean;
  readonly external?: boolean;
  /** The background task of the session. */
  readonly task?: string;
}

/** The info of a new session. */
export function newSessionInfo(
  id: string,
  project: string,
  name: string,
  colour: string,
  patch: NewSessionPatch,
): AgentSessionInfo {
  return {
    id,
    project,
    name,
    colour,
    mode: patch.mode ?? "review",
    model: patch.model ?? "opus",
    effort: patch.effort ?? "high",
    running: false,
    queued: 0,
    costUsd: 0,
    contextShare: null,
    budgetUsd: patch.budgetUsd ?? null,
    tokens: 0,
    maxTurns: patch.maxTurns ?? null,
    maxMinutes: patch.maxMinutes ?? null,
    waiting: false,
    planFirst: patch.planFirst ?? false,
    external: patch.external ?? false,
    ...(patch.task === undefined ? {} : { task: patch.task }),
  };
}

/** A new session with its presence (`tell` sends a presence message to the windows of a project). */
export function newSession(info: AgentSessionInfo, tell: (project: string, message: PresenceMessage) => void): Session {
  const session: Session = {
    info,
    turn: 0,
    items: [],
    queue: [],
    abort: null,
    nextItem: 1,
    allowed: new Set<ActionKind>(),
    plan: null,
    idle: null,
    presence: new SessionPresence(() => session.info, tell),
  };
  return session;
}
