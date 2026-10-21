// SPDX-License-Identifier: Apache-2.0
/**
 * The waits of the host tests on a CI runner. A Linux runner of CI is slower than the
 * development Mac when a test starts processes (Bun, Git, a fake dev server). With `CI=true`, a wait is
 * SCENITY_CI_WAIT_FACTOR times as long, as in the browser tests (apps/editor/tests/support/ci-timing.ts). On the
 * Mac the waits do not change.
 */
import { setDefaultTimeout } from "bun:test";

/** The factor of the waits on a CI runner (SCENITY_CI_WAIT_FACTOR, default 1; 3 in the CI workflow). */
function waitFactor(): number {
  const value = Number(process.env.SCENITY_CI_WAIT_FACTOR);
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

/** A wait (a timeout) for the runner: the factor times `ms` on a CI runner, else `ms`. */
export function ciWaitMs(ms: number): number {
  return process.env.CI === "true" ? Math.round(ms * waitFactor()) : ms;
}

/**
 * Set the default timeout of the tests of the calling file (5 s, times the CI factor). Bun keeps the default per
 * file, so each test file calls this once after its imports.
 */
export function scaleTestTimeouts(): void {
  setDefaultTimeout(ciWaitMs(5000));
}
