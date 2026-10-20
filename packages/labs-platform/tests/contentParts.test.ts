// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the parts of the content hash: the scan of a source file, the family parts of small trees, the cases that
 * disable every part, the changed families of two snapshots and the carry of a frame. In a small tree, a file that
 * only the registry reaches is in the part of its families. Every other file is shared.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ContentHasher, fsContentReader } from "../src/contentHash";
import {
  carries,
  changedFamilies,
  familyParts,
  familyRegistry,
  globFolder,
  scanSource,
  type ContentSnapshot,
  type FamilyConfig,
} from "../src/contentParts";

/** The pose families of a plugin (the config of its frame index source). */
const FAMILIES: FamilyConfig = { dir: "game/room/src/model/families/", registryName: "FAMILY_POSES" };
const F = FAMILIES.dir;
const FAMILY_REGISTRY = familyRegistry(FAMILIES);
const POSE = "game/room/src/model/pose.ts";

const REGISTRY = [
  'import type { ClipFamily } from "../clips";',
  'import { accessPose } from "./access";',
  'import { wavePose } from "./wave";',
  'import { idlePose } from "./idle";',
  'import type { FamilyPose } from "./kit";',
  'import { withCuff } from "./cuff";',
  "",
  "/** The pose function of each clip family. */",
  "export const FAMILY_POSES: Readonly<Record<ClipFamily, FamilyPose>> = {",
  "  access: accessPose,",
  "  wave: withCuff(wavePose),",
  "  idle: idlePose,",
  "};",
  "",
].join("\n");

/** A small tree: the shared pose module imports the registry and the kit; the families import the kit. */
function tree(): Record<string, string> {
  return {
    [POSE]: 'import { FAMILY_POSES } from "./families";\nimport { REST } from "./families/kit";\nexport const P = 1;\n',
    [FAMILY_REGISTRY]: REGISTRY,
    [`${F}kit.ts`]: "export const REST = 0;\n",
    [`${F}access.ts`]:
      'import { REST } from "./kit";\nimport { armPose } from "./accessArm";\nexport const accessPose = armPose;\n',
    [`${F}accessArm.ts`]: [
      'import { tunable } from "../tuning";',
      'const ARM = tunable("pose.arm", { reach: 0.4 });',
      "export function armPose(): number {",
      "  return ARM.reach;",
      "}",
      "",
    ].join("\n"),
    [`${F}wave.ts`]:
      'import { cuffShare } from "./cuff";\nexport function wavePose(): number {\n  return cuffShare();\n}\n',
    [`${F}cuff.ts`]: "export const cuffShare = (): number => 1;\nexport const withCuff = <T>(pose: T): T => pose;\n",
    [`${F}idle.ts`]: "export function idlePose(): number {\n  return 0;\n}\n",
    "game/room/src/model/tuning.ts": "export function tunable<T>(key: string, value: T): T {\n  return value;\n}\n",
  };
}

function partsOf(files: Record<string, string>) {
  const scanned = Object.entries(files).map(([path, text]) => ({
    path,
    scan: scanSource(text, FAMILIES.registryName),
  }));
  return familyParts(scanned, files[FAMILY_REGISTRY] ?? null, FAMILIES);
}

function snapshot(files: Record<string, string>): ContentSnapshot {
  const digests = new Map(Object.entries(files).map(([path, text]) => [path, Bun.hash(text).toString(16)]));
  return { hash: [...digests.values()].join(""), digests, parts: partsOf(files) };
}

