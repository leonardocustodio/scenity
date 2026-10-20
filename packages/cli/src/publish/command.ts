// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity publish`: the release gate of the assets first (`assets release-check`), then the build folder
 * as a ZIP archive:
 *
 *   scenity publish [project] [--dist <dir>] [--out <file.zip>] [--json]
 *
 * A failed release gate stops the publish and gives its reasons; the exit code is then 1. With no build folder, the
 * command also stops (run `scenity build` first). The default archive is `<project>/test-results/publish/<id>.zip`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readArgs, type CommandResult } from "../args";
import { readBuildProject } from "../build/run";
import { commandProjectDir, CommandSetupError } from "../workspace";
import { folderEntries, zipBytes } from "./zip";

export const PUBLISH_USAGE = "scenity publish [project] [--dist <dir>] [--out <file.zip>] [--json]";
export const PUBLISH_HELP = [
  `usage: ${PUBLISH_USAGE}`,
  "The release gate of the assets (assets release-check), then the build folder (default <project>/dist) as a ZIP",
  "archive (default <project>/test-results/publish/<project id>.zip). A failed gate stops the publish with its reasons.",
];

/** The result of a publish. */
export interface PublishReport {
  readonly project: string;
  readonly passed: boolean;
  /** The reasons of the release gate that stop the publish (each error finding). */
  readonly reasons: readonly string[];
  readonly archive: string | null;
  readonly files: number;
  readonly bytes: number;
}

/** Run `scenity publish` with the arguments after the word `publish`. */
export async function runPublishCommand(argv: readonly string[]): Promise<CommandResult> {
  const args = readArgs(argv, ["--dist", "--out"], ["--json"]);
  if (args === null || args.plain.length > 1) return { out: [`usage: ${PUBLISH_USAGE}`], code: 2 };
  let dir: string;
  try {
    dir = commandProjectDir(args.plain[0]);
  } catch (error) {
    if (error instanceof CommandSetupError) return { out: [error.message], code: 1 };
    throw error;
  }
  const project = readBuildProject(dir);
  const { releaseCheck } = await import("@scenity/assets/release");
  const gate = await releaseCheck(dir);
  const reasons = gate.findings.filter((finding) => finding.level === "error").map((finding) => finding.message);
  const dist = resolve(dir, args.values.dist ?? "dist");
  const report = (fields: Partial<PublishReport>): PublishReport => ({
    ...{ project: project.id, passed: false, reasons, archive: null, files: 0, bytes: 0 },
    ...fields,
  });
  let result: PublishReport;
  if (!gate.passed) result = report({});
  else if (!existsSync(join(dist, "index.html"))) {
    result = report({ reasons: [`no build in ${dist}: run scenity build first`] });
  } else {
    const archive = resolve(dir, args.values.out ?? join("test-results", "publish", `${project.id}.zip`));
    const entries = folderEntries(dist);
    const bytes = zipBytes(entries);
    mkdirSync(dirname(archive), { recursive: true });
    writeFileSync(archive, bytes);
    result = report({ passed: true, archive, files: entries.length, bytes: bytes.byteLength });
  }
  if (args.flags.has("--json")) return { out: [JSON.stringify(result, null, 2)], code: result.passed ? 0 : 1 };
  const out = result.passed
    ? [`scenity publish: ${String(result.files)} files, ${String(result.bytes)} bytes → ${result.archive ?? ""}`]
    : ["scenity publish: stopped", ...result.reasons.map((reason) => `  ${reason}`)];
  return { out, code: result.passed ? 0 : 1 };
}
