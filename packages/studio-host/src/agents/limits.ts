// SPDX-License-Identifier: Apache-2.0
/**
 * The cost and the limits of the agent sessions. An Auto session has a budget (USD), a count of turns and the minutes
 * of a turn (default $5, 200 turns, 30 minutes). At a limit, the session stops and gives the cause. The ledger keeps
 * the cost and the tokens of each day in the studio state folder (`agent-usage.json`). Thus the Hub and the panel show
 * the use of the day.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** The default limits of an Auto session. */
export const AUTO_DEFAULTS = { budgetUsd: 5, maxTurns: 200, maxMinutes: 30 } as const;

/** The limits and the use of a session. */
export interface SessionLimits {
  readonly budgetUsd: number | null;
  readonly maxTurns: number | null;
  readonly maxMinutes: number | null;
  readonly costUsd: number;
}

/** True when the cost of a session reached its budget. */
export function overBudget(info: Pick<SessionLimits, "budgetUsd" | "costUsd">): boolean {
  return info.budgetUsd !== null && info.budgetUsd > 0 && info.costUsd >= info.budgetUsd;
}

/** The text of a session that stopped at its budget. */
export function budgetText(info: Pick<SessionLimits, "budgetUsd">): string {
  return `The session used its budget of $${(info.budgetUsd ?? 0).toFixed(2)} and stopped. The person can raise the budget.`;
}

/** The reason why a session cannot start turn `turn` (1 for the first), or null. */
export function turnRefusal(info: SessionLimits, turn: number): string | null {
  if (overBudget(info)) return budgetText(info);
  if (info.maxTurns !== null && turn > info.maxTurns) {
    return `The session used its ${String(info.maxTurns)} turns and stopped. The person can raise the limit.`;
  }
  return null;
}

/** The text of a turn that ran out of its minutes. */
export function minutesText(minutes: number): string {
  return `The turn ran ${String(minutes)} minutes, the limit of the session, and stopped.`;
}

/** The cost and the tokens of one day. */
export interface DayUsage {
  readonly costUsd: number;
  readonly tokens: number;
}

/** The ledger of the use of each day (none: a host with no state folder, a test). */
export class UsageLedger {
  readonly #file: string | null;
  #days: Record<string, DayUsage> = {};

  constructor(file: string | null) {
    this.#file = file;
    if (file === null || !existsSync(file)) return;
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as { days?: Record<string, DayUsage> };
      this.#days = value.days ?? {};
    } catch {
      this.#days = {};
    }
  }

  /** Add a use to the day of `now`. */
  add(costUsd: number, tokens: number, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    const old = this.#days[day] ?? { costUsd: 0, tokens: 0 };
    this.#days = { ...this.#days, [day]: { costUsd: old.costUsd + costUsd, tokens: old.tokens + tokens } };
    if (this.#file !== null)
      writeFileSync(this.#file, `${JSON.stringify({ format: "scenity.agent-usage/1", days: this.#days })}\n`);
  }

  /** The use of the day of `now`. */
  today(now = new Date()): DayUsage {
    return this.#days[now.toISOString().slice(0, 10)] ?? { costUsd: 0, tokens: 0 };
  }
}

/** A change of the limits of a session. */
export interface LimitsPatch {
  readonly budgetUsd?: number;
  readonly maxTurns?: number;
  readonly maxMinutes?: number;
}

/**
 * The limits of a session after a change: a value of the patch, else the value of the session, else (for Auto) the
 * default of the preferences or of the studio. Throw for a bad value. An Auto session needs a budget.
 */
export function nextLimits(
  now: Pick<SessionLimits, "budgetUsd" | "maxTurns" | "maxMinutes">,
  patch: LimitsPatch,
  auto: boolean,
  preferredBudget: number | undefined,
): Pick<SessionLimits, "budgetUsd" | "maxTurns" | "maxMinutes"> {
  for (const value of [patch.budgetUsd, patch.maxTurns, patch.maxMinutes]) {
    if (value !== undefined && !(value >= 0)) throw new Error("A limit is 0 or more.");
  }
  const pick = (given: number | undefined, kept: number | null, fallback: number): number | null =>
    given ?? kept ?? (auto ? fallback : null);
  const budgetUsd = pick(patch.budgetUsd, now.budgetUsd, preferredBudget ?? AUTO_DEFAULTS.budgetUsd);
  if (auto && (budgetUsd === null || budgetUsd <= 0)) throw new Error("An Auto session needs a budget.");
  return {
    budgetUsd,
    maxTurns: pick(patch.maxTurns, now.maxTurns, AUTO_DEFAULTS.maxTurns),
    maxMinutes: pick(patch.maxMinutes, now.maxMinutes, AUTO_DEFAULTS.maxMinutes),
  };
}
