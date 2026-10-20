// SPDX-License-Identifier: Apache-2.0
/**
 * The runs of the open project: the run list of the Runs tab, of `workbench_run` and of
 * the hook hint, the stop gate of the loops and the run of the review pack. The list comes from `workbench.runs` of
 * the manifest and from the runs of the host plugins (a manifest run replaces a plugin run with the same ID). The
 * stop gate is `workbench.gate`, else the gate of a plugin, else `scenity check` for a project with a manifest.
 *
 * The host sets the catalog of the open project with `useRunCatalog`. A host with no project uses the runs of the
 * built-in plugins (the checkout of this repository).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunPreset, RunSpec, WorkbenchSettings } from "@scenity/scene";
import { builtInPlugins, pluginRuns } from "./plugins";
import type { HostPlugin } from "./plugin";
import type { ProjectRun, ProjectRunPreset } from "./protocol";

/** The runs of a project and its stop gate. */
export interface RunCatalog {
  readonly runs: readonly ProjectRun[];
  /** The stop gate: a run of the list, or a run of its own with the ID `gate`. Null: the project has no gate. */
  readonly gate: ProjectRun | null;
  /** The folder of the output folders of the runs of the host (for example an import), relative to the project. */
  readonly outRoot: string;
}

/** The stop gate of a project with a manifest and no gate of its own: the rules of the project. */
export const DEFAULT_GATE = "scenity check";
/** The output folder of the host runs when no run has an output folder. */
export const DEFAULT_OUT_ROOT = "test-results/workbench";
/** The ID of a gate that is not a run of the list. */
export const GATE_RUN_ID = "gate";

/** The defaults of the commands of the `scenity` program: `scenity check` takes `--sequence` and renders nothing. */
const SCENITY_DEFAULTS: Readonly<Record<string, Omit<RunSpec, "command">>> = {
  check: { label: "Check", kind: "check", sequence: { flag: "--sequence" } },
};

/** The words of a command line. */
export function commandWords(line: string): string[] {
  return line.split(/\s+/).filter((word) => word !== "");
}

/** The defaults of a command line of the `scenity` program, or an empty spec. */
function knownDefaults(line: string): Omit<RunSpec, "command"> {
  const [program, command] = commandWords(line);
  if (program !== "scenity" || command === undefined) return {};
  return SCENITY_DEFAULTS[command] ?? {};
}

/** One run of the project with the defaults filled in. */
export function projectRun(id: string, given: string | RunSpec): ProjectRun {
  const spec: RunSpec = typeof given === "string" ? { command: given } : given;
  const known = knownDefaults(spec.command);
  const merged: RunSpec = { ...known, ...spec };
  const kind = merged.kind ?? "tool";
  const sequence = merged.sequence ?? null;
  return {
    id,
    label: merged.label ?? id,
    command: merged.command,
    kind,
    out: merged.out ?? null,
    gpu: merged.gpu ?? false,
    gpuOff: [...(merged.gpuOff ?? [])],
    confirm: merged.confirm === true,
    ref: merged.ref === true,
    sequence: sequence === null ? null : { flag: sequence.flag, required: sequence.required === true },
    agent: merged.agent ?? kind !== "write",
    aliases: [...(merged.aliases ?? [])],
    presets: (merged.presets ?? []).map(presetOf),
  };
}

