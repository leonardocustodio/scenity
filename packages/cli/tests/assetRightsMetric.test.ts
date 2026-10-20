// SPDX-License-Identifier: Apache-2.0
// The metric assetRights on the showroom sample: the release gate of the assets gives the state of each asset, and the
// metric counts the assets of the scene that cannot go into a release. The showroom passes (CC0 art). A project that
// allows only another licence fails, and an asset with no record fails. The metric needs no frame: the scene document
// names the assets.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AssetDatabase } from "@scenity/assets";
import { releaseCheckOf, rightsGate } from "@scenity/assets/release";
import { readDocument, type SceneDocument } from "@scenity/scene";
import { assetStatuses, createMetricContext, createMetricRegistry, inLimit, type AssetStatus } from "@scenity/rules";

const SHOWROOM = join(import.meta.dir, "../../../samples/showroom");
const registry = createMetricRegistry();
const NO_FACTS = { simMs: null, entities: [], totals: { entities: 0, triangles: 0, drawCalls: 0 } };

function showroomScene(): SceneDocument {
  const result = readDocument(readFileSync(join(SHOWROOM, "scenes/main.scene.json"), "utf8"), "scene");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

function rights(scene: SceneDocument, assets: readonly AssetStatus[] | undefined, args: unknown = {}) {
  const ctx = createMetricContext({ facts: NO_FACTS, scene, ...(assets === undefined ? {} : { assets }) });
  const outcome = registry.evaluate("assetRights", ctx, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result;
}

describe("the metric assetRights", () => {
  it("passes on the showroom: each asset of the scene has a CC0 rights record", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const report = await releaseCheckOf(db);
    expect(report.passed).toBe(true);
    const statuses = assetStatuses(
      db.entries().map((entry) => entry.id),
      report.findings,
    );
    const scene = showroomScene();
    const result = rights(scene, statuses);
    expect(result).toMatchObject({ value: 0, unit: "count", limit: { max: 0 } });
    // The six models and the environment map.
    expect(result.items).toHaveLength(7);
    expect(inLimit(result.value, result.limit ?? {})).toBe(true);
  });

  it("fails when the project allows another licence only, and for an asset with no record", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const subjects = db.entries().map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      tags: entry.tags,
      rights: join(db.dir, dirname(entry.recordPath), entry.record.rights),
    }));
    const findings = rightsGate(subjects, { licences: { allow: ["MIT"] } }, db.dir);
    const statuses = assetStatuses(
      subjects.map((subject) => subject.id),
      findings,
    );
    const scene = showroomScene();
    const refused = rights(scene, statuses);
    expect(refused.value).toBe(7);
    expect(refused.items?.[0]?.detail).toContain("MIT");
    expect(inLimit(refused.value, refused.limit ?? {})).toBe(false);
    const missing = rights(scene, [], { assets: ["01M4ZPXYG50NAV41FPDE38QB7E"] });
    expect(missing).toMatchObject({ value: 1, items: [{ detail: "no asset record" }] });
    // With no asset records the metric does not apply.
    expect(rights(scene, undefined).value).toBeNull();
  });
});
