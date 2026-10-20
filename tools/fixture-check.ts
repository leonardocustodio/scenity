// SPDX-License-Identifier: Apache-2.0
/**
 * The fixture check: no engine file and no engine test reads the data of the
 * room of CodeBlue.
 *
 * Run from the repo root:
 *     bun tools/fixture-check.ts          # exit 1 when a source file names a fixture name of that room
 *     bun tools/fixture-check.ts --tests  # read only the test files
 *
 * Any other argument, for example `--all`, gives the default (every source file).
 *
 * The domain word lint (tools/domain-words.ts) finds the words of the domain. This check finds the names of the data
 * of the room that are not domain words: the take IDs, the member IDs, the moments and the tracks. The list is small
 * and stays in this file. Its names are not domain words, so the domain word lint reads this file with no hit. The
 * check reads the source files under apps/, packages/, tools/ and plugins/. A test file is a file in a `tests`,
 * `test`, `__tests__`, `testing` or `fixtures` folder, or a file whose name has `.test.`, `.spec.`, `.vitest.` or
 * `.pw.`. A test uses the fixtures of the samples, small fixture scenes or a fake plugin with neutral names
 * (docs/testing.md). An engine file gets the data of a project from its plugins (for example `defaultTake`,
 * `memberLabel` and `toolNotes`), and its comments use neutral examples.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, sourceFiles } from "./domain-words";

/** One fixture name of the room of CodeBlue: a pattern of a word part and the source of the name. */
export interface FixtureName {
  readonly pattern: string;
  readonly from: string;
}

/** The fixture names. A pattern matches a whole word part, with any case ("take=X", "X_take", "takeX"). */
export const FIXTURE_NAMES: readonly FixtureName[] = [
  { pattern: "arrest", from: "the main take of the room" },
  { pattern: "rosc", from: "a take and a track of the room" },
  { pattern: "s01_expert", from: "the first scripted track of the room" },
  { pattern: "npc_[a-z0-9]*", from: "the member IDs of the room and their prefix" },
  { pattern: "take[\"']?\\s*[:=]\\s*[\"']?swap", from: "the second take of the room" },
  { pattern: "lab_(?:check|where|place|inspect|search|layout_check)", from: "the host tools of the room" },
  { pattern: "sternum", from: "a hand target of the room" },
  { pattern: "compressions", from: "a pose family of the room" },
  { pattern: "bag[-_ ]?mask", from: "a prop of the room" },
];

/** The folders that the check reads. */
const ROOTS = ["apps", "packages", "tools", "plugins"];
/** The folder names that hold tests, fixtures and test kits. */
const TEST_FOLDERS = new Set(["tests", "test", "__tests__", "testing", "fixtures"]);
/** The file names of a test or a spec. */
const TEST_FILE = /\.(?:test|spec|vitest|pw)\.[a-z]+$/;

/** True for a test file: a file in a test folder, or a file with a test name. */
export function isTestFile(path: string): boolean {
  const parts = path.split("/");
  return TEST_FILE.test(parts.at(-1) ?? "") || parts.slice(0, -1).some((part) => TEST_FOLDERS.has(part));
}

/** The pattern of a list of fixture names: a whole word part of a text in lower case. */
export function fixturePattern(names: readonly FixtureName[] = FIXTURE_NAMES): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${names.map((name) => name.pattern).join("|")})(?![a-z0-9])`, "g");
}

/** One hit: the file, the line (from 1) and the text that matched. */
export interface FixtureHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** The hits of a text. A camel case name counts each part ("takeX" has "x"). */
export function textHits(path: string, text: string, pattern = fixturePattern()): FixtureHit[] {
  const hits: FixtureHit[] = [];
  text.split("\n").forEach((line, index) => {
    const parts = line.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    for (const match of parts.matchAll(pattern)) hits.push({ path, line: index + 1, text: match[0] });
  });
  return hits;
}

/** The hits of the files under the root: every source file, or the test files only with `tests`. */
export function scanFixtures(root = ROOT, options: { readonly tests?: boolean } = {}): FixtureHit[] {
  const pattern = fixturePattern();
  return sourceFiles(root, ROOTS)
    .filter((path) => path !== "tools/fixture-check.ts" && (options.tests !== true || isTestFile(path)))
    .flatMap((path) => textHits(path, readFileSync(join(root, path), "utf8"), pattern));
}

function main(argv: readonly string[]): number {
  const hits = scanFixtures(ROOT, { tests: argv.includes("--tests") });
  for (const hit of hits) console.error(`fixture check: ${hit.path}:${String(hit.line)}: ${hit.text}`);
  const files = new Set(hits.map((hit) => hit.path)).size;
  console.log(`fixture check: ${String(hits.length)} fixture names of the room of CodeBlue in ${String(files)} files`);
  return hits.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
