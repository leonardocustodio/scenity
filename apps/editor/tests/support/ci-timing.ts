// SPDX-License-Identifier: Apache-2.0
/**
 * Time budgets of the browser tests on a CI runner. This file is a copy of the CI timings of the CodeBlue learner
 * app.
 *
 * A latency or render target (for example 50 ms to a duck, 3 ms of render work per frame) holds locally and on the
 * reference devices. A CI runner shares a few CPUs between the browser, its audio thread and the mock engine, and it
 * has no GPU (WebGL runs in software). Thus with `CI=true`:
 *
 * - a timing check allows CI_TIMING_FACTOR times the target and records the measured value;
 * - a wait (a test timeout, an expect timeout, the wait for the 3D assets) is CI_WAIT_FACTOR times as long.
 *
 * The workflow sets the factors for its runners: SCENITY_CI_TIMING_FACTOR (default 1.5, a hosted runner with two
 * CPUs) and SCENITY_CI_WAIT_FACTOR (default 1). A missing event fails at every budget.
 */
import type { TestInfo } from "@playwright/test";
import { envValue } from "@scenity/labs-platform/envNames";

function factor(name: string, fallback: number): number {
  const value = Number(envValue(name));
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

/** The factor of the latency and render budgets on a CI runner (SCENITY_CI_TIMING_FACTOR, default 1.5). */
export const CI_TIMING_FACTOR = factor("SCENITY_CI_TIMING_FACTOR", 1.5);

/** The factor of the waits on a CI runner (SCENITY_CI_WAIT_FACTOR, default 1). */
export const CI_WAIT_FACTOR = factor("SCENITY_CI_WAIT_FACTOR", 1);

/** True on a CI runner. */
export function onCi(): boolean {
  return process.env.CI === "true";
}

/** Return the time budget of a timing check, and record it as an annotation on a CI runner. */
export function timingBudgetMs(targetMs: number, testInfo: TestInfo): number {
  if (!onCi()) return targetMs;
  const budget = targetMs * CI_TIMING_FACTOR;
  testInfo.annotations.push({
    type: "ci-timing",
    description: `CI runner: budget ${String(budget)} ms for the ${String(targetMs)} ms target`,
  });
  return budget;
}

/** Return a wait (a timeout) for the runner: CI_WAIT_FACTOR times `ms` on a CI runner, else `ms`. */
export function ciWaitMs(ms: number): number {
  return onCi() ? Math.round(ms * CI_WAIT_FACTOR) : ms;
}

/** The count of Playwright workers on a CI runner (SCENITY_CI_PLAYWRIGHT_WORKERS), or undefined for the default. */
export function ciWorkers(): number | undefined {
  const value = Number(envValue("SCENITY_CI_PLAYWRIGHT_WORKERS"));
  return onCi() && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** The workers option of a Playwright config on a CI runner, else no option (exact optional properties). */
export function ciWorkerOption(): { workers: number } | Record<string, never> {
  const workers = ciWorkers();
  return workers === undefined ? {} : { workers };
}
