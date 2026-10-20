// SPDX-License-Identifier: Apache-2.0
/**
 * The busy state of the host for the desktop shell.
 *
 * The host is busy while a run (`runs`), a background run (`loops`), a chat session (`agent.status`) or the Claude
 * terminal (its output) works. The desktop shell continues to draw the window of a busy host behind other windows
 * (the private occlusion call of WKWebView) and disables App Nap.
 *
 * The host writes the state as a line on stdout, `WORKBENCH_SIGNAL {"busy":true}`, only when the shell asks for it
 * (`SCENITY_WORKBENCH_SIGNALS=1`). The supervisor gives the line to the shell (supervisor.ts). The host tells the
 * shell, not the page, because a covered page gets its timers at 1 Hz. Thus a signal through the page comes late. The
 * browser path has no signal and no change: a browser throttles a hidden tab, and the tools use the shadow frame.
 */
import type { HostEvent } from "./protocol";

/** The prefix of a signal line on stdout. The desktop shell reads it. */
export const SIGNAL_PREFIX = "WORKBENCH_SIGNAL ";
/** The environment switch of the shell: "1" enables the signal lines. */
export const SIGNALS_ENV = "SCENITY_WORKBENCH_SIGNALS";
/** The time after the last work before the host is idle (ms): a short pause between two steps keeps the window busy. */
export const IDLE_AFTER_MS = 10_000;

/** A signal line. */
export function formatSignal(signal: { readonly busy: boolean }): string {
  return `${SIGNAL_PREFIX}${JSON.stringify(signal)}`;
}

/** What the tracker reads from the host at an event. */
export interface BusySources {
  /** The number of the runs that run at this time. */
  runsRunning(): number;
  /** True when the terminal is a Claude terminal. */
  isClaudeTerminal(id: string): boolean;
}

export interface BusyOptions {
  readonly emit: (busy: boolean) => void;
  readonly idleAfterMs?: number;
  readonly now?: () => number;
}

const WORKING_AGENT = new Set(["starting", "running", "waiting"]);
const WORKING_LOOP = new Set(["starting", "running", "checking"]);

/** The busy state from the events of the host. A change to busy goes out at once; a change to idle after a pause. */
export class BusyTracker {
  readonly #options: BusyOptions;
  readonly #agents = new Map<string, string>();
  readonly #loops = new Map<string, string>();
  #runs = 0;
  /** The time of the last work (an event while something works, or the output of the Claude terminal). */
  #lastWork = Number.NEGATIVE_INFINITY;
  #sent = false;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BusyOptions) {
    this.#options = options;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #idleAfter(): number {
    return this.#options.idleAfterMs ?? IDLE_AFTER_MS;
  }

  /** True while a run, a background run or a chat session works. */
  working(): boolean {
    if (this.#runs > 0) return true;
    if ([...this.#agents.values()].some((state) => WORKING_AGENT.has(state))) return true;
    return [...this.#loops.values()].some((status) => WORKING_LOOP.has(status));
  }

  /** The state that the shell has. */
  busy(): boolean {
    return this.#sent;
  }

  /** Read an event of the host. */
  observe(event: HostEvent, sources: BusySources): void {
    switch (event.type) {
      case "runs.output":
      case "runs.done":
        this.#runs = sources.runsRunning();
        break;
      case "agent.status":
        this.#agents.set(event.info.session, event.info.state);
        break;
      case "loops.state":
        this.#loops.set(event.loop.loop, event.loop.status);
        break;
      case "terminal.output":
        if (!sources.isClaudeTerminal(event.terminal)) return;
        this.#lastWork = this.#now();
        break;
      default:
        return;
    }
    this.update();
  }

  /** Send a change: busy at once, idle when nothing worked for the pause. */
  update(): void {
    const now = this.#now();
    if (this.working()) this.#lastWork = now;
    const recent = now - this.#lastWork < this.#idleAfter();
    if (recent && !this.#sent) this.#send(true);
    else if (!recent && this.#sent) this.#send(false);
    if (this.#sent && this.#timer === null) {
      const wait = Math.max(1, this.#lastWork + this.#idleAfter() - now);
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.update();
      }, wait);
      this.#timer.unref();
    }
  }

  #send(busy: boolean): void {
    this.#sent = busy;
    this.#options.emit(busy);
  }

  /** Stop the timer (the stop of the host). */
  stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** The part of the server that the tracker watches: every event of the host goes through `broadcast`. */
export interface BroadcastTarget {
  broadcast(event: HostEvent): void;
}

/**
 * Watch the events of a server: each `broadcast` goes to the tracker too. The parts of the host call
 * `server.broadcast(event)` at the time of each event, so a new function on the server sees all of them.
 */
export function watchBusy(server: BroadcastTarget, sources: BusySources, options: BusyOptions): BusyTracker {
  const tracker = new BusyTracker(options);
  const send = server.broadcast.bind(server);
  server.broadcast = (event) => {
    send(event);
    tracker.observe(event, sources);
  };
  return tracker;
}
