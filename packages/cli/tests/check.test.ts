// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity check`: the rules of the samples with no browser, a failed `block` rule after a move of a prop, the logged
 * override that accepts it for the current file hash, the setup errors, and the save whose gate measures by itself.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheckCommand, saveMeasured, type CheckReport } from "../src/check/index";
import { sceneTextHash } from "../src/sceneFile/files";
import { overrideLogFile } from "../src/sceneFile/ruleGate";

const SAMPLES = join(import.meta.dir, "../../../samples");
const temp = mkdtempSync(join(tmpdir(), "scenity-check-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

async function check(...argv: string[]): Promise<{ code: number; text: string; report: CheckReport }> {
  const table = await runCheckCommand(argv);
  const json = await runCheckCommand([...argv, "--json"]);
  return { code: table.code, text: table.out.join("\n"), report: JSON.parse(json.out.join("\n")) as CheckReport };
}

/** The status of each rule of a report. */
function statuses(report: CheckReport): Record<string, string> {
  return Object.fromEntries(report.rows.map((row) => [row.rule, row.override === undefined ? row.status : "override"]));
}

/** A copy of the showroom with the lantern 1.5 m from the table top (the rule `showroom.lanternOnTable` fails). */
function movedShowroom(name: string): { dir: string; scene: string } {
  const dir = join(temp, name);
  cpSync(join(SAMPLES, "showroom"), dir, { recursive: true });
  const scene = join(dir, "scenes/main.scene.json");
  const doc = JSON.parse(readFileSync(scene, "utf8")) as {
    entities: Record<string, { components: { transform: { position: number[] } } }>;
  };
  const lantern = doc.entities.lantern;
  if (lantern === undefined) throw new Error("the showroom has no lantern");
  lantern.components.transform.position = [1.5, 0.8, 0];
  writeFileSync(scene, `${JSON.stringify(doc, null, 2)}\n`);
  return { dir, scene };
}

describe("scenity check on the samples", () => {
  test("the showroom passes with its built assets: each rule has a value", async () => {
    const { code, text, report } = await check(join(SAMPLES, "showroom"));
    expect(code).toBe(0);
    expect(report.assets).toEqual({ origin: "build", tier: "high", where: "build" });
    expect(statuses(report)).toEqual({
      "showroom.lanternOnTable": "pass",
      "showroom.triangles": "pass",
      "showroom.ottomanClear": "pass",
      "showroom.assetRights": "pass",
      "showroom.onFloor": "pass",
    });
    expect(report.rows.every((row) => row.value !== null)).toBe(true);
    expect(text).toContain("rule");
    expect(text).toMatch(/showroom\.lanternOnTable\s+scene\s+scene\s+0\.3536 m\s+max 0\.45 m\s+PASS/);
    expect(text).toContain("passed: 5 rules");
  });

  test("the characters pass with the source assets, at the markers of the pickup sequence", async () => {
    const { code, report } = await check(join(SAMPLES, "characters"));
    expect(code).toBe(0);
    expect(report.assets?.origin).toBe("source");
    expect(statuses(report)).toEqual({
      "pickup.feetOnFloor": "pass",
      "pickup.gripAtPickup": "pass",
      "pickup.cupInReach": "pass",
    });
    expect(report.rows.find((row) => row.rule === "pickup.gripAtPickup")?.time).toBe("5000 ms (pickup)");
    const only = await check(join(SAMPLES, "characters"), "--sequence", "sequences/pickup.sequence.json");
    expect(Object.keys(statuses(only.report))).toEqual(["pickup.gripAtPickup", "pickup.cupInReach"]);
  });

  test("the metric face of a project plugin (`scenity.dev`) gives its metrics to the rules", async () => {
    const dir = join(temp, "probe");
    cpSync(join(SAMPLES, "showroom"), dir, { recursive: true });
    mkdirSync(join(dir, "plugins/probe"), { recursive: true });
    // A metric face with no import: the registry reads `safeParse` of the arguments and `evaluate`.
    writeFileSync(
      join(dir, "plugins/probe/dev.ts"),
      [
        "const args = { safeParse: (data: unknown) => ({ success: true, data }) };",
        "const one = { id: 'probe.one', label: 'One', unit: 'count', args, evaluate: () => ({ value: 1, unit: 'count' }) };",
        "export default { id: 'probe', library: [one] };",
        "",
      ].join("\n"),
    );
    const file = join(dir, "scenity.project.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { plugins: string[]; rules: unknown[] };
    doc.plugins = ["./plugins/probe"];
    doc.rules = [{ id: "probe.one", metric: "probe.one", max: 2, unit: "count", level: "block" }];
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const { code, report } = await check(dir);
    expect(statuses(report)["probe.one"]).toBe("pass");
    expect(code).toBe(0);
  });

  test("a project with no rules passes and loads no asset", async () => {
    const { code, text, report } = await check(join(SAMPLES, "gltf-samples"));
    expect(code).toBe(0);
    expect(report.assets).toBeNull();
    expect(text).toContain("no rules: the check passes.");
  });

  test("a usage error exits with 2", async () => {
    expect((await runCheckCommand(["--scene"])).code).toBe(2);
    expect((await runCheckCommand(["a", "b"])).code).toBe(2);
  });
});

describe("a failed block rule and its override", () => {
  test("a moved lantern fails the block rule; the check exits with 1", async () => {
    const { dir } = movedShowroom("moved");
    const { code, text, report } = await check(dir, "--scene", "scenes/main.scene.json");
    expect(code).toBe(1);
    expect(report.passed).toBe(false);
    expect(statuses(report)["showroom.lanternOnTable"]).toBe("fail");
    expect(text).toMatch(/showroom\.lanternOnTable\s+scene\s+scene\s+1\.52\d* m\s+max 0\.45 m\s+FAIL block/);
    expect(text).toContain("failed: 1 block rule (showroom.lanternOnTable)");
  });

  test("an override in the log accepts the failure only for the scene file hash now", async () => {
    const { dir, scene } = movedShowroom("override");
    const log = overrideLogFile(scene);
    const line = (hash: string) =>
      `${JSON.stringify({
        time: "2026-10-16T08:00:00.000Z",
        scene: "scenes/main.scene.json",
        hash,
        reason: "the lantern stands on the floor for the demo",
        rules: [{ id: "showroom.lanternOnTable", status: "fail", detail: "1.52 m, max 0.45 m" }],
      })}\n`;
    writeFileSync(log, line("0".repeat(64)));
    expect((await check(dir)).code).toBe(1);
    writeFileSync(log, line(sceneTextHash(readFileSync(scene))));
    const { code, text, report } = await check(dir);
    expect(code).toBe(0);
    expect(report.rows.find((row) => row.rule === "showroom.lanternOnTable")?.override).toBe(
      "the lantern stands on the floor for the demo",
    );
    expect(text).toContain("OVERRIDE");
    // A change of the scene after the override makes it stale.
    writeFileSync(scene, `${readFileSync(scene, "utf8")}\n`);
    expect((await check(dir)).code).toBe(1);
  });

  test("a project with a build and no manifest, or a changed built file, fails with the build command", async () => {
    const { dir } = movedShowroom("stale");
    const manifest = JSON.parse(readFileSync(join(dir, "build/manifest.json"), "utf8")) as {
      records: { files: { file: string }[] }[];
    };
    const first = manifest.records[0]?.files[0]?.file ?? "";
    writeFileSync(join(dir, "build", first), "not a model");
    const stale = await check(dir);
    expect(stale.code).toBe(1);
    expect(stale.text).toContain("the build is stale. Run: bun packages/assets/src/cli.ts build");
    rmSync(join(dir, "build/manifest.json"));
    const missing = await runCheckCommand([dir]);
    expect(missing.code).toBe(1);
    expect(missing.out.join("\n")).toContain("The project has a build (build.assets) but no build/manifest.json.");
  });
});

describe("the writer gate measures by itself", () => {
  const PATH = "scenes/main.scene.json";
  const RULE = {
    id: "box.near",
    metric: "distance",
    args: { from: "entity:box", to: [0, 0, 0] },
    max: 2,
    level: "block",
  };

  function sceneText(x: number): string {
    const box = { parent: null, index: 0, components: { transform: { position: [x, 0, 0] } } };
    return JSON.stringify({ format: "scenity.scene/1", id: "main", entities: { box }, rules: [RULE] });
  }

  function project(): string {
    const dir = join(temp, "writer");
    mkdirSync(join(dir, "scenes"), { recursive: true });
    writeFileSync(join(dir, PATH), sceneText(1));
    const doc = { format: "scenity.project/1", id: "writer", name: "Writer", scenes: [PATH] };
    writeFileSync(join(dir, "scenity.project.json"), JSON.stringify(doc));
    return dir;
  }

  test("a save with no results passes or stops on the measured rules; a reason lets it through", async () => {
    const dir = project();
    const base = () => sceneTextHash(readFileSync(join(dir, PATH)));
    const near = await saveMeasured(dir, { path: PATH, text: sceneText(1.5), baseHash: base() });
    expect(near.ok).toBe(true);
    const far = await saveMeasured(dir, { path: PATH, text: sceneText(3), baseHash: base() });
    expect(far.ok).toBe(false);
    if (!far.ok && !far.conflict) expect(far.blocked?.map((verdict) => verdict.id)).toEqual(["box.near"]);
    const reason = "the box moves out for the demo";
    const forced = await saveMeasured(dir, { path: PATH, text: sceneText(3), baseHash: base(), reason });
    expect(forced.ok).toBe(true);
    expect(readFileSync(overrideLogFile(join(dir, PATH)), "utf8")).toContain(reason);
  });
});
