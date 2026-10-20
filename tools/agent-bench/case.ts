// SPDX-License-Identifier: Apache-2.0
/** The shape of a case of the agent benchmark. */
import type { CheckResult } from "./checks";
import type { BenchProject, SceneDoc } from "./project";

export type Category = "placement" | "look" | "time" | "assets" | "rules" | "code" | "project";

/** What a check gets: the project after the run, the first scene before the run and the last text of the agent. */
export interface CheckContext {
  readonly before: SceneDoc;
  readonly answer: string;
}

export interface BenchCase {
  readonly id: string;
  readonly category: Category;
  readonly sample: string;
  /** The task, in the words of a person. */
  readonly prompt: string;
  /** Changes before the run, for a case that starts from a broken state. */
  readonly setup?: (project: BenchProject) => void;
  readonly check: (project: BenchProject, context: CheckContext) => CheckResult;
  /** A right answer for the tests of the checks: after it, the check passes. No value: the tests skip the case. */
  readonly solve?: (project: BenchProject) => void;
}
