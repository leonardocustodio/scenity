// SPDX-License-Identifier: Apache-2.0
/**
 * The check of the art of this repository: the repository holds only free art.
 *
 * Run from the repo root:
 *     bun tools/restricted-art.ts      # exit 1 on a problem (CI step "restricted art")
 *
 * The check fails:
 * - on a rights record (a YAML file with a `licence` field) whose licence is not free: the SPDX ID is not one of
 *   FREE_SPDX, or a record with no SPDX ID has a licence text that is not CC0 or CC BY;
 * - on a rights record with no licence.
 *
 * The check reads every YAML file of the repository, except the folders of GONE (third-party packages, builds, test
 * results and the local state of the tools).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The SPDX IDs of the free licences (the free art of the samples: CC0 1.0 and CC BY 3.0 or 4.0). */
export const FREE_SPDX: readonly string[] = ["CC0-1.0", "CC-BY-3.0", "CC-BY-4.0"];

/** The licence texts of the free licences, for a record with no SPDX ID. */
const FREE_TEXT = [
  /\bCC0\b/i,
  /public domain dedication/i,
  /\bCC[ -]BY [34]\.0\b/i,
  /Creative Commons Attribution [34]\.0/i,
];

/** The folders that the check never reads. */
const GONE = new Set([
  "node_modules",
  ".git",
  ".scenity",
  ".turbo",
  "dist",
  "dist-scene",
  "test-results",
  "playwright-report",
]);

/** The value of a top-level field of a YAML text (one line, quotes and a line comment removed), or null. */
export function field(text: string, name: string): string | null {
  const line = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(text)?.[1];
  if (line === undefined) return null;
  const value = line.replace(/\s+#.*$/, "").trim();
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

/** The problem of one rights record, or null for a record of a free licence. */
export function recordProblem(path: string, text: string): string | null {
  const licence = field(text, "licence");
  if (licence === null || licence === "" || licence === "null") return `${path}: a rights record with no licence`;
  const spdx = field(text, "spdx");
  if (spdx !== null && spdx !== "" && spdx !== "null") {
    return FREE_SPDX.includes(spdx) ? null : `${path}: the licence ${spdx} is not free (${FREE_SPDX.join(", ")})`;
  }
  return FREE_TEXT.some((pattern) => pattern.test(licence))
    ? null
    : `${path}: the licence "${licence}" is not free (give a free SPDX ID: ${FREE_SPDX.join(", ")})`;
}

/** The YAML files under a folder, as absolute paths. */
function yamlFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!GONE.has(entry.name)) yamlFiles(join(dir, entry.name), out);
    } else if (/\.ya?ml$/.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

/** The problems of the art of a repository at `root`. */
export function artProblems(root: string): string[] {
  const problems: string[] = [];
  for (const file of yamlFiles(root)) {
    const text = readFileSync(file, "utf8");
    if (field(text, "licence") === null) continue;
    const problem = recordProblem(relative(root, file), text);
    if (problem !== null) problems.push(problem);
  }
  return problems;
}

if (import.meta.main) {
  const problems = artProblems(join(import.meta.dir, ".."));
  for (const problem of problems) console.error(`restricted-art: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("restricted-art: only free art (the rights records have free licences)");
}
