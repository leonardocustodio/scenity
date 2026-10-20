// SPDX-License-Identifier: Apache-2.0
// The rule check of the dev document core on the pickup scene of the characters sample. The core moves to the times
// of the scopes with no render, the metrics read the scene of each time, and the core returns to its time. The rules
// of the sample (the pickup sequence and its scene) pass. A rule of another sequence has no context, and a stricter
// limit fails at the half reach.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { documentRules, gateRules, type RuleResult } from "@scenity/rules";
import type { Rule } from "@scenity/scene";
import { DevDocumentCore } from "../src/document/devDocumentCore";
import { handleSceneDevMessage } from "../src/document/messages";
import { coreOptions } from "../../runtime/tests/pickHelpers";
import { RobotAssets, sampleScene, sampleSequence } from "./metricHelpers";

const PICKUP = sampleScene("characters/scenes/pickup.scene.json");
const SEQUENCE = sampleSequence("characters/sequences/pickup.sequence.json");
const sequences = { pickup: SEQUENCE };

let core: DevDocumentCore;
const TIME = 2000;

beforeAll(async () => {
  const options = coreOptions([]);
  core = new DevDocumentCore({
    ...options,
    flags: { ...options.flags, paused: true },
    clock: () => TIME,
    assetSource: () => new RobotAssets(),
  });
  core.start();
  const loaded = await core.load({ documents: { scene: PICKUP, sequence: SEQUENCE } });
  if (!loaded.ok) throw new Error(loaded.reason);
  await core.patch([]);
});

afterAll(() => {
  core.dispose();
});

function check(rules: readonly Rule[], playing: string | null = "pickup"): RuleResult[] {
  return core.checkRules({ rules, sequences, playing });
}

describe("the rule check of the dev document core", () => {
  it("the rules of the pickup sample pass; the core returns to its time", () => {
    const rules = [...documentRules(PICKUP.rules), ...documentRules(SEQUENCE.rules, "pickup")];
    expect(rules.length).toBeGreaterThan(1);
    const before = core.inspect().entities.find((entity) => entity.id === "robot")?.transform.position;
    const results = check(rules);
    expect(results.map((result) => [result.id, result.status])).toEqual(rules.map((rule) => [rule.id, "pass"]));
    expect(gateRules(results).passed).toBe(true);
    expect(core.inspect().entities.find((entity) => entity.id === "robot")?.transform.position).toEqual(before);
  });

  it("a stricter IK limit fails at the half reach; a time of another sequence has no context", () => {
    const strict: Rule = {
      id: "pickup.strict",
      metric: "ikError",
      max: 0.02,
      level: "block",
      scope: { kind: "marker", sequence: "pickup", marker: ["reach", "pickup"] },
    };
    const [result] = check([strict]);
    expect(result?.times.map((item) => [item.at.marker, item.status])).toEqual([
      ["reach", "fail"],
      ["pickup", "pass"],
    ]);
    expect(result?.detail).toStartWith("at 4500 ms (reach): ");
    expect(check([strict], null)[0]?.status).toBe("n/a");
  });

  it("the dev message answers with the results", () => {
    const posted: unknown[] = [];
    const args = { entity: "robot", joints: ["FootL", "FootR"] };
    const rule: Rule = { id: "floor", metric: "belowFloor", args, max: 0.01, level: "warn" };
    const handled = handleSceneDevMessage({ type: "checkRules", id: 7, request: { rules: [rule] } }, core, (message) =>
      posted.push(message),
    );
    expect(handled).toBe(true);
    expect(posted).toMatchObject([{ type: "rulesChecked", id: 7, results: [{ id: "floor", status: "pass" }] }]);
  });
});
