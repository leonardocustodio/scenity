// SPDX-License-Identifier: Apache-2.0
/**
 * The lab fixture of the host tests: a test file calls `useLabFixture()` at its top
 * level, so the built-in project of the host is the fixture project with a lab (fixtures/labProject: the lab surface,
 * the `labs` runs, the stop gate and the two editor tool aliases). A host that the file starts as a child process
 * gets the same project through the environment. The variable gets its old value again after the file.
 */
import { afterAll } from "bun:test";
import { join } from "node:path";

/** The fixture project with a lab. */
export const LAB_FIXTURE = join(import.meta.dir, "fixtures", "labProject");

/** Make the lab fixture the built-in project of the host for the rest of this test file. */
export function useLabFixture(): void {
  const before = process.env.SCENITY_PROJECT;
  process.env.SCENITY_PROJECT = LAB_FIXTURE;
  afterAll(() => {
    if (before === undefined) delete process.env.SCENITY_PROJECT;
    else process.env.SCENITY_PROJECT = before;
  });
}
