// SPDX-License-Identifier: Apache-2.0
// Build the lab page of the editor once before the end-to-end tests.
import { LABS_DIST, LABS_ROOT } from "./builds";

export default async function globalSetup(): Promise<void> {
  const child = Bun.spawn(
    ["bunx", "--bun", "vite", "build", "--outDir", LABS_DIST, "--emptyOutDir", "--logLevel", "warn"],
    // Give the environment as the config set it, because Bun.spawn does not pass a changed `process.env` by itself.
    // Thus a config with a project outside this checkout (`SCENITY_PROJECT`) builds the lab with its plugin.
    { cwd: LABS_ROOT, stdout: "inherit", stderr: "inherit", env: { ...process.env } },
  );
  const code = await child.exited;
  if (code !== 0) throw new Error(`vite build to ${LABS_DIST} failed with code ${String(code)}`);
}
