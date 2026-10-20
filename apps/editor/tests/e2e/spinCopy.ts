// SPDX-License-Identifier: Apache-2.0
/**
 * A copy of the spin sample in a temp folder (no `node_modules`, no `dist`). The host face of the demo plugin imports
 * `zod` (for its tools), so the copy gets a link to the `zod` package of the demo plugin of the sample.
 */
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABS_ROOT } from "./builds";

/** The spin sample of the repository. */
export const SPIN = join(LABS_ROOT, "../../samples/spin");

/** Copy the spin sample into a new temp folder (its name starts with `prefix`). The result is the folder. */
export function copySpin(prefix: string, into = mkdtempSync(join(tmpdir(), prefix))): string {
  cpSync(SPIN, into, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.endsWith("/dist") });
  const modules = join(into, "plugins", "demo", "node_modules");
  mkdirSync(modules, { recursive: true });
  symlinkSync(realpathSync(join(SPIN, "plugins", "demo", "node_modules", "zod")), join(modules, "zod"));
  return into;
}
