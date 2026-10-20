// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the change loop: the runs of the commands of the project, the Git requests of the Changes tab, the
 * turns of Claude and the tune to code. `protocol.ts` exports them. This module is pure (no `node:` or `bun:` import),
 * so the page gets them through
 * `@scenity/workbench-host/protocol`.
 */
import type { ChangedFile, RunCommand } from "./protocol";

/** The state of a run: it runs, it ended with exit code 0, it ended with another code, or the owner stopped it. */
export type RunStatus = "running" | "passed" | "failed" | "cancelled";

/**
 * A run that the host starts itself: `setup`, the setup of a new worktree (checkoutSetup.ts), or `import`, the
 * import job of a dropped file (imports.ts).
 */
export type HostRunCommand = "setup" | "import";

/** A button of a run in the Runs tab (`runPresetSchema` of `@scenity/scene`). */
export interface ProjectRunPreset {
  readonly label: string;
  readonly args?: readonly string[];
  /** The button gets a sequence field with this start text; the sequence goes in front of the arguments. */
  readonly sequence?: string;
  /** The button asks the owner with this text first; then the run starts as a confirmed run. */
  readonly confirm?: string;
}

/**
 * One run of the project, with the defaults filled in: from `workbench.runs` of the manifest and from the runs
 * of the host plugins (`runSpecSchema` of `@scenity/scene` has the meaning of each field).
 */
export interface ProjectRun {
  readonly id: string;
  readonly label: string;
  /** The command line. The host runs it with no shell, in the project folder. */
  readonly command: string;
  readonly kind: string;
  /** The folder of the output folders, relative to the project folder, or null (no `--out`). */
  readonly out: string | null;
  readonly gpu: boolean | "confirmed";
  readonly gpuOff: readonly string[];
  readonly confirm: boolean;
  readonly ref: boolean;
  /** How the run takes a sequence (a flag, or "" for the first argument), or null. */
  readonly sequence: { readonly flag: string; readonly required: boolean } | null;
  /** True: the agent tool `workbench_run` can start the run. */
  readonly agent: boolean;
  readonly aliases: readonly string[];
  readonly presets: readonly ProjectRunPreset[];
}

/** One run of a command of the project, or a run of the host itself. */
export interface RunInfo {
  readonly run: string;
  /** The ID of a run of the project (`ProjectRun`), or a run of the host itself (a `HostRunCommand`). */
  readonly command: RunCommand;
  /** The command line of the run without its arguments (absent for a run of an older host). */
  readonly line?: string;
  /** The arguments after the command, as the host gave them to the program (with the flags that the host added). */
  readonly args: readonly string[];
  readonly checkout: string;
  readonly status: RunStatus;
  readonly code: number | null;
  /** ISO times. */
  readonly started: string;
  readonly ended: string | null;
  /** True for a command that renders WebGL; one such run at a time per checkout. */
  readonly gpu: boolean;
  /** The last lines of the output, without the ANSI codes. */
  readonly summary: string;
  /** The absolute path of the output folder, or null. */
  readonly outDir: string | null;
  /** The absolute paths of the images of the output folder. */
  readonly images: readonly string[];
  /** The last lines of the output (`runs.list` only; the page shows them after a reload). */
  readonly output?: string;
}

/** The state of a turn of Claude: open (the owner can undo it), kept, or undone. */
export type TurnState = "open" | "kept" | "undone";

/** One turn of Claude: the files that it changed, from the `PostToolUse` hooks. */
export interface TurnSummary {
  readonly session: string;
  readonly turn: number;
  /** The first line of the prompt that started the turn, or an empty text. */
  readonly prompt: string;
  readonly started: string;
  /** The commit at the turn start. */
  readonly head: string | null;
  /** The changed files, relative to the checkout. */
  readonly files: readonly string[];
  readonly state: TurnState;
}

/** The result of `git.undoTurn`. */
export interface UndoResult {
  /** The files that got their content of the turn start again. */
  readonly restored: readonly string[];
  /** The files that the turn created; the undo deleted them. */
  readonly deleted: readonly string[];
  /** The files that the host could not restore (no saved content), with the reason. */
  readonly skipped: readonly string[];
}

/** The requests of the change loop (page to host). `RequestMap` of protocol.ts extends this map. */
export interface ChangesRequests {
  /** The changed files of the checkout. */
  "git.status": { params: object; result: { branch: string | null; head: string | null; files: ChangedFile[] } };
  /** The diff of the given files against HEAD (all changed files when `paths` is absent). */
  "git.diff": { params: { paths?: string[] }; result: { patch: string } };
  /**
   * The turns of the open checkout, the files of the session (the open and kept turns), the commit at the
   * session start and a proposed commit message from the prompts.
   */
  "git.turns": {
    params: object;
    result: { start: string | null; turns: TurnSummary[]; files: string[]; proposal: string };
  };
  /** Keep a turn: its files stay and the host removes the undo of the turn. */
  "git.keepTurn": { params: { session: string; turn: number }; result: null };
  /** Restore the files of one turn to their state at the turn start. */
  "git.undoTurn": { params: { session: string; turn: number }; result: UndoResult };
  /** Commit the given files with a message of one subject line. Only the owner sends it. */
  "git.commit": { params: { message: string; paths: string[] }; result: { commit: string } };
  /**
   * Start a run of the project. `confirm` is the confirmation of the owner for a run with
   * `confirm` (for example a release). Without it, the host adds `--dry`.
   */
  "runs.start": { params: { command: RunCommand; args: string[]; confirm?: boolean }; result: { run: string } };
  /** Stop a run (SIGINT, then SIGTERM). */
  "runs.cancel": { params: { run: string }; result: null };
  /** The runs of this host, the newest first, with the last lines of their output. */
  "runs.list": { params: object; result: RunInfo[] };
  /** The runs of the open project and the ID of its stop gate (null: no gate). */
  "runs.commands": { params: object; result: { runs: ProjectRun[]; gate: string | null } };
  /** Run `labs tune-apply "<the tune values of the lab>" [--dry]`. */
  "tunes.apply": { params: { dry: boolean }; result: { run: string; values: string } };
}

/** The names of the requests of the change loop. */
export const CHANGES_REQUEST_NAMES: Readonly<Record<keyof ChangesRequests, true>> = {
  "git.status": true,
  "git.diff": true,
  "git.turns": true,
  "git.keepTurn": true,
  "git.undoTurn": true,
  "git.commit": true,
  "runs.start": true,
  "runs.cancel": true,
  "runs.list": true,
  "runs.commands": true,
  "tunes.apply": true,
};

/** The HTTP path of a file of the output folder of a run: `GET /runs/<run>/file?path=<path>`. */
export const RUN_FILE_PREFIX = "/runs/";

/** The URL of a file of a run. `path` is absolute (under the output folder) or relative to the output folder. */
export function runFileUrl(origin: string, run: string, path: string): string {
  return `${origin}${RUN_FILE_PREFIX}${encodeURIComponent(run)}/file?path=${encodeURIComponent(path)}`;
}

/** Read the run ID of a run file path (`/runs/<run>/file`), or null for another path. */
export function runOfFilePath(pathname: string): string | null {
  const match = /^\/runs\/([^/]+)\/file$/.exec(pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/** The text of the ANSI escape codes (colors, cursor moves) that a page does not draw. */
// eslint-disable-next-line no-control-regex -- the ESC character starts each code.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Remove the ANSI escape codes of a terminal text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
