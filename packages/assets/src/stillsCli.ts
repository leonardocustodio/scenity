// SPDX-License-Identifier: Apache-2.0
/**
 * The `stills` command of the asset CLI. Run from the repo root:
 *
 *   bun packages/assets/src/cli.ts stills <projectDir> [--check] [--json]
 *
 * The command lists the still of each asset of the project (stills/plan.ts) with its state: current, missing or
 * stale. It reads only files: the editor draws the stills (STILLS_MAKE). This check does not know the renderer
 * version; the make command of the editor also compares it. `--check` exits with 1 when a still is not current.
 * A usage error or a project that does not read exits with 2.
 */
import { ProjectReadError } from "./database";
import { planStills, type StillsPlan } from "./stills/plan";

export const STILLS_USAGE = "bun packages/assets/src/cli.ts stills <projectDir> [--check] [--json]";

/** The command that draws the stills of a project (the renderer of the editor). */
export const STILLS_MAKE = "bun apps/editor/scripts/stills/assetStills.ts";

const FLAGS = new Set(["--check", "--json"]);

/** Run the stills command with its arguments (after the word `stills`). */
export async function runStillsCli(argv: readonly string[]): Promise<{ out: string[]; code: number }> {
  const plain = argv.filter((arg) => !FLAGS.has(arg));
  const [dir] = plain;
  if (dir === undefined || plain.length > 1 || plain.some((arg) => arg.startsWith("--"))) {
    return { out: [`usage: ${STILLS_USAGE}`], code: 2 };
  }
  let plan: StillsPlan;
  try {
    plan = await planStills(dir);
  } catch (error) {
    if (error instanceof ProjectReadError) return { out: [error.message], code: 2 };
    throw error;
  }
  const open = plan.jobs.filter((job) => job.status !== "current");
  const code = argv.includes("--check") && open.length > 0 ? 1 : 0;
  if (argv.includes("--json")) return { out: [JSON.stringify(plan, null, 2)], code };
  const out = plan.jobs.map((job) => {
    const reason = [job.reason, job.problem].filter((text) => text !== null).join("; ");
    return `${job.id}  ${job.kind.padEnd(13)} ${job.status.padEnd(8)} ${job.still}${reason === "" ? "" : `  ${reason}`}`;
  });
  for (const path of plan.extra) out.push(`${path}: no asset has this ID; the make command removes it`);
  const count = (status: string): string => String(plan.jobs.filter((job) => job.status === status).length);
  out.push(
    `${String(plan.jobs.length)} stills: ${count("current")} current, ${count("missing")} missing, ${count("stale")} stale`,
  );
  if (open.length > 0) out.push(`make them: ${STILLS_MAKE} ${dir}`);
  return { out, code };
}