/** A preset of the Runs tab without the absent fields. */
function presetOf(preset: RunPreset): ProjectRunPreset {
  const { label, args, sequence, confirm } = preset;
  return {
    label,
    ...(args === undefined ? {} : { args: [...args] }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(confirm === undefined ? {} : { confirm }),
  };
}

/** The gate run of a gate text: a run of that ID, else a run with that command line, else a run of its own. */
function gateRun(runs: readonly ProjectRun[], gate: string | null): ProjectRun | null {
  if (gate === null) return null;
  const found = runs.find((run) => run.id === gate) ?? runs.find((run) => run.command === gate);
  return found ?? projectRun(GATE_RUN_ID, { kind: "check", ...knownDefaults(gate), command: gate, label: "Gate" });
}

/** The catalog of a run table and a gate text. */
export function runCatalog(table: Readonly<Record<string, string | RunSpec>>, gate: string | null): RunCatalog {
  const runs = Object.entries(table).map(([id, spec]) => projectRun(id, spec));
  const outRoot = runs.find((run) => run.out !== null)?.out ?? DEFAULT_OUT_ROOT;
  return { runs, gate: gateRun(runs, gate), outRoot };
}

/**
 * The catalog of a project: the runs of its plugins, then the runs of its manifest (the same ID replaces). The gate is
 * the gate of the manifest, else the last gate of a plugin, else `scenity check` when the project has a manifest.
 */
export function projectRunCatalog(
  plugins: readonly HostPlugin[],
  workbench: Pick<WorkbenchSettings, "runs" | "gate"> | undefined,
  manifest: boolean,
): RunCatalog {
  const fromPlugins = pluginRuns(plugins);
  const table = { ...fromPlugins.commands, ...(workbench?.runs ?? {}) };
  const gate = workbench?.gate ?? fromPlugins.gate ?? (manifest ? DEFAULT_GATE : null);
  return runCatalog(table, gate);
}

/** The run of an ID: a run of the list, or the gate run of its own. Null for another ID. */
export function runOf(catalog: RunCatalog, id: unknown): ProjectRun | null {
  if (typeof id !== "string") return null;
  return catalog.runs.find((run) => run.id === id) ?? (catalog.gate?.id === id ? catalog.gate : null);
}

/** The run of the review pack of a loop: the first run of the kind `review`, or null. */
export function reviewRun(catalog: RunCatalog): ProjectRun | null {
  return catalog.runs.find((run) => run.kind === "review") ?? null;
}

/** The runs that the agent tool `workbench_run` can start. */
export function agentRuns(catalog: RunCatalog): ProjectRun[] {
  return catalog.runs.filter((run) => run.agent);
}

/** The arguments that give a sequence to a run: the flag and the sequence, or the sequence alone. */
export function sequenceArgs(run: ProjectRun, sequence: string | null): string[] {
  if (sequence === null || run.sequence === null) return [];
  return run.sequence.flag === "" ? [sequence] : [run.sequence.flag, sequence];
}

/** True when a run can run for a sequence: it takes no sequence, or it gets one, or its sequence is optional. */
export function runsFor(run: ProjectRun, sequence: string | null): boolean {
  return sequence !== null || run.sequence?.required !== true;
}

/** The entry file of the `scenity` program (`@scenity/cli`). */
function cliEntry(): string {
  return join(dirname(fileURLToPath(import.meta.resolve("@scenity/cli"))), "cli.ts");
}

/**
 * The program and the first arguments of a command line: `bun` is the Bun of the host, and `scenity` is the CLI of
 * `@scenity/cli` under that Bun. Another program runs as it is (from the `PATH` of the run).
 */
export function programWords(line: string, bun: string): string[] {
  const [program = "", ...rest] = commandWords(line);
  if (program === "bun") return [bun, ...rest];
  if (program === "scenity") return [bun, cliEntry(), ...rest];
  return [program, ...rest];
}

/** The catalog of the open project, or null for the built-in catalog. */
let active: RunCatalog | null = null;
let builtIn: RunCatalog | null = null;

/** The catalog of the built-in plugins (a checkout of this repository with no manifest). */
export function builtInRunCatalog(): RunCatalog {
  builtIn ??= projectRunCatalog(builtInPlugins(), undefined, false);
  return builtIn;
}

/** Set the catalog of the open project (null: the built-in catalog). The host calls it when it opens a project. */
export function useRunCatalog(catalog: RunCatalog | null): void {
  active = catalog;
}

/** The catalog of the open project. */
export function activeRunCatalog(): RunCatalog {
  return active ?? builtInRunCatalog();
}
