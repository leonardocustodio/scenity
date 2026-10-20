// SPDX-License-Identifier: Apache-2.0
/**
 * The buttons of the Runs tab from the runs of the project. Each preset of a run is a
 * button, a button with a sequence field, or a button that asks the owner first. The host gives the runs with
 * `runs.commands` (the manifest runs and the runs of the host plugins).
 */
import type { ProjectRun, ProjectRunPreset } from "@scenity/workbench-host/protocol";

/** One preset of a run, with a key that is unique in the tab. */
export interface RunButton {
  readonly key: string;
  readonly run: ProjectRun;
  readonly preset: ProjectRunPreset;
}

/** The buttons of the tab by their form. */
export interface RunButtons {
  /** The buttons with a sequence field (the field text goes in front of the arguments). */
  readonly sequence: readonly RunButton[];
  /** The plain buttons. */
  readonly plain: readonly RunButton[];
  /** The buttons that ask the owner first; then the run starts as a confirmed run. */
  readonly confirm: readonly RunButton[];
}

/** The buttons of the presets of the runs, in the order of the runs. */
export function runButtons(runs: readonly ProjectRun[]): RunButtons {
  const all = runs.flatMap((run) =>
    run.presets.map((preset, index): RunButton => ({ key: `${run.id}:${String(index)}`, run, preset })),
  );
  return {
    sequence: all.filter((item) => item.preset.sequence !== undefined),
    plain: all.filter((item) => item.preset.sequence === undefined && item.preset.confirm === undefined),
    confirm: all.filter((item) => item.preset.sequence === undefined && item.preset.confirm !== undefined),
  };
}

/** The words of a text field. */
export function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/** The arguments of a button: the words of its sequence field, then the arguments of its preset. */
export function buttonArgs(item: RunButton, sequence = ""): string[] {
  return [...words(sequence), ...(item.preset.args ?? [])];
}
