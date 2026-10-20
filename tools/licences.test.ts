// SPDX-License-Identifier: Apache-2.0
// The licence check.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowed, licenceOf, packageFiles, problems, ROOT } from "./licences";

test("licenceOf reads the SPDX field and the old forms", () => {
  expect(licenceOf({ license: "MIT" })).toBe("MIT");
  expect(licenceOf({ license: { type: "ISC" } })).toBe("ISC");
  expect(licenceOf({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("MIT OR Apache-2.0");
  expect(licenceOf({})).toBe("UNKNOWN");
});

test("allowed accepts an allowed alternative and refuses a copyleft licence", () => {
  expect(allowed("(MIT OR CC0-1.0)")).toBe(true);
  expect(allowed("MIT AND Apache-2.0")).toBe(true);
  expect(allowed("GPL-3.0-only")).toBe(false);
  expect(allowed("UNKNOWN")).toBe(false);
});

test("the installed packages and NOTICE pass the check", () => {
  expect(problems()).toEqual([]);
});

test("packageFiles finds the plugin parts and the packages of a group folder of a plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "licences-"));
  try {
    for (const path of ["demo/room", "demo/sdk/vue", "demo/sdk/vue/node_modules/x", "demo/room/node_modules/y"]) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, "package.json"), "{}");
    }
    expect(packageFiles(root).sort()).toEqual([
      join(root, "demo/room/package.json"),
      join(root, "demo/sdk/vue/package.json"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  expect(packageFiles(join(ROOT, "plugins")).some((path) => path.includes("node_modules"))).toBe(false);
});