describe("the scan of a source file", () => {
  test("finds the static, multi-line, type and dynamic imports and the re-exports", () => {
    const scan = scanSource(
      [
        'import { a } from "./a";',
        "import {",
        "  b, // the 'b' value",
        "  c,",
        '} from "./bc";',
        'import type { T } from "./types";',
        'export * from "./all";',
        'export { d } from "./d";',
        'import "./side";',
        'const lazy = () => import("./lazy");',
      ].join("\n"),
    );
    for (const spec of ["./a", "./bc", "./types", "./all", "./d", "./side", "./lazy"]) {
      expect(scan.imports).toContain(spec);
    }
    expect(scan.dynamicImport).toBe(false);
  });

  test("sees a dynamic import without a literal, a require and a glob without a literal", () => {
    expect(scanSource("const m = import(name);\n").dynamicImport).toBe(true);
    expect(scanSource("const m = require('./x');\n").dynamicImport).toBe(true);
    expect(scanSource("const m = import.meta.glob(pattern);\n").dynamicImport).toBe(true);
    expect(scanSource('const m = import.meta.glob<string>("./tracks/*.json");\n').globs).toEqual(["./tracks/*.json"]);
    // A comment does not count.
    expect(scanSource("// import.meta.glob(pattern) is a Vite form\nexport const A = 1;\n").dynamicImport).toBe(false);
  });

  test("finds the literal tune keys; a key that is not a literal counts as dynamic", () => {
    expect(scanSource('const A = tunable("pose.a", { x: 1 });\n')).toMatchObject({
      tunables: ["pose.a"],
      dynamicTunable: false,
    });
    expect(scanSource("const A = tunable(key, { x: 1 });\n").dynamicTunable).toBe(true);
    expect(scanSource("const A = tunable(`pose.${name}`, { x: 1 });\n").dynamicTunable).toBe(true);
    expect(scanSource("/** `tunable(key, value)` registers. */\nexport const A = 1;\n").dynamicTunable).toBe(false);
  });

  test("sees a top-level statement that is not a declaration", () => {
    expect(scanSource("export const A = 1;\nfunction f() {\n  g();\n}\n").topLevelEffect).toBe(false);
    expect(scanSource("export const A = 1;\nREGISTRY.set('a', 1);\n").topLevelEffect).toBe(true);
    expect(scanSource("SHARED.value = 2;\n").topLevelEffect).toBe(true);
    expect(scanSource("/*\nREGISTRY.set('a', 1);\n*/\nexport const A = 1;\n").topLevelEffect).toBe(false);
  });

  test("sees a read of an entry out of the registry", () => {
    expect(scanSource("const f = FAMILY_POSES.access;\n", "FAMILY_POSES").readsRegistryEntry).toBe(true);
    expect(scanSource("const { access } = FAMILY_POSES;\n", "FAMILY_POSES").readsRegistryEntry).toBe(true);
    expect(scanSource("const all = Object.values(FAMILY_POSES);\n", "FAMILY_POSES").readsRegistryEntry).toBe(true);
    expect(scanSource("return FAMILY_POSES[family](frame);\n", "FAMILY_POSES").readsRegistryEntry).toBe(false);
    expect(scanSource("for (const k of Object.keys(FAMILY_POSES)) {}\n", "FAMILY_POSES").readsRegistryEntry).toBe(
      false,
    );
  });

  test("the registry name comes from the family config; no config reads no registry", () => {
    expect(scanSource("const f = POSES.walk;\n", "POSES").readsRegistryEntry).toBe(true);
    expect(scanSource("const f = FAMILY_POSES.access;\n", "POSES").readsRegistryEntry).toBe(false);
    expect(scanSource("const f = FAMILY_POSES.access;\n").readsRegistryEntry).toBe(false);
  });

  test("the folder of a glob pattern", () => {
    expect(globFolder("game/editor/src/viewTrack.ts", "./tracks/*.json")).toBe("game/editor/src/tracks/");
    expect(globFolder(`${F}x.ts`, "./**/*.ts")).toBe(F);
    expect(globFolder("a/b.ts", "@pkg/*")).toBeNull();
  });
});

