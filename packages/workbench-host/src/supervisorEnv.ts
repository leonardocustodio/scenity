// SPDX-License-Identifier: Apache-2.0
/**
 * The environment switches of the supervisor of the host (supervisor.ts). A module of
 * its own, so servers.ts can remove them from the environment of a child without an import of the supervisor.
 */

/** Set to "1" in the environment of the worker: main.ts then runs the host itself, not a supervisor. */
export const WORKER_ENV = "SCENITY_WORKBENCH_WORKER";
/** Set to "1" in the environment of a worker that a supervisor watches: then `host.restart` works. */
export const SUPERVISED_ENV = "SCENITY_WORKBENCH_SUPERVISED";
