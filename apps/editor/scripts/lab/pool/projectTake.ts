// SPDX-License-Identifier: Apache-2.0
/**
 * The default take of the render pool: the take of the warm pages at the start and of a job URL with no take. The
 * engine names no take. The editor config face of a project plugin gives it (`defaultTake`). With no default take,
 * the take is empty: the lab with no take.
 */
import { loadEditorProject } from "@scenity/cli/editor";
import { defaultProjectDir } from "@scenity/cli/plugins";

/** The default take of the project of `root`, or "" (no project, no default, or a project that does not load). */
export async function projectDefaultTake(
  root: string,
  log: (line: string) => void = () => undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const dir = defaultProjectDir(root, env);
  if (dir === null) return "";
  try {
    return (await loadEditorProject(dir, { env, root })).config.defaultTake ?? "";
  } catch (error) {
    log(`no default take: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}