describe("the family parts of a tree", () => {
  test("a file that only the registry reaches is in the part of the families that reach it", () => {
    const parts = partsOf(tree());
    expect(Object.fromEntries(parts)).toEqual({
      [`${F}access.ts`]: ["access"],
      [`${F}accessArm.ts`]: ["access"],
      [`${F}wave.ts`]: ["wave"],
      // The cuff wraps the wave entry and the wave pose imports it: one file, one part.
      [`${F}cuff.ts`]: ["wave"],
      [`${F}idle.ts`]: ["idle"],
    });
    // The kit is shared: the pose module imports it. The registry and the files outside the folder are shared.
    expect(parts.has(`${F}kit.ts`)).toBe(false);
    expect(parts.has(FAMILY_REGISTRY)).toBe(false);
    expect(parts.has(POSE)).toBe(false);
  });

  test("a family file that a shared file imports, directly or through another file, is shared", () => {
    const files = tree();
    files[POSE] = `${files[POSE] ?? ""}import { cuffShare } from "./families/cuff";\n`;
    files["game/room/src/core/core.ts"] = 'import { armPose } from "../model/families/accessArm";\n';
    const parts = partsOf(files);
    expect(parts.has(`${F}cuff.ts`)).toBe(false);
    expect(parts.has(`${F}accessArm.ts`)).toBe(false);
    expect(parts.get(`${F}access.ts`)).toEqual(["access"]);
    expect(parts.get(`${F}wave.ts`)).toEqual(["wave"]);
  });

  test("a file of two families is in both parts", () => {
    const files = tree();
    files[`${F}idle.ts`] = 'import { armPose } from "./accessArm";\nexport const idlePose = armPose;\n';
    expect(partsOf(files).get(`${F}accessArm.ts`)).toEqual(["access", "idle"]);
  });

  test("a family file with a top-level effect, a tune key of another file or a dynamic tune key is shared", () => {
    const files = tree();
    files[`${F}idle.ts`] = 'import { REST } from "./kit";\nREST.x = 1;\nexport const idlePose = () => 0;\n';
    files[POSE] = `${files[POSE] ?? ""}const ARM = tunable("pose.arm", { reach: 1 });\n`;
    files[`${F}wave.ts`] = "const B = tunable(name, { a: 1 });\nexport const wavePose = () => B.a;\n";
    const parts = partsOf(files);
    expect(parts.has(`${F}idle.ts`)).toBe(false);
    expect(parts.has(`${F}accessArm.ts`)).toBe(false);
    expect(parts.has(`${F}wave.ts`)).toBe(false);
    expect(parts.get(`${F}access.ts`)).toEqual(["access"]);
  });

  test("every part is off for a dynamic import, a registry entry read, a glob into the families or another registry", () => {
    const off = (change: (files: Record<string, string>) => void) => {
      const files = tree();
      change(files);
      return partsOf(files).size;
    };
    expect(off(() => undefined)).toBe(5);
    expect(off((files) => (files["apps/editor/src/core/x.ts"] = "const m = import(name);\n"))).toBe(0);
    expect(off((files) => (files[POSE] = "const f = FAMILY_POSES.access;\n"))).toBe(0);
    expect(off((files) => (files[POSE] = 'const all = import.meta.glob("./families/*.ts");\n'))).toBe(0);
    expect(off((files) => (files[POSE] = 'const all = import.meta.glob("./**/*.ts");\n'))).toBe(0);
    expect(off((files) => (files["packages/x/src/a.ts"] = 'import { b } from "@game/room/families/b";\n'))).toBe(0);
    expect(off((files) => (files[FAMILY_REGISTRY] = `${REGISTRY}export { accessPose } from "./access";\n`))).toBe(0);
    expect(off((files) => (files[FAMILY_REGISTRY] = REGISTRY.replace("idle: idlePose", "idle: missing")))).toBe(0);
    // A glob into another folder keeps the parts.
    expect(
      off((files) => (files["apps/editor/src/core/v.ts"] = 'const t = import.meta.glob("./tracks/*.json");\n')),
    ).toBe(5);
  });
});

describe("the family config of a source", () => {
  test("no family config gives no parts; another folder and registry name give the same parts", () => {
    const files = tree();
    const scanned = Object.entries(files).map(([path, text]) => ({ path, scan: scanSource(text) }));
    expect(familyParts(scanned, files[FAMILY_REGISTRY] ?? null, null).size).toBe(0);
    const moved = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [
        path.replace(F, "game/room/src/model/poses/"),
        text.replaceAll("FAMILY_POSES", "POSES").replaceAll("./families", "./poses"),
      ]),
    );
    const config: FamilyConfig = { dir: "game/room/src/model/poses/", registryName: "POSES" };
    const rescanned = Object.entries(moved).map(([path, text]) => ({ path, scan: scanSource(text, "POSES") }));
    const parts = familyParts(rescanned, moved[familyRegistry(config)] ?? null, config);
    expect([...parts.keys()].sort()).toEqual(
      [...partsOf(files).keys()].map((path) => path.replace(F, config.dir)).sort(),
    );
  });
});

