// SPDX-License-Identifier: Apache-2.0
/**
 * The rule gate of a scene save. The writer knows the rules of the scene and of the project. It reads the results of
 * the request for the saved text. It refuses a failed block rule without a reason of the owner. It keeps the reason of
 * an override in a log file next to the scene.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSceneFile, sceneTextHash, type SceneRuleVerdict, type SceneSaveParams } from "../src/sceneFile/files";
import { overrideLogFile } from "../src/sceneFile/ruleGate";

const temp = mkdtempSync(join(tmpdir(), "scenity-rule-gate-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PATH = "scenes/main.scene.json";
const RULES = [
  { id: "box.near", metric: "distance", args: { from: "entity:box", to: [0, 0, 0] }, max: 2, level: "block" },
  { id: "box.floor", metric: "belowFloor", max: 0.01, level: "warn", provisional: true },
];

function sceneText(x: number, rules: unknown[] = RULES): string {
  const box = { parent: null, index: 0, components: { transform: { position: [x, 0, 0] } } };
  return JSON.stringify({ format: "scenity.scene/1", id: "main", entities: { box }, rules });
}

let count = 0;

/** A temp project with the scene at x = 1, and a project file with `rules` when it is given. */
function project(projectRules?: unknown[]): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(join(dir, "scenes"), { recursive: true });
  writeFileSync(join(dir, PATH), sceneText(1));
  if (projectRules !== undefined) {
    const doc = { format: "scenity.project/1", id: "gate", name: "Gate", scenes: [PATH], rules: projectRules };
    writeFileSync(join(dir, "scenity.project.json"), JSON.stringify(doc));
  }
  return dir;
}

/** The save parameters of a text with the verdicts of the page for that text. */
function save(dir: string, text: string, verdicts?: SceneRuleVerdict[], reason?: string): SceneSaveParams {
  const baseHash = sceneTextHash(readFileSync(join(dir, PATH)));
  return {
    path: PATH,
    text,
    baseHash,
    ...(verdicts === undefined ? {} : { checks: { hash: sceneTextHash(text), verdicts } }),
    ...(reason === undefined ? {} : { reason }),
  };
}

const PASS: SceneRuleVerdict[] = [
  { id: "box.near", level: "block", status: "pass", detail: "1 m, max 2 m" },
  { id: "box.floor", level: "warn", status: "n/a" },
];
const FAIL: SceneRuleVerdict[] = [
  { id: "box.near", level: "block", status: "fail", detail: "3 m, max 2 m" },
  { id: "box.floor", level: "warn", status: "fail", detail: "0.2 m, max 0.01 m" },
];

describe("the rule gate of a scene save", () => {
  test("a save with the results of passed rules writes the file", () => {
    const dir = project();
    const result = saveSceneFile(dir, save(dir, sceneText(1.5), PASS));
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result.ok && "override" in result).toBe(false);
    expect(existsSync(overrideLogFile(join(dir, PATH)))).toBe(false);
  });

  test("a failed block rule refuses the save; a reason of the owner lets it go and goes into the log", () => {
    const dir = project();
    const refused = saveSceneFile(dir, save(dir, sceneText(3), FAIL));
    expect(refused).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "box.near", status: "fail" }] });
    expect(refused.ok || refused.conflict ? "" : refused.reason).toStartWith("1 block rule fail: box.near: 3 m");
    expect(readFileSync(join(dir, PATH), "utf8")).toBe(sceneText(1));
    const saved = saveSceneFile(dir, save(dir, sceneText(3), FAIL, "the box moves out for the demo"));
    expect(saved).toMatchObject({ ok: true, changed: true, override: "the box moves out for the demo" });
    expect(saved.ok && saved.warned).toEqual([
      { id: "box.floor", level: "warn", status: "fail", detail: "0.2 m, max 0.01 m", provisional: true },
    ]);
    const log = readFileSync(join(dir, "scenes/main.rules-log.jsonl"), "utf8").trim().split("\n");
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0] ?? "{}")).toMatchObject({
      scene: PATH,
      hash: saved.ok ? saved.hash : "",
      reason: "the box moves out for the demo",
      rules: [{ id: "box.near", status: "fail", detail: "3 m, max 2 m" }],
    });
  });

  test("a save with no results, or with the results of another text, has an error for each rule", () => {
    const dir = project();
    const none = saveSceneFile(dir, save(dir, sceneText(1.5)));
    expect(none.ok || none.conflict ? [] : none.blocked).toEqual([
      { id: "box.near", level: "block", status: "error", detail: "the save carries no rule results" },
    ]);
    const other = { ...save(dir, sceneText(1.5)), checks: { hash: sceneTextHash(sceneText(9)), verdicts: PASS } };
    const stale = saveSceneFile(dir, other);
    expect(stale.ok || stale.conflict ? "" : stale.blocked?.[0]?.detail).toBe("the rule results are for another text");
    // A scene with no rules needs no results.
    expect(saveSceneFile(dir, save(dir, sceneText(1.5, [])))).toMatchObject({ ok: true });
  });

  test("the level comes from the file, not from the request", () => {
    const dir = project();
    const lying = FAIL.map((verdict) => ({ ...verdict, level: "warn" as const }));
    expect(saveSceneFile(dir, save(dir, sceneText(3), lying))).toMatchObject({
      ok: false,
      blocked: [{ id: "box.near" }],
    });
  });

  test("the project rules apply: inline and in a rules file; a rules file that does not read is an error", () => {
    const fileRule = {
      id: "project.file",
      metric: "distance",
      args: { from: "entity:box", to: [0, 0, 0] },
      max: 9,
      level: "block",
    };
    const dir = project([
      { id: "project.inline", metric: "belowFloor", max: 0.01, level: "block" },
      "rules/layout.rules.json",
      "rules/missing.rules.json",
    ]);
    mkdirSync(join(dir, "rules"));
    writeFileSync(
      join(dir, "rules/layout.rules.json"),
      JSON.stringify({ format: "scenity.rules/1", id: "layout", rules: [fileRule] }),
    );
    const verdicts: SceneRuleVerdict[] = [
      ...PASS,
      { id: "project.inline", level: "block", status: "pass" },
      { id: "project.file", level: "block", status: "pass" },
    ];
    const result = saveSceneFile(dir, save(dir, sceneText(1.5), verdicts));
    expect(result.ok || result.conflict ? [] : result.blocked).toEqual([
      { id: "rules/missing.rules.json", level: "block", status: "error", detail: "no rules file" },
    ]);
    const partial = saveSceneFile(dir, save(dir, sceneText(1.5), PASS, "the project rules come later"));
    expect(partial).toMatchObject({ ok: true, override: "the project rules come later" });
  });

  test("a sequence rule of the request keeps its level", () => {
    const dir = project();
    const verdicts: SceneRuleVerdict[] = [
      ...PASS,
      { id: "walk.reach", level: "block", status: "fail", detail: "at 4500 ms" },
    ];
    expect(saveSceneFile(dir, save(dir, sceneText(1.5), verdicts))).toMatchObject({
      ok: false,
      blocked: [{ id: "walk.reach" }],
    });
  });
});
