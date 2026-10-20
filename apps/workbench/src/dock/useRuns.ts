// SPDX-License-Identifier: Apache-2.0
/**
 * The runs in Vue refs: the list of the host, the live output of each run from `runs.output`, and the end from
 * `runs.done`. The output keeps at most MAX_OUTPUT characters per run. The runs of the project (`runs.commands`) give
 * the buttons and the commands of the Runs tab.
 */
import {
  CHECKOUT_SETUP_LINE,
  stripAnsi,
  type ProjectRun,
  type RunCommand,
  type RunInfo,
} from "@scenity/workbench-host/protocol";
import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { DockHost } from "./dockHost";

/** The longest output that the page keeps per run (characters). */
export const MAX_OUTPUT = 200_000;

export interface RunsApi {
  readonly runs: Ref<RunInfo[]>;
  /** The runs of the open project (an empty list before the answer, or for an older host). */
  readonly commands: Ref<ProjectRun[]>;
  /** The output of each run, without the ANSI codes. */
  readonly output: Ref<Record<string, string>>;
  readonly selected: Ref<string | null>;
  readonly running: ComputedRef<RunInfo | null>;
  readonly error: Ref<string | null>;
  refresh(): Promise<void>;
  start(command: RunCommand, args: string[], confirm?: boolean): Promise<string | null>;
  cancel(run: string): Promise<void>;
  /** Show the output of a run that a request started (the tune to code). */
  follow(run: string): void;
  /** Select the run whose output the tab shows. */
  select(run: string): void;
}

function cut(text: string): string {
  return text.length > MAX_OUTPUT ? text.slice(text.length - MAX_OUTPUT) : text;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useRuns(host: DockHost): RunsApi {
  const runs = ref<RunInfo[]>([]);
  const commands = ref<ProjectRun[]>([]);
  const output = ref<Record<string, string>>({});
  const selected = ref<string | null>(null);
  const error = ref<string | null>(null);
  const running = computed(() => runs.value.find((run) => run.status === "running") ?? null);

  async function loadCommands(): Promise<void> {
    try {
      commands.value = (await host.request("runs.commands", {})).runs;
    } catch {
      // An older host has no `runs.commands`: the tab shows no buttons.
    }
  }

  async function refresh(): Promise<void> {
    try {
      const list = await host.request("runs.list", {});
      runs.value = list;
      const next = { ...output.value };
      for (const run of list) if (run.output !== undefined && (next[run.run] ?? "") === "") next[run.run] = run.output;
      output.value = next;
      error.value = null;
    } catch (reason) {
      error.value = message(reason);
    }
  }

  const stops = [
    host.on("runs.output", ({ run, data }) => {
      output.value = { ...output.value, [run]: cut((output.value[run] ?? "") + stripAnsi(data)) };
      if (!runs.value.some((item) => item.run === run)) void refresh();
    }),
    host.on("runs.done", () => void refresh()),
  ];
  if (getCurrentScope() !== undefined) onScopeDispose(() => stops.forEach((stop) => stop()));

  async function start(command: RunCommand, args: string[], confirm = false): Promise<string | null> {
    try {
      const { run } = await host.request("runs.start", { command, args, ...(confirm ? { confirm } : {}) });
      selected.value = run;
      error.value = null;
      await refresh();
      return run;
    } catch (reason) {
      error.value = message(reason);
      return null;
    }
  }

  async function cancel(run: string): Promise<void> {
    try {
      await host.request("runs.cancel", { run });
    } catch (reason) {
      error.value = message(reason);
    }
  }

  function follow(run: string): void {
    selected.value = run;
    void refresh();
  }

  void refresh();
  void loadCommands();
  const select = (run: string): void => {
    selected.value = run;
  };
  return { runs, commands, output, selected, running, error, refresh, start, cancel, follow, select };
}

/** The command line of a run, for a list. */
export function runLine(run: Pick<RunInfo, "command" | "args" | "line">): string {
  // The setup of a new worktree is a run of the host, not a run of the project.
  if (run.command === "setup") return CHECKOUT_SETUP_LINE;
  const args = run.args.filter((arg, index, all) => arg !== "--out" && all[index - 1] !== "--out");
  // The host gives the command line of the run. For a run of an older host, the line is a `labs` command.
  return [run.line ?? `labs ${run.command}`, ...args].join(" ");
}
