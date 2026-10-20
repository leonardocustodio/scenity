// SPDX-License-Identifier: Apache-2.0
/**
 * The program of the CLI tests (main.test.ts, lifecycle.test.ts): `bun src/main.ts`, or a compiled host when
 * `SCENITY_WORKBENCH_HOST_BIN` names it (`bun build --compile` of main.ts):
 *
 *     SCENITY_WORKBENCH_HOST_BIN=<binary> bun test ./packages/workbench-host/tests/main.test.ts
 */
import { join } from "node:path";
import { envValue } from "@scenity/labs-platform/envNames";

/** The source file of the command line. */
export const MAIN = join(import.meta.dir, "..", "src", "main.ts");

/** The environment variable that names a compiled host for the CLI tests. */
export const HOST_BIN_ENV = "SCENITY_WORKBENCH_HOST_BIN";

/** The command of the host: the compiled binary, or `bun src/main.ts`. */
export function hostProgram(): string[] {
  const binary = envValue(HOST_BIN_ENV);
  return binary === undefined || binary === "" ? [process.execPath, MAIN] : [binary];
}
