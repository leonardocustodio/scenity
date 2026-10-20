// SPDX-License-Identifier: Apache-2.0
/**
 * The background runs of the workbench. A run is the unmodified `claude` CLI in print mode, on the owner's
 * subscription login (no `ANTHROPIC_API_KEY` in its environment, as the terminal mode):
 *
 *   claude -p "<prompt>" --permission-mode bypassPermissions --max-turns <n> --max-budget-usd <usd>
 *     --output-format stream-json --verbose --mcp-config <file> --strict-mcp-config --settings <file> [--model <m>]
 *
 * The generated settings of the run (loopGuard.ts) refuse every Git command that commits: a run never commits. The
 * `Stop` gate refuses "done" while the stop gate run of the project fails for the sequence of the
 * run (stopGate.ts, at most five times): `scenity check` (the rules of the project) by default, `labs motion <take>`
 * in this checkout. A gate run that needs a sequence does not run without one. A hard wall-clock limit stops the
 * process group. At the end the host collects the changed files, runs the review pack (the run of the kind `review`,
 * for example `labs review <take> --ref <start head>`) and writes a summary record into the state folder. The CLI
 * calls no `Stop` hook at the turn limit, the budget or an error: after such an end the host runs the same gate check
 * itself and keeps its verdict in `endCheck`.
 */
import { randomBytes } from "node:crypto";
import { createCheckout } from "./checkouts";
import { SETUP_LINE, startSetup } from "./checkoutSetup";
import { editedFile } from "./hooks";
import { gitStatus, headCommit } from "./git";
import { loopHookPath, loopRefusal, writeLoopFiles, type LoopHookEvent } from "./loopGuard";
import {
  changedFiles,
  checkLoopParams,
  checkoutRelative,
  endWords,
  loopArgv,
  loopChecks,
  needsEndCheck,
  reviewArgs,
  writeLoopRecord,
  type LoopChecks,
  type LoopPlan,
  type LoopRuns,
} from "./loopRun";
import { StreamReader } from "./loopStream";
import { endCheckLine, isRecord, type HostEndpoint, type HostEvent, type LoopInfo, type LoopParams } from "./protocol";
import { spawnRun, type RunProcess, type RunSpawner } from "./runs";
import { LogRing } from "./servers";
import { activeRunCatalog, type RunCatalog } from "./runCatalog";
import { gateRunCheck, startWhenFree, StopGate, type GateCheck } from "./stopGate";
import { terminalEnv } from "./terminal";
import { fromTop } from "./workspace";

export interface LoopManagerOptions {
  readonly stateDir: string;
  readonly endpoint: HostEndpoint;
  /** The main worktree of the host: a new worktree of a run comes from its repository. */
  readonly repo: string;
  /**
   * The workspace folder from the Git top folder of each worktree ("" or absent: the same folder). A new
   * worktree of a run uses its workspace folder, and the files of a run are paths from the workspace folder.
   */
  readonly workspaceRel?: string;
  /** The open checkout. */
  current(): string;
  emit(event: HostEvent): void;
  readonly runs: LoopRuns;
  /** The runs of the project: the stop gate and the review pack (default: the catalog of the open project). */
  readonly catalog?: () => RunCatalog;
  /** The start of the processes (a test gives a fake claude). */
  readonly spawn?: RunSpawner;
  /** The `claude` program. The default is the `claude` of the `PATH`. */
  readonly claude?: () => string;
  /** The environment of the host. The default is `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The extra MCP servers of a checkout. */
  extraServers?(checkout: string): Readonly<Record<string, unknown>>;
  /** A run ended (the experiment log). */
  onEnd?(info: LoopInfo): void;
  /** The wait after SIGINT and after SIGTERM (ms; default 5 s). */
  readonly graceMs?: number;
  /** The wall-clock limit in ms per minute of the parameter (a test gives a small one; default 60 000). */
  readonly minuteMs?: number;
  readonly now?: () => Date;
}

interface LoopEntry {
  info: LoopInfo;
  readonly plan: LoopPlan;
  /** The gate and the review pack of the sequence of the run, from the runs of the project at the start. */
  readonly checks: LoopChecks;
  readonly log: LogRing;
  readonly edited: Set<string>;
  process: RunProcess | null;
  gate: StopGate | null;
  stopped: boolean;
  timedOut: boolean;
  readonly done: Promise<LoopInfo>;
}

/** The `claude` of the `PATH` of the host. */
function whichClaude(env: Readonly<Record<string, string | undefined>>): string {
  const found = Bun.which("claude", { PATH: env.PATH ?? "" });
  if (found === null) throw new Error("The claude CLI is not on the PATH of the host.");
  return found;
}

