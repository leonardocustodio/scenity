// SPDX-License-Identifier: Apache-2.0
// The module report of `bun run check:size --why room3d`: each output folder has its own report, so a build into
// another folder does not replace the report of `dist`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readModuleReport,
  recordChunks,
  reportFileFor,
  whyEntries,
  writeModuleReport,
  type BundleChunk,
  type ModuleReport,
} from "./moduleReport";

let roots: string[] = [];

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "module-report-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A bundle of the plugin hooks: one chunk with modules, and one asset. */
function bundle(chunk: string): Record<string, BundleChunk> {
  return {
    [chunk]: {
      type: "chunk",
      fileName: chunk,
      modules: {
        "/x/node_modules/three/build/three.core.js": { renderedLength: 300 },
        "\0rolldown/runtime.js": { renderedLength: 100 },
      },
    },
    "assets/a.png": { type: "asset", fileName: "assets/a.png" },
  };
}

describe("module report", () => {
  test("gives each output folder its own report file", () => {
    const reports = folder();
    const dist = join(folder(), "dist");
    const other = join(folder(), "dist");
    mkdirSync(dist);
    expect(reportFileFor(dist, reports)).toBe(reportFileFor(`${dist}/`, reports));
    expect(reportFileFor(dist, reports)).not.toBe(reportFileFor(other, reports));
    expect(reportFileFor(dist, reports).startsWith(join(reports, "dist-"))).toBe(true);
  });

  test("records the chunks and not the assets", () => {
    const report: ModuleReport = {};
    recordChunks(report, bundle("assets/room3dCore-A.js"));
    expect(report).toEqual({
      "assets/room3dCore-A.js": { "three/build/three.core.js": 300, "rolldown/runtime.js": 100 },
    });
  });

  test("reads the report of dist after a build into another folder", () => {
    const reports = folder();
    const dist = folder();
    const other = folder();
    writeModuleReport(dist, { "assets/room3dCore-A.js": { a: 1 } }, reports);
    writeModuleReport(other, { "assets/room3dCore-B.js": { a: 1 } }, reports);
    expect(readModuleReport(dist, reports)).toEqual({ "assets/room3dCore-A.js": { a: 1 } });
    expect(readModuleReport(folder(), reports)).toBeNull();
  });

  test("gives the modules of the build, and fails on a report without the chunks of dist", () => {
    const reports = folder();
    const dist = folder();
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "room3dWorker-A.js"), "const a = 1;".repeat(50));
    const files: [string, string[]][] = [
      ["render worker", ["assets/room3dWorker-A.js"]],
      ["main-thread core", []],
    ];

    expect(whyEntries(dist, files, reports).ok).toBe(false);
    const report: ModuleReport = {};
    recordChunks(report, bundle("assets/room3dWorker-A.js"));
    writeModuleReport(dist, report, reports);
    const why = whyEntries(dist, files, reports);
    expect(why.ok).toBe(true);
    expect(why.text).toContain("render worker:");
    expect(why.text).toContain("three/build/three.core.js");

    // A later build in dist with other chunk names, and the report of an older build.
    writeModuleReport(dist, { "assets/room3dWorker-B.js": { a: 1 } }, reports);
    const stale = whyEntries(dist, files, reports);
    expect(stale.ok).toBe(false);
    expect(stale.text).toContain("assets/room3dWorker-A.js");
  });
});
