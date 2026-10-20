// SPDX-License-Identifier: Apache-2.0
/**
 * The earlier chat and terminal sessions of a checkout for the Sessions tab: the list of
 * the SDK (`listSessions` for the cwd of the checkout), with the cost that this host saw for each session and a mark
 * for the sessions that the workbench recorded. The costs stay in `<state>/agent-costs.json`. Each entry also gives the
 * options of a resume: the kept options of the session (keptOptions.ts), else the defaults of the start form.
 */
import { join } from "node:path";
import type { AgentSessionEntry, AgentStartParams } from "../agentProtocol";
import { readJsonObject, writeJsonAtomic, type HostState } from "../state";
import type { AgentSdk, SDKSessionInfo } from "./sdk";

/** The file of the costs in the state folder. */
export const COSTS_FILE = "agent-costs.json";
/** The count of sessions that the list gives at most. */
export const SESSIONS_MAX = 100;

/** The last estimated cost of each SDK session that this host saw. */
export class CostStore {
  readonly #path: string;

  constructor(stateDir: string) {
    this.#path = join(stateDir, COSTS_FILE);
  }

  all(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(readJsonObject(this.#path))) {
      if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
    }
    return out;
  }

  /** Record the current cost of a session (the newest result wins). */
  set(sessionId: string, costUsd: number): void {
    const all = this.all();
    if (all[sessionId] === costUsd) return;
    writeJsonAtomic(this.#path, { ...all, [sessionId]: costUsd });
  }
}

/** The options of a resume of a session, and true when the host kept them (keptOptions.ts). */
export type ResumeOptions = (sessionId: string) => { options: AgentStartParams; kept: boolean };

/** One entry of the list. */
export function sessionEntry(
  info: SDKSessionInfo,
  costs: Readonly<Record<string, number>>,
  recorded: ReadonlySet<string>,
  live: ReadonlyMap<string, string>,
  options: ResumeOptions,
): AgentSessionEntry {
  return {
    sessionId: info.sessionId,
    title: info.customTitle ?? info.summary,
    firstPrompt: info.firstPrompt ?? null,
    lastModified: info.lastModified,
    createdAt: info.createdAt ?? null,
    gitBranch: info.gitBranch ?? null,
    costUsd: costs[info.sessionId] ?? null,
    workbench: recorded.has(info.sessionId),
    live: live.get(info.sessionId) ?? null,
    ...options(info.sessionId),
  };
}

export interface ListInput {
  readonly sdk: AgentSdk;
  readonly checkout: string;
  readonly state: HostState;
  readonly costs: CostStore;
  /** The SDK session ID of each live host session, with the host ID. */
  readonly live: ReadonlyMap<string, string>;
  readonly options: ResumeOptions;
  readonly limit?: number;
}

/** The sessions of the checkout, the newest first. */
export async function listCheckoutSessions(input: ListInput): Promise<AgentSessionEntry[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 50), SESSIONS_MAX);
  const infos = await input.sdk.listSessions({ dir: input.checkout, limit, includeWorktrees: false });
  const recorded = new Set(input.state.sessions(input.checkout));
  const costs = input.costs.all();
  return infos
    .map((info) => sessionEntry(info, costs, recorded, input.live, input.options))
    .sort((a, b) => b.lastModified - a.lastModified);
}