describe("the changed families and the carry of a frame", () => {
  test("an edit of a family file changes its families; an edit of a shared file changes everything", () => {
    const before = tree();
    const arm = { ...before, [`${F}accessArm.ts`]: `${before[`${F}accessArm.ts`] ?? ""}export const MORE = 1;\n` };
    expect(changedFamilies(snapshot(before), snapshot(arm))).toEqual(new Set(["access"]));
    expect(changedFamilies(snapshot(arm), snapshot(before))).toEqual(new Set(["access"]));
    const both = { ...arm, [`${F}cuff.ts`]: `${before[`${F}cuff.ts`] ?? ""}// a note\n` };
    expect(changedFamilies(snapshot(before), snapshot(both))).toEqual(new Set(["access", "wave"]));
    expect(changedFamilies(snapshot(before), snapshot({ ...before, [`${F}kit.ts`]: "export const REST = 1;\n" }))).toBe(
      null,
    );
    expect(changedFamilies(snapshot(before), snapshot({ ...before, [POSE]: "export const P = 2;\n" }))).toBe(null);
    expect(changedFamilies(snapshot(before), snapshot(before))).toEqual(new Set());
  });

  test("a new family file counts with its part; a deleted file with its part before; an unknown file is shared", () => {
    const before = tree();
    const added = {
      ...before,
      [`${F}accessIo.ts`]: "export const io = 1;\n",
      [`${F}access.ts`]: `${before[`${F}access.ts`] ?? ""}import { io } from "./accessIo";\n`,
    };
    expect(changedFamilies(snapshot(before), snapshot(added))).toEqual(new Set(["access"]));
    expect(changedFamilies(snapshot(added), snapshot(before))).toEqual(new Set(["access"]));
    // A family file that nothing imports has no part: it is shared.
    expect(changedFamilies(snapshot(before), snapshot({ ...before, [`${F}loose.ts`]: "export const L = 1;\n" }))).toBe(
      null,
    );
  });

  test("a frame carries when it has reads and no changed family is in them", () => {
    expect(carries(["wave", "idle"], new Set(["access"]))).toBe(true);
    expect(carries(["access", "idle"], new Set(["access"]))).toBe(false);
    expect(carries([], new Set(["access"]))).toBe(true);
    expect(carries(null, new Set(["access"]))).toBe(false);
    expect(carries(undefined, new Set())).toBe(false);
    expect(carries(["idle"], null)).toBe(false);
  });
});

describe("the snapshot of the content hasher", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  });

  test("has the hash of the hasher, the digests and the parts; an edit reads only the changed file", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "labs-parts-"));
    folders.push(root);
    for (const [path, text] of Object.entries(tree())) {
      fs.mkdirSync(join(root, path, ".."), { recursive: true });
      fs.writeFileSync(join(root, path), text);
    }
    const reads: string[] = [];
    const reader = fsContentReader(fs, root, { roots: ["game"], manifest: null, excluded: [], families: FAMILIES });
    const hasher = new ContentHasher(
      {
        ...reader,
        read: (path) => {
          reads.push(path);
          return reader.read(path);
        },
      },
      (bytes) => createHash("sha256").update(bytes).digest("hex"),
    );
    const first = hasher.snapshot();
    expect(first.hash).toBe(hasher.hash());
    expect(first.digests.size).toBe(Object.keys(tree()).length);
    expect(first.parts.get(`${F}accessArm.ts`)).toEqual(["access"]);
    fs.writeFileSync(join(root, F, "accessArm.ts"), `${tree()[`${F}accessArm.ts`] ?? ""}export const MORE = 1;\n`);
    reads.length = 0;
    const second = hasher.snapshot();
    expect(second.hash).not.toBe(first.hash);
    expect(reads).toEqual([`${F}accessArm.ts`]);
    expect(changedFamilies(first, second)).toEqual(new Set(["access"]));
  });
});
