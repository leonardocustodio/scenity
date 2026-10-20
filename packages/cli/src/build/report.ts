// SPDX-License-Identifier: Apache-2.0
/**
 * The build report of `scenity build`: `build-report.json` in the build folder and the text lines of the command. The
 * report has the entries with their gzip sizes and budgets, the result of the marker gate, the asset step, the
 * documents and each file of the build. It holds no time, so the same build gives the same report.
 */
import type { AssetMode } from "./assets";
import type { MarkerGate } from "./markers";
import { formatKB, KB, type MeasureResult } from "./sizes";

export const REPORT_FILE = "build-report.json";
export const REPORT_FORMAT = "scenity.build-report/1";

/** One entry of the report. `limitKB` is null for an entry with no budget. */
export interface ReportEntry {
  readonly id: string;
  readonly label: string;
  readonly gzip: number;
  readonly raw: number;
  readonly limitKB: number | null;
  readonly result: MeasureResult | "no budget";
  readonly files: readonly string[];
}

/** One file of the build, relative to the build folder. */
export interface ReportFile {
  readonly path: string;
  readonly bytes: number;
  readonly gzip: number;
}

export interface BuildReport {
  readonly format: typeof REPORT_FORMAT;
  readonly project: string;
  readonly passed: boolean;
  readonly entries: readonly ReportEntry[];
  readonly markers: {
    readonly found: readonly { readonly id: string; readonly what: string; readonly files: readonly string[] }[];
    readonly modules: readonly { readonly id: string; readonly file: string; readonly source: string }[];
    readonly info: readonly string[];
  };
  readonly assets: { readonly mode: AssetMode; readonly files: number; readonly bytes: number };
  readonly documents: readonly string[];
  readonly files: readonly ReportFile[];
  readonly problems: readonly string[];
}

/** The marker part of the report. */
export function reportMarkers(gate: MarkerGate): BuildReport["markers"] {
  return {
    found: gate.found.map((item) => ({ id: item.marker.id, what: item.marker.what, files: item.files })),
    modules: gate.modules.map((item) => ({ id: item.module.id, file: item.file, source: item.source })),
    info: gate.info.map((item) => item.marker.id),
  };
}

/** The text lines of a report. */
export function reportLines(report: BuildReport, out: string): string[] {
  const lines = [`scenity build: ${report.project} → ${out}`];
  lines.push(
    "Entry                                                     gzip-9      limit       raw         files  result",
  );
  for (const entry of report.entries) {
    lines.push(
      [
        entry.label.padEnd(57),
        formatKB(entry.gzip).padEnd(11),
        (entry.limitKB === null ? "-" : formatKB(entry.limitKB * KB)).padEnd(11),
        formatKB(entry.raw).padEnd(11),
        String(entry.files.length).padEnd(6),
        entry.result === "exceeded" ? "EXCEEDED" : entry.result,
      ].join(" "),
    );
  }
  const { found, modules, info } = report.markers;
  lines.push(
    found.length === 0 && modules.length === 0
      ? `markers: no dev or lab code in the build (${String(info.length)} info markers)`
      : `markers: ${String(found.length)} dev or lab markers and ${String(modules.length)} dev modules in the build`,
  );
  for (const item of found) lines.push(`  ${item.id.padEnd(22)} ${item.what}: ${item.files.join(", ")}`);
  for (const item of modules) lines.push(`  ${item.id.padEnd(22)} ${item.file}: ${item.source}`);
  const assetBytes = formatKB(report.assets.bytes);
  lines.push(`assets: ${String(report.assets.files)} files, ${assetBytes} (${report.assets.mode})`);
  lines.push(`documents: ${String(report.documents.length)}; files: ${String(report.files.length)}`);
  for (const problem of report.problems) lines.push(`problem: ${problem}`);
  lines.push(report.passed ? "scenity build: passed" : "scenity build: FAILED");
  return lines;
}
