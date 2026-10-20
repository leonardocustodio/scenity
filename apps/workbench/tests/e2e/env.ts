// SPDX-License-Identifier: Apache-2.0
/**
 * The setup of the workbench end-to-end tests. The global setup writes it into the environment variable `E2E_ENV`,
 * and the workers read it.
 */
import type { HostEndpoint } from "@scenity/workbench-host/protocol";

export const E2E_ENV = "SCENITY_WORKBENCH_E2E";

/**
 * The variable of the saved lab URL: the query of the lab frame of the host. The project of a lab plugin sets it in
 * its Playwright config, for example with the take of its lab. With no value, the setup uses `DEFAULT_LAB_QUERY`.
 */
export const LAB_QUERY_ENV = "SCENITY_WORKBENCH_E2E_LAB";

/**
 * The variable of the checkout of the test host: an absolute folder. An example is the web workspace of another
 * repository that links the Scenity packages (a sub-folder of its Git repository). With no value, the checkout is this
 * repository.
 */
export const CHECKOUT_ENV = "SCENITY_WORKBENCH_E2E_CHECKOUT";

/** The saved lab URL with no take: 6 s, stopped, the render worker, the tier of `labs shot` and no adaptive quality. */
export const DEFAULT_LAB_QUERY = "?t=6000&paused=1&worker=1&tier=high&adaptive=0";

/** The saved lab URL of this run: the value of `LAB_QUERY_ENV`, else `DEFAULT_LAB_QUERY`. */
export function savedLabQuery(): string {
  return process.env[LAB_QUERY_ENV] ?? DEFAULT_LAB_QUERY;
}

export interface E2eSetup {
  /** The host in test mode. */
  readonly host: HostEndpoint;
  /** The origin of the Vite server of the workbench page. */
  readonly page: string;
  /** The checkout of the host (this repository, or the folder of `CHECKOUT_ENV`). */
  readonly checkout: string;
  /** The state folder of the host. */
  readonly state: string;
}

/** The setup of the run. Throw when the global setup did not run. */
export function e2eSetup(): E2eSetup {
  const text = process.env[E2E_ENV];
  if (text === undefined) throw new Error(`${E2E_ENV} is not set: run the tests with playwright.config.ts.`);
  return JSON.parse(text) as E2eSetup;
}
