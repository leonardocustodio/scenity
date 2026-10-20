// SPDX-License-Identifier: Apache-2.0
// The check of the art of the repository: only free art, and no folder of a domain plugin.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMAIN_WORDS } from "./domain-words";
import { artProblems, field, recordProblem } from "./restricted-art";

/** The name of the plugin that went to CodeBlue: the last word of the domain word list. */
const MOVED = DOMAIN_WORDS[DOMAIN_WORDS.length - 1];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A temporary repository with the given files (path → text). */
function repo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "restricted-art-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const CC0 = 'name: a\nlicence: "CC0 1.0 Universal (public domain dedication)"\nspdx: CC0-1.0 # the release gate\n';

describe("the art check", () => {
  test("reads a field without its quotes and its comment", () => {
    expect(field(CC0, "spdx")).toBe("CC0-1.0");
    expect(field(CC0, "licence")).toBe("CC0 1.0 Universal (public domain dedication)");
    expect(field(CC0, "source")).toBeNull();
  });

  test("passes the free licences and refuses the others", () => {
    expect(recordProblem("a.yaml", CC0)).toBeNull();
    expect(recordProblem("b.yaml", "licence: Creative Commons Attribution 4.0 International\n")).toBeNull();
    expect(recordProblem("c.yaml", "licence: ActorCore content licence\n")).toContain("is not free");
    expect(recordProblem("d.yaml", "licence: x\nspdx: LicenseRef-Purchase\n")).toContain("LicenseRef-Purchase");
    expect(recordProblem("e.yaml", "licence: CC BY-SA 4.0\n")).toContain("is not free");
    expect(recordProblem("f.yaml", "licence: null\n")).toContain("no licence");
  });

  test("finds a restricted record anywhere, and the folders of a domain plugin", () => {
    const root = repo({
      "samples/park/rights/park.yaml": CC0,
      "art/packs/rights/pack.yaml": "name: pack\nlicence: The licence of the purchase\n",
      [`plugins/${MOVED}/room/package.json`]: "{}",
      [`samples/${MOVED}/scenity.project.json`]: "{}",
      "art/room3d/assets.json": "{}",
      "node_modules/x/rights/x.yaml": "licence: Commercial\n",
      "docs/notes.yaml": "title: no record\n",
    });
    expect(artProblems(root)).toEqual([
      `plugins/${MOVED}: the domain plugins, their projects and their art are in another repository`,
      `samples/${MOVED}: the domain plugins, their projects and their art are in another repository`,
      "art/room3d: the domain plugins, their projects and their art are in another repository",
      'art/packs/rights/pack.yaml: the licence "The licence of the purchase" is not free (give a free SPDX ID: CC0-1.0, CC-BY-3.0, CC-BY-4.0)',
    ]);
  });

  test("passes this repository", () => {
    expect(artProblems(join(import.meta.dir, ".."))).toEqual([]);
  });
});
