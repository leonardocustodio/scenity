// SPDX-License-Identifier: Apache-2.0
/** The 24 cases of the agent benchmark v1. */
import type { BenchCase } from "./case";
import { ASSET_CASES, CODE_CASES, PROJECT_CASES, RULE_CASES, TIME_CASES } from "./cases-more";
import { LOOK_CASES, PLACEMENT_CASES } from "./cases-scene";

export const CASES: readonly BenchCase[] = [
  ...PLACEMENT_CASES,
  ...LOOK_CASES,
  ...TIME_CASES,
  ...ASSET_CASES,
  ...RULE_CASES,
  ...CODE_CASES,
  ...PROJECT_CASES,
];
