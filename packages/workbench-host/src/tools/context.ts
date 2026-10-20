// SPDX-License-Identifier: Apache-2.0
/**
 * The context of the MCP tools of the workbench. The host makes one
 * `ToolContext` per call: a port to each frame of the lab surface, the checkout, the console log and the state of
 * the dev server. The tools use nothing else of the host, so a test gives a fake context.
 */
import type { SceneToolContext, SurfacePort, ToolFrame } from "@scenity/agent-tools/context";
import type { JobPort } from "@scenity/agent-tools/jobs";
import { CONSOLE_CALL, sendBridgeCall } from "@scenity/bridge";
import type { IndexHit, IndexPut } from "@scenity/labs-platform/indexStore";
import type { Capture, CaptureMime, RunInfo, SurfaceState } from "../protocol";
import type { Role } from "../roleProtocol";

/** The after capture of the turn of Claude, as `workbench_after` reads it. */
export interface AfterView {
  readonly turn: number;
  readonly files: readonly string[];
  /** The URL state of the turn start, or null. */
  readonly url: string | null;
  readonly after: Capture | null;
  readonly reloaded: boolean;
  /** False when the dev server applied no update in time (or the files are not lab files). */
  readonly applied: boolean;
  readonly error: string | null;
}

/** The parts of the agent loop that the loop tools use. The host gives them, and a test gives fakes. */
export interface LoopPorts {
  /** Wait for the update of the last edit and capture the frame at the URL state of the turn start. Null: no turn. */
  after?(width?: number): Promise<AfterView | null>;
  /** Run a `labs` subcommand of the allowlist in the checkout and wait for its end (runs.ts `startRun`). */
  run?(command: string, args: readonly string[]): Promise<Omit<RunInfo, "output">>;
}

export type { SurfacePort, ToolFrame } from "@scenity/agent-tools/context";

/** The state of the dev server of the lab surface, as `SurfaceState` gives it. */
export type ServerInfo = Pick<SurfaceState, "server" | "lastEdit">;

/** The Git state of the checkout for the context packet. */
export interface GitSummary {
  /** The branch, or null for a detached HEAD. */
  readonly branch: string | null;
  /** The changed files (`git status --porcelain`), as paths of the checkout. */
  readonly changed: readonly string[];
}

/** The errors and warnings of a surface that the tools and the packet read. */
export interface ConsoleSnapshot {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * The console log of the lab surface. The bridge call `console` gives the entries since its last call and then
 * forgets them. The log keeps them, so the packet and `lab_console` both see them. `lab_console` clears the log.
 */
export interface ConsoleLog {
  /** Get the new entries from the frame, keep them, and give all kept entries. */
  pull(port: SurfacePort): Promise<ConsoleSnapshot>;
  /** The kept entries, without a call. */
  peek(): ConsoleSnapshot;
  clear(): void;
}

/**
 * The frame index of the host for the tools: `lab_frame` and `lab_sheet` answer from it on a hit, and
 * `lab_frame` keeps its picture there on a miss (a 1280 px frame on demand).
 */
export interface ToolIndex {
  get(key: string, size?: number): Promise<IndexHit | null>;
  put(item: IndexPut): Promise<unknown>;
}

/** The context of one tool call. */
export interface ToolContext extends LoopPorts, SceneToolContext {
  /** The frame index of the host, or absent (a test without an index). */
  readonly index?: ToolIndex;
  /** The picture store of the host (pictures by ID), or absent (a test without a store). */
  readonly pictures?: ToolPictures;
  /** The port to a frame of the scene surface. */
  surface(frame: ToolFrame): SurfacePort;
  /** The manifest ID of the scene surface (the packet names it), or absent (a test). */
  readonly scene?: string;
  /** The absolute path of the open checkout (the root of the Git worktree). */
  readonly checkout: string;
  /** The project folder of the open checkout (absolute), or absent (a test: the checkout). */
  readonly projectDir?: string;
  /** The jobs of the open checkout (`job_run`, `job_status`, `job_output`), or absent (no runs). */
  readonly jobs?: JobPort;
  /** The agent session of the call (its ID, name and colour), or absent. The history of the page keeps it. */
  readonly session?: { readonly id: string; readonly name: string; readonly colour?: string };
  /** The role of the caller of the tool, or absent (a session of the host: the role of its owner). */
  readonly role?: Role;
  readonly consoleLog: ConsoleLog;
  /** The state of the dev server of the scene surface, or null when the host has none. */
  server?(frame?: ToolFrame): ServerInfo | null;
  /** The Git state of the checkout. The default runs `git status`. A test gives a fake. */
  git?(checkout: string): Promise<GitSummary>;
  /** The current time. A test gives a fixed time. */
  now?(): Date;
}

/** The kept entries of each kind: the newest stay. */
const CONSOLE_KEEP = 50;

function keep(list: string[], items: readonly unknown[]): void {
  for (const item of items) if (typeof item === "string") list.push(item);
  list.splice(0, Math.max(0, list.length - CONSOLE_KEEP));
}

/** Make an empty console log. */
export function createConsoleLog(): ConsoleLog {
  const errors: string[] = [];
  const warnings: string[] = [];
  const peek = (): ConsoleSnapshot => ({ errors: [...errors], warnings: [...warnings] });
  return {
    async pull(port) {
      // The base call `console` of `@scenity/bridge` (a bad list gives no entries).
      const report = await sendBridgeCall(CONSOLE_CALL, (name, args) => port.call(name, args, { timeoutMs: 5_000 }));
      keep(errors, report.errors);
      keep(warnings, report.warnings);
      return peek();
    },
    peek,
    clear() {
      errors.length = 0;
      warnings.length = 0;
    },
  };
}

/** The picture store of the tools (PictureStore of pictures.ts): it keeps the bytes once and gives their ID. */
export interface ToolPictures {
  put(bytes: Uint8Array, mime: CaptureMime): string;
}

/** The parts of a tool context that the host gives. */
export interface ToolContextParts extends LoopPorts {
  surface(frame: ToolFrame): SurfacePort;
  readonly scene?: string;
  readonly index?: ToolIndex;
  readonly pictures?: ToolPictures;
  readonly checkout: string;
  readonly projectDir?: string;
  readonly role?: Role;
  readonly consoleLog?: ConsoleLog;
  server?(frame?: ToolFrame): ServerInfo | null;
  git?(checkout: string): Promise<GitSummary>;
  now?(): Date;
}

/** Make a tool context. The host keeps one console log per checkout and gives it in each context. */
export function makeToolContext(parts: ToolContextParts): ToolContext {
  return { ...parts, consoleLog: parts.consoleLog ?? createConsoleLog() };
}
