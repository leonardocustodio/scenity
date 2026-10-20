// SPDX-License-Identifier: Apache-2.0
/**
 * The kept options of each chat session: the host keeps the last options of each SDK
 * session in `<state>/agent-options.json` (the mode, the credential choice, the model, the effort, the budget and the
 * turn limit). A resume or a fork from the Sessions tab uses them unless the request gives others. A session without
 * kept options (an old one, or one of the CLI) gets the defaults of the chat start form. The file holds the
 * credential choice only, never a key.
 */
import { join } from "node:path";
import {
  isAgentCredential,
  isAgentEffort,
  isAgentMode,
  type AgentSessionInfo,
  type AgentStartParams,
} from "../agentProtocol";
import { isRecord } from "../protocol";
import { readJsonObject, writeJsonAtomic } from "../state";

/** The file of the kept options in the state folder. */
export const OPTIONS_FILE = "agent-options.json";
/** The count of sessions that the file keeps at most (the oldest go first). */
export const OPTIONS_MAX = 200;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The start parameters of a live session: the options to keep. Only the named fields go in. */
export function keptParams(info: AgentSessionInfo): AgentStartParams {
  return {
    mode: info.mode,
    credential: info.credential,
    ...(info.model === null ? {} : { model: info.model }),
    ...(info.effort === null ? {} : { effort: info.effort }),
    ...(info.maxBudgetUsd === null ? {} : { maxBudgetUsd: info.maxBudgetUsd }),
    ...(info.maxTurns === null ? {} : { maxTurns: info.maxTurns }),
  };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Read one entry of the file. Give null for an entry that is not a set of options. Unknown fields go out. */
export function parseKept(value: unknown): AgentStartParams | null {
  if (!isRecord(value) || !isAgentMode(value.mode)) return null;
  const out: Mutable<AgentStartParams> = { mode: value.mode };
  if (isAgentCredential(value.credential)) out.credential = value.credential;
  if (typeof value.model === "string" && value.model !== "") out.model = value.model;
  if (isAgentEffort(value.effort)) out.effort = value.effort;
  if (positive(value.maxBudgetUsd)) out.maxBudgetUsd = value.maxBudgetUsd;
  if (positive(value.maxTurns)) out.maxTurns = Math.round(value.maxTurns);
  return out;
}

/** The options of a resume: the base (kept or the form defaults), then each field that the request gives. */
export function mergeParams(base: AgentStartParams, overrides: Partial<AgentStartParams>): AgentStartParams {
  const out: Mutable<AgentStartParams> = { ...base };
  for (const [name, value] of Object.entries(overrides as Readonly<Record<string, unknown>>)) {
    if (value !== undefined) (out as Record<string, unknown>)[name] = value;
  }
  return out;
}

/** The last options of each SDK session that this host ran. */
export class OptionsStore {
  readonly #path: string;

  constructor(stateDir: string) {
    this.#path = join(stateDir, OPTIONS_FILE);
  }

  /** The kept options of a session, or null. */
  get(sessionId: string): AgentStartParams | null {
    return parseKept(readJsonObject(this.#path)[sessionId]);
  }

  /** Keep the options of a session (the newest wins). The file keeps the last `OPTIONS_MAX` sessions. */
  set(sessionId: string, params: AgentStartParams): void {
    const kept = parseKept(params);
    if (kept === null) return;
    const all = readJsonObject(this.#path);
    if (JSON.stringify(parseKept(all[sessionId])) === JSON.stringify(kept)) return;
    const others = Object.entries(all).filter(([id]) => id !== sessionId);
    const next = Object.fromEntries([...others.slice(-(OPTIONS_MAX - 1)), [sessionId, kept]]);
    writeJsonAtomic(this.#path, next);
  }
}
