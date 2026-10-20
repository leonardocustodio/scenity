// SPDX-License-Identifier: Apache-2.0
/**
 * The preload of the host tests. After every test file of the run, `checkHygiene` removes the temporary folders that
 * a test left. It fails the run when a host process of the run is still alive. The bunfig.toml of the repo root loads
 * it for `bun test ./packages/...`. The `test` script of the package gives `--preload`.
 */
import { afterAll } from "bun:test";
import { checkHygiene } from "./hygiene";

afterAll(async () => {
  await checkHygiene();
}, 30_000);
