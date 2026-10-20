// SPDX-License-Identifier: Apache-2.0
// The release of the public packages.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importProblems, packageName } from "./release-imports";
import {
  checkManifests,
  covered,
  localRanges,
  publicPackages,
  publishedManifest,
  releaseOrder,
  tarballName,
  tarballProblems,
  targetsOf,
  type WorkspacePackage,
} from "./release";

test("the manifests of the public packages and the fixed group of Changesets pass the check", () => {
  expect(checkManifests()).toEqual([]);
});

test("the public packages are the engine packages, the command and the editor; the rest stays private", () => {
  const dirs = publicPackages().map((pkg) => pkg.dir);
  expect(dirs).toContain("packages/cli");
  expect(dirs).toContain("packages/player");
  // The editor app is a package (the scene page of `scenity dev`). The workbench stays in the checkout.
  expect(dirs.filter((dir) => !dir.startsWith("packages/"))).toEqual(["apps/editor"]);
  expect(dirs).not.toContain("packages/workbench-host");
});

test("the published exports of the editor leave out its tests, its lab tools and its Playwright configs", () => {
  const editor = publicPackages().find((pkg) => pkg.dir === "apps/editor");
  const exports = Object.keys(publishedManifest(editor?.manifest ?? {}).exports ?? {});
  expect(exports).toContain("./vite.scene.config");
  expect(exports.filter((key) => /tests|scripts|playwright|\.\/vite\.config/.test(key))).toEqual([]);
  expect(publishedManifest({ exports: { a: "1" }, publishConfig: { access: "public" } }).exports).toEqual({ a: "1" });
  expect(publishedManifest({ exports: { a: "1" }, publishConfig: { access: "public", exports: { b: "2" } } })).toEqual({
    exports: { b: "2" },
    publishConfig: { access: "public" },
  });
});

test("releaseOrder puts each dependency before the packages that use it", () => {
  const pkg = (name: string, dependencies: Record<string, string> = {}): WorkspacePackage => ({
    dir: name,
    manifest: { name, version: "1.0.0", dependencies },
  });
  const order = releaseOrder([
    pkg("@x/cli", { "@x/runtime": "workspace:*", "@x/scene": "workspace:*" }),
    pkg("@x/runtime", { "@x/scene": "workspace:*" }),
    pkg("@x/scene", { zod: "4.0.0" }),
  ]).map((item) => item.manifest.name);
  expect(order).toEqual(["@x/scene", "@x/runtime", "@x/cli"]);
  expect(() => releaseOrder([pkg("@x/a", { "@x/b": "1" }), pkg("@x/b", { "@x/a": "1" })])).toThrow(/cycle/);
});

test("localRanges finds the ranges that only a workspace can read", () => {
  const manifest = {
    dependencies: { a: "workspace:*", b: "1.2.3", c: "catalog:" },
    devDependencies: { d: "link:d", e: "^2.0.0" },
  };
  expect(localRanges(manifest)).toEqual([
    "dependencies.a: workspace:*",
    "dependencies.c: catalog:",
    "devDependencies.d: link:d",
  ]);
});

test("covered and targetsOf read the exports, the bin and the files fields", () => {
  expect(targetsOf({ ".": "./src/index.ts", "./x": { types: "./src/x.d.ts", default: "./src/x.ts" } })).toEqual([
    "./src/index.ts",
    "./src/x.d.ts",
    "./src/x.ts",
  ]);
  expect(covered("./src/a/b.ts", ["src"])).toBe(true);
  expect(covered("./tests/cases.ts", ["src", "tests/cases.ts"])).toBe(true);
  expect(covered("./blender/export.py", ["blender/*.py"])).toBe(true);
  expect(covered("./tests/other.ts", ["src", "tests/cases.ts"])).toBe(false);
  expect(covered("./srcx/a.ts", ["src"])).toBe(false);
});

test("tarballProblems reports a workspace range, a missing export file and a missing NOTICE", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "index.ts"), "");
    writeFileSync(join(dir, "LICENSE"), "");
    const manifest = { exports: { ".": "./src/index.ts", "./css": "./dist/x.css" }, dependencies: { a: "catalog:" } };
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    expect(tarballProblems(dir, "@x/a")).toEqual([
      "@x/a: dependencies.a: catalog:",
      "@x/a: no file ./dist/x.css",
      "@x/a: no NOTICE",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importProblems finds a path out of the package, a file not in the tarball and an undeclared package", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-imports-"));
  try {
    mkdirSync(join(dir, "src"));
    const manifest = { name: "@x/a", dependencies: { "@x/b": "1.0.0" }, peerDependencies: { vite: "^8.0.0" } };
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "src", "ok.ts"), "export const ok = 1;\n");
    const code = [
      'import { ok } from "./ok";',
      'import type { T } from "@x/types";',
      'import { b } from "@x/b/part";',
      'import { a } from "@x/a/self";',
      'import { readFileSync } from "node:fs";',
      'import { createServer } from "vite";',
      'import { gone } from "./gone";',
      'import { far } from "../../../packages/other/src/far.ts";',
      'import { c } from "@x/c";',
      "const text = \"import { d } from '@x/d'\";",
      "export { ok, b, a, readFileSync, createServer, gone, far, c, text };",
      "export type { T };",
    ].join("\n");
    writeFileSync(join(dir, "src", "main.ts"), code);
    writeFileSync(
      join(dir, "src", "View.vue"),
      '<template><p /></template>\n<script setup lang="ts">\nimport "@x/e";\n</script>\n',
    );
    expect(importProblems(dir, "@x/a")).toEqual([
      "@x/a: src/View.vue imports @x/e, which the manifest does not declare",
      "@x/a: src/main.ts imports src/gone, which is not in the tarball",
      "@x/a: src/main.ts imports ../../../packages/other/src/far.ts outside the package",
      "@x/a: src/main.ts imports @x/c, which the manifest does not declare",
    ]);
    expect(packageName("@x/b/part")).toBe("@x/b");
    expect(packageName("three/examples/jsm/x.js")).toBe("three");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tarballName gives the file name of Changesets", () => {
  expect(tarballName("@scenity/runtime-dev", "0.1.0")).toBe("scenity-runtime-dev-0.1.0.tgz");
});
