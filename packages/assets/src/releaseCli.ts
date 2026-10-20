// SPDX-License-Identifier: Apache-2.0
/**
 * The `release-check` command of the asset CLI: the release gate of a project folder. It exits with 0 when
 * the gate passes, with 1 when a finding is an error, and with 2 on a usage error or a project that does not read.
 */
import type { CliResult } from "./cli";
import { ProjectReadError } from "./database";
import { releaseCheck, type ReleaseReport } from "./release/project";
import type { ReleaseFinding } from "./release/gate";

export const RELEASE_USAGE = "bun packages/assets/src/cli.ts release-check <projectDir> [--json]";

/** One line of a finding. */
export function formatReleaseFinding(finding: ReleaseFinding): string {
  return `${finding.level} ${finding.check} ${finding.subject}: ${finding.message}`;
}

/** Run `release-check` with the arguments after the command name. */
export async function runReleaseCli(argv: readonly string[]): Promise<CliResult> {
  const json = argv.includes("--json");
  const [dir, extra] = argv.filter((arg) => arg !== "--json");
  if (dir === undefined || extra !== undefined) return { out: [`usage: ${RELEASE_USAGE}`], code: 2 };
  let report: ReleaseReport;
  try {
    report = await releaseCheck(dir);
  } catch (error) {
    if (error instanceof ProjectReadError) return { out: [error.message], code: 2 };
    throw error;
  }
  const code = report.passed ? 0 : 1;
  if (json) return { out: [JSON.stringify(report, null, 2)], code };
  const errors = report.findings.filter((finding) => finding.level === "error").length;
  const warnings = report.findings.length - errors;
  const out = report.findings.map(formatReleaseFinding);
  out.push(
    `release gate ${report.project}: ${String(report.assets)} assets, ${String(errors)} errors, ` +
      `${String(warnings)} warnings: ${report.passed ? "passed" : "failed"}`,
  );
  return { out, code };
}