/** The background runs of one host. */
export class LoopManager {
  readonly #options: LoopManagerOptions;
  readonly #loops = new Map<string, LoopEntry>();

  constructor(options: LoopManagerOptions) {
    this.#options = options;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  /** Start a background run. The answer comes immediately, and the run continues in the host. */
  start(params: Partial<LoopParams>): LoopInfo {
    const plan = checkLoopParams(params);
    const loop = `bg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const info: LoopInfo = {
      loop,
      checkout: this.#options.current(),
      prompt: plan.prompt,
      sequence: plan.sequence,
      take: plan.sequence,
      intent: plan.intent,
      budgetUsd: plan.budgetUsd,
      maxTurns: plan.maxTurns,
      minutes: plan.minutes,
      model: plan.model,
      status: "starting",
      started: this.#now(),
      ended: null,
      startHead: null,
      endHead: null,
      session: null,
      turns: null,
      costUsd: null,
      stopReason: null,
      result: null,
      files: [],
      gate: { refusals: 0, last: null },
      endCheck: null,
      review: null,
      record: null,
    };
    let finish: (value: LoopInfo) => void = () => undefined;
    const done = new Promise<LoopInfo>((resolve) => (finish = resolve));
    const entry: LoopEntry = {
      info,
      plan,
      checks: loopChecks((this.#options.catalog ?? activeRunCatalog)(), plan.sequence),
      log: new LogRing(400),
      edited: new Set(),
      process: null,
      gate: null,
      stopped: false,
      timedOut: false,
      done,
    };
    this.#loops.set(loop, entry);
    this.#emitState(entry);
    void this.#run(entry).then(finish, (error: unknown) => {
      this.#line(entry, `error: ${error instanceof Error ? error.message : String(error)}`);
      this.#update(entry, { status: "failed", ended: this.#now(), stopReason: "error" });
      this.#options.onEnd?.(entry.info);
      finish(entry.info);
    });
    return info;
  }

  /** True when the owner stopped the run (a method: the flag changes while the run waits). */
  #isStopped(entry: LoopEntry): boolean {
    return entry.stopped;
  }

  /** The promise of the end of a run (tests and the experiment log). */
  done(loop: string): Promise<LoopInfo> {
    const entry = this.#loops.get(loop);
    if (entry === undefined) throw new Error(`No background run ${loop}.`);
    return entry.done;
  }

  #line(entry: LoopEntry, line: string): void {
    entry.log.line(line);
    this.#options.emit({ type: "loops.progress", loop: entry.info.loop, line });
  }

  #update(entry: LoopEntry, patch: Partial<LoopInfo>): void {
    entry.info = { ...entry.info, ...patch };
    this.#emitState(entry);
  }

  #emitState(entry: LoopEntry): void {
    this.#options.emit({ type: "loops.state", loop: entry.info });
  }

  /**
   * Make the worktree of a run that asks for one: install its packages (`bun install --frozen-lockfile`), then make
   * the generated files (`bun run generate`: the token CSS and the API client). Without the token CSS the lab
   * of a new worktree does not load.
   */
  async #worktree(entry: LoopEntry): Promise<string> {
    const base = (await headCommit(entry.info.checkout)) ?? "HEAD";
    const branch = `workbench/${entry.info.loop}`;
    const made = await createCheckout(this.#options.repo, { branch, base }, true, this.#options.workspaceRel ?? "");
    this.#update(entry, { checkout: made.path });
    this.#line(entry, `worktree ${made.path} (branch workbench/${entry.info.loop})`);
    // The same setup as a worktree of the start screen (checkoutSetup.ts).
    const setup = startSetup(made.path, {
      env: terminalEnv(this.#options.env ?? process.env, "shell"),
      spawn: this.#options.spawn,
      onOutput: () => undefined,
      onStep: (step) => this.#line(entry, `${step.join(" ")}: done`),
    });
    const exit = await setup.exited;
    if (exit.code !== 0) throw new Error(`${SETUP_LINE} in the worktree failed (exit ${String(exit.code)}).`);
    return made.path;
  }

  async #run(entry: LoopEntry): Promise<LoopInfo> {
    const checkout = entry.plan.worktree ? await this.#worktree(entry) : entry.info.checkout;
    const startHead = await headCommit(checkout);
    const rel = this.#options.workspaceRel ?? "";
    const dirty = new Set((await gitStatus(checkout)).files.map((file) => fromTop(file.path, rel)));
    const { gate } = entry.checks;
    if (gate !== null) {
      entry.gate = new StopGate({
        check: gateRunCheck(this.#options.runs, checkout, gate, entry.plan.sequence),
        emit: (event) => {
          if (event.type === "agent.notify") this.#line(entry, `gate: ${event.message}`);
        },
      });
      entry.gate.set(true);
    }
    const extra = this.#options.extraServers?.(checkout) ?? {};
    const files = writeLoopFiles(this.#options.stateDir, this.#options.endpoint, entry.info.loop, extra);
    const env = this.#options.env ?? process.env;
    const claude = this.#options.claude?.() ?? whichClaude(env);
    const reader = new StreamReader((line) => this.#line(entry, line));
    this.#update(entry, { status: "running", startHead });
    if (this.#isStopped(entry)) return this.#finish(entry, checkout, dirty, reader);
    entry.process = (this.#options.spawn ?? spawnRun)(loopArgv(claude, entry.plan, files), {
      cwd: checkout,
      env: terminalEnv(env, "claude", false, files.env),
      onOutput: (stream, text) => {
        if (stream === "stdout") reader.push(text);
        else for (const line of text.split("\n")) if (line.trim() !== "") this.#line(entry, `stderr: ${line}`);
      },
    });
    const limit = entry.plan.minutes * (this.#options.minuteMs ?? 60_000);
    const timer = setTimeout(() => {
      entry.timedOut = true;
      this.#line(entry, `the wall-clock limit of ${String(entry.plan.minutes)} min ended the run`);
      void this.#kill(entry);
    }, limit);
    const exit = await entry.process.exited;
    clearTimeout(timer);
    reader.end();
    if (exit.code !== 0 && !entry.stopped && !entry.timedOut) this.#line(entry, `claude exit ${String(exit.code)}`);
    return this.#finish(entry, checkout, dirty, reader, exit.code);
  }

  /** The end of a run: the result, the files, the commit check, the review pack and the record. */
  async #finish(
    entry: LoopEntry,
    checkout: string,
    dirty: ReadonlySet<string>,
    reader: StreamReader,
    code: number | null = null,
  ): Promise<LoopInfo> {
    const facts = reader.facts;
    const ok = facts.subtype === "success" && !facts.isError;
    const status = entry.timedOut ? "timeout" : entry.stopped ? "stopped" : ok ? "done" : "failed";
    const stopReason = entry.timedOut
      ? "timeout"
      : entry.stopped
        ? "stopped"
        : (facts.subtype ?? `exit ${String(code)}`);
    const endHead = await headCommit(checkout);
    if (endHead !== entry.info.startHead) this.#line(entry, `warning: HEAD moved from ${String(entry.info.startHead)}`);
    this.#update(entry, {
      session: facts.session,
      turns: facts.turns,
      costUsd: facts.costUsd,
      result: facts.result,
      stopReason,
      endHead,
      files: await changedFiles(checkout, entry.edited, dirty, this.#options.workspaceRel ?? ""),
    });
    const gateVerdict = entry.gate?.state().last != null;
    if (needsEndCheck(entry.checks.gate !== null, { stopped: entry.stopped, success: ok, gateVerdict })) {
      await this.#endCheck(entry, checkout, stopReason);
    }
    if (entry.checks.review !== null && !entry.stopped && entry.info.startHead !== null) {
      await this.#review(entry, checkout, entry.info.startHead);
    }
    const ended = this.#now();
    this.#update(entry, { status, ended });
    const record = writeLoopRecord(this.#options.stateDir, entry.info, entry.log.lines());
    this.#update(entry, { record });
    const cost = facts.costUsd === null ? "?" : `$${facts.costUsd.toFixed(4)}`;
    this.#line(entry, `end: ${status} · ${String(facts.turns ?? "?")} turns · about ${cost} · no commit by the run`);
    this.#options.onEnd?.(entry.info);
    return entry.info;
  }

  /**
   * The gate check after an end that the `Stop` gate did not see (the turn limit, the budget, the time limit,
   * an error): the gate run of the project in the checkout of the run. The verdict goes into the run and its record.
   */
  async #endCheck(entry: LoopEntry, checkout: string, stopReason: string): Promise<void> {
    const { gate } = entry.checks;
    if (gate === null) return;
    this.#update(entry, { status: "checking" });
    const end = endWords(stopReason);
    const { sequence } = entry.plan;
    const check = gateRunCheck(this.#options.runs, checkout, gate, sequence);
    this.#line(entry, `${end}: the host runs the gate check (${[gate.command, sequence ?? ""].join(" ").trim()})`);
    let result: GateCheck;
    try {
      result = await check();
    } catch (error) {
      result = {
        sequence,
        pass: false,
        summary: `The check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const endCheck = { end, pass: result.pass, summary: result.summary, at: this.#now() };
    this.#update(entry, { endCheck });
    this.#line(entry, endCheckLine(endCheck));
  }

  async #review(entry: LoopEntry, checkout: string, ref: string): Promise<void> {
    const { review } = entry.checks;
    if (review === null) return;
    this.#update(entry, { status: "checking" });
    const args = reviewArgs(review, entry.plan.sequence, ref);
    this.#line(entry, `review pack: ${[review.command, ...args].join(" ").replace(ref, ref.slice(0, 12))}`);
    try {
      const result = await startWhenFree(this.#options.runs, checkout, review.id, args);
      this.#update(entry, { review: { run: result.run, status: result.status, outDir: result.outDir } });
    } catch (error) {
      this.#line(entry, `review pack failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Stop a run: SIGINT, SIGTERM after the grace time, SIGKILL after a second grace time. */
  async stop(loop: string): Promise<void> {
    const entry = this.#loops.get(loop);
    if (entry === undefined) throw new Error(`No background run ${loop}.`);
    if (entry.info.ended !== null) return;
    entry.stopped = true;
    this.#line(entry, "stopped by the owner");
    await this.#kill(entry);
  }

  async #kill(entry: LoopEntry): Promise<void> {
    const child = entry.process;
    if (child === null) return;
    const grace = this.#options.graceMs ?? 5000;
    const end = { done: false };
    void child.exited.then(() => (end.done = true));
    for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
      if (end.done) return;
      child.signal(signal);
      await Promise.race([child.exited, new Promise((wait) => setTimeout(wait, grace))]);
    }
  }

  /** The runs, the newest first, with their last progress lines. */
  list(lines = 60): LoopInfo[] {
    return [...this.#loops.values()]
      .reverse()
      .map((entry) => ({ ...entry.info, lines: entry.log.lines().slice(-lines) }));
  }

  /** The checkouts of the runs that made a worktree (the candidates of the picker). */
  worktrees(): { loop: string; path: string; prompt: string }[] {
    return [...this.#loops.values()]
      .filter((entry) => entry.plan.worktree && entry.info.checkout !== this.#options.current())
      .map((entry) => ({ loop: entry.info.loop, path: entry.info.checkout, prompt: entry.info.prompt }));
  }

  /** Answer a hook of a run (`POST /loops/<id>/hooks/<event>`). */
  async hook(loop: string, event: LoopHookEvent, payload: unknown): Promise<Record<string, unknown>> {
    const entry = this.#loops.get(loop);
    if (entry?.info.ended !== null) return {};
    const body = isRecord(payload) ? payload : {};
    if (event === "PreToolUse") {
      const input = body.tool_input;
      const command = isRecord(input) && typeof input.command === "string" ? input.command : null;
      const reason = command === null ? null : loopRefusal(command);
      if (reason === null) return {};
      this.#line(entry, `refused: ${command ?? ""}`);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }
    if (event === "PostToolUse") {
      const file = editedFile(body);
      if (file !== null) entry.edited.add(checkoutRelative(entry.info.checkout, file));
      return {};
    }
    return this.#stopHook(entry, body);
  }

  async #stopHook(entry: LoopEntry, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (entry.gate === null) return {};
    this.#update(entry, { status: "checking" });
    const answer = await entry.gate.onStop(typeof body.session_id === "string" ? body.session_id : null);
    const last = entry.gate.state().last;
    const refused = answer.decision === "block";
    this.#update(entry, {
      status: "running",
      gate: {
        refusals: entry.info.gate.refusals + (refused ? 1 : 0),
        last: last === null ? null : `${last.pass ? "pass" : "fail"}: ${last.summary.split("\n")[0] ?? ""}`,
      },
    });
    this.#line(
      entry,
      `gate: ${last?.pass === true ? "pass" : refused ? "fail, Claude goes on" : "fail, the run may end"}`,
    );
    return answer;
  }

  /** The HTTP route of the hooks of the runs. The server checked the token. */
  http(): (request: Request, url: URL) => Promise<Response | null> {
    return async (request, url) => {
      const hook = loopHookPath(url.pathname);
      if (hook === null || request.method !== "POST") return null;
      const text = await request.text();
      let payload: unknown;
      try {
        payload = text.trim() === "" ? {} : (JSON.parse(text) as unknown);
      } catch {
        return Response.json({ ok: false, error: "The body is not JSON." }, { status: 400 });
      }
      return Response.json(await this.hook(hook.loop, hook.event, payload));
    };
  }

  /** Stop every run (the stop of the host). */
  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#loops.values()].filter((e) => e.info.ended === null).map((e) => this.stop(e.info.loop)),
    );
  }

  /** Send SIGKILL to every run immediately (the exit of the process). */
  killNow(): void {
    for (const entry of this.#loops.values()) if (entry.info.ended === null) entry.process?.signal("SIGKILL");
  }
}
