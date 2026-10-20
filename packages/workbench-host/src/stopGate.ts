// SPDX-License-Identifier: Apache-2.0
/**
 * The `Stop` gate of a Claude session. When the owner enables it, the `Stop` hook refuses "done" while the gate check
 * fails. The check of a session is the
 * fast check of a host plugin in the shadow frame (the owner's clock does not move), else the stop gate run of the
 * project (runCatalog.ts: `workbench.gate`, `scenity check` by default) for the sequence of the scene surface. A
 * background run checks with the gate run (loops.ts).
 *
 * The gate refuses at most `maxRefusals` times in a row per session, so a session that cannot fix a check still ends.
 */
import type { HookOutput } from "./hooks";
import type { HostPlugin } from "./plugin";
import type { HostEvent, ProjectRun, StopGateState } from "./protocol";
import { runsFor, sequenceArgs } from "./runCatalog";
import type { RunResult, StartOptions } from "./runs";
import type { SurfacePort } from "./tools/context";

/** The result of one check of the gate. */
export interface GateCheck {
  /** The sequence of the check, or null. */
  readonly sequence: string | null;
  readonly pass: boolean;
  /** The lines of the failures, for Claude and the page. */
  readonly summary: string;
  /** What the gate checks, in words (for example the command line of the gate run). */
  readonly title?: string;
  /** The words for Claude after a refusal (the default: fix the cause, or tell the owner). */
  readonly hint?: string;
}

/** What a gate check needs of the runs of the host. */
export interface GateRuns {
  startRun(checkout: string, command: string, args: readonly unknown[], options?: StartOptions): Promise<RunResult>;
  running(checkout: string): { readonly gpu: boolean } | null;
}

/** Wait until the checkout has no GPU run, then start a run (one GPU run per checkout, runs.ts). */
export async function startWhenFree(
  runs: GateRuns,
  checkout: string,
  command: string,
  args: readonly string[],
  waitMs = 1000,
  limitMs = 600_000,
): Promise<RunResult> {
  const end = Date.now() + limitMs;
  while (runs.running(checkout)?.gpu === true) {
    if (Date.now() > end) throw new Error("A GPU run of the checkout did not end in time.");
    await new Promise((wait) => setTimeout(wait, waitMs));
  }
  return runs.startRun(checkout, command, args);
}

/** The check of the gate run for a sequence in a checkout: the exit code of the run decides. */
export function gateRunCheck(
  runs: GateRuns,
  checkout: string,
  gate: ProjectRun,
  sequence: string | null,
): () => Promise<GateCheck> {
  const args = sequenceArgs(gate, sequence);
  const title = [gate.command, ...args].join(" ");
  return async () => {
    const result = await startWhenFree(runs, checkout, gate.id, args);
    return { sequence, pass: result.status === "passed", summary: result.summary, title };
  };
}

/** The sequence of a URL of the scene surface (`sequence`, or `take` of the lab page), or null. */
function urlSequence(url: string | null): string | null {
  if (url === null) return null;
  try {
    const params = new URL(url).searchParams;
    return params.get("sequence") ?? params.get("take");
  } catch {
    return null;
  }
}

/** What the gate of a session reads. */
export interface SessionGate {
  readonly plugins: readonly HostPlugin[];
  readonly gate: ProjectRun | null;
  readonly runs: GateRuns | null;
  readonly checkout: string;
  readonly port: SurfacePort;
  /** The URL of the visible frame of the scene surface, or null. */
  readonly url: string | null;
}

/**
 * The check of the gate of a session: the fast check of a host plugin, else the gate run for the sequence of
 * the URL. A project with no gate, or a gate that needs a sequence when the URL has none, passes.
 */
export async function sessionGateCheck(parts: SessionGate): Promise<GateCheck> {
  const plugin = parts.plugins.find((item) => item.gateCheck !== undefined);
  if (plugin?.gateCheck !== undefined) return plugin.gateCheck(parts.port, parts.url);
  const sequence = urlSequence(parts.url);
  const { gate, runs } = parts;
  if (gate === null || runs === null) return { sequence, pass: true, summary: "The project has no stop gate." };
  if (!runsFor(gate, sequence)) return { sequence, pass: true, summary: "The gate needs a sequence: none is open." };
  return gateRunCheck(runs, parts.checkout, gate, sequence)();
}

export interface StopGateOptions {
  /** Run the gate check. */
  check(): Promise<GateCheck>;
  emit(event: HostEvent): void;
  /** The most refusals in a row per session (default 5). */
  readonly maxRefusals?: number;
  readonly now?: () => Date;
}

/** The gate of the open checkout. */
export class StopGate {
  readonly #options: StopGateOptions;
  #on = false;
  #sequence: string | null = null;
  #last: StopGateState["last"] = null;
  readonly #refusals = new Map<string, number>();

  constructor(options: StopGateOptions) {
    this.#options = options;
  }

  state(): StopGateState {
    return { on: this.#on, sequence: this.#sequence, take: this.#sequence, last: this.#last };
  }

  /** Enable or disable the gate. The pages get the new state. */
  set(on: boolean): StopGateState {
    this.#on = on;
    this.#refusals.clear();
    this.#emit();
    return this.state();
  }

  #emit(): void {
    this.#options.emit({ type: "agent.stopGate", gate: this.state() });
  }

  /** The `Stop` hook of a session: `{}` lets Claude stop, and `{ decision: "block", reason }` makes it continue. */
  async onStop(session: string | null): Promise<HookOutput> {
    if (!this.#on) return {};
    const key = session ?? "";
    let result: GateCheck;
    try {
      result = await this.#options.check();
    } catch (error) {
      // A gate that cannot check does not keep Claude: the owner sees why.
      const reason = error instanceof Error ? error.message : String(error);
      this.#record({ sequence: this.#sequence, pass: true, summary: `The check failed: ${reason}` }, false);
      return {};
    }
    const count = this.#refusals.get(key) ?? 0;
    const refuse = !result.pass && count < (this.#options.maxRefusals ?? 5);
    this.#refusals.set(key, refuse ? count + 1 : 0);
    this.#record(result, refuse);
    if (!refuse) return {};
    const what = gateTitle(result);
    const reason = [
      `The workbench Stop gate is on: ${what} fails.`,
      result.summary,
      result.hint ?? "Fix the cause, or tell the owner why it cannot pass.",
    ].join("\n");
    this.#options.emit({
      type: "agent.notify",
      session,
      kind: "stop_gate",
      title: "The Stop gate refused done",
      message: `The gate fails (${what}). Claude goes on (${String(count + 1)}).`,
    });
    return { decision: "block", reason };
  }

  #record(result: GateCheck, refused: boolean): void {
    this.#sequence = result.sequence;
    const at = (this.#options.now?.() ?? new Date()).toISOString();
    this.#last = { pass: result.pass, summary: result.summary, at, refused };
    this.#emit();
  }
}

/** What a gate check checks, in words. */
function gateTitle(result: GateCheck): string {
  if (result.title !== undefined) return result.title;
  return result.sequence === null ? "the gate check" : `the gate check of ${result.sequence}`;
}
