// SPDX-License-Identifier: Apache-2.0
/**
 * Right answers of the cases that change code or run the CLI. Only the tests of the checks use them. The other cases
 * keep their answer in their `solve` field.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { SCENITY, valueOf, type BenchProject, type Json } from "./project";

function replaceIn(p: BenchProject, file: string, from: string, to: string): void {
  const text = p.text(file);
  if (!text.includes(from)) throw new Error(`${file} has no ${from}`);
  writeFileSync(p.path(file), text.replace(from, to));
}

function scenity(p: BenchProject, args: readonly string[]): string {
  const run = spawnSync(SCENITY[0] ?? "bun", [...SCENITY.slice(1), ...args], { cwd: p.dir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`scenity ${args.join(" ")}: ${run.stderr || run.stdout}`);
  return run.stdout;
}

const BOB = `import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";
import { defineSystem } from "@scenity/runtime/systems";

export const bobSchema = z.strictObject({ height: z.number().min(0).optional(), period: z.number().int().min(100).optional() });
export const bobComponent = defineComponent({ id: "demo.bob", schema: bobSchema, defaults: { height: 0.2, period: 2000 } });
export const bobSystem = defineSystem({
  id: "demo.bob",
  order: 1,
  reads: ["demo.bob", "transform"],
  update(ctx) {
    for (const id of Object.keys(ctx.frame.scene.entities).sort()) {
      const components = ctx.frame.scene.entities[id]?.components ?? {};
      const bob = components["demo.bob"];
      if (bob === undefined) continue;
      const base = components.transform?.position ?? [0, 0, 0];
      const lift = ((bob.height ?? 0.2) * (1 - Math.cos((2 * Math.PI * ctx.t) / (bob.period ?? 2000)))) / 2;
      ctx.out.setTransform(id, { position: [base[0], base[1] + lift, base[2]] });
    }
  },
});
`;

export const SOLUTIONS: Readonly<Record<string, (p: BenchProject) => string | undefined>> = {
  "code-reverse-field": (p) => {
    replaceIn(
      p,
      "plugins/demo/src/component.ts",
      "  hub: z.boolean().optional(),",
      "  hub: z.boolean().optional(),\n  reverse: z.boolean().optional(),",
    );
    replaceIn(
      p,
      "plugins/demo/src/systems/spin.ts",
      "(value.speed ?? DEFAULT_SPEED) * factor",
      "(value.speed ?? DEFAULT_SPEED) * factor * (value.reverse === true ? -1 : 1)",
    );
    p.editScene("scenes/spin.scene.json", (s) => {
      valueOf(s, "slow-spinner", "demo.spin").reverse = true;
    });
  },
  "code-bob-component": (p) => {
    writeFileSync(p.path("plugins/demo/src/bob.ts"), BOB);
    replaceIn(
      p,
      "plugins/demo/src/runtime.ts",
      'import { spinSystem } from "./systems/spin";',
      'import { spinSystem } from "./systems/spin";\nimport { bobComponent, bobSystem } from "./bob";',
    );
    replaceIn(
      p,
      "plugins/demo/src/runtime.ts",
      "components: [spinComponent],",
      "components: [spinComponent, bobComponent],",
    );
    replaceIn(p, "plugins/demo/src/runtime.ts", "systems: [spinSystem],", "systems: [spinSystem, bobSystem],");
    p.editScene("scenes/spin.scene.json", (s) => {
      (s.entities.pedestal?.components as Json)["demo.bob"] = { height: 0.1 };
    });
  },
  "assets-import-robot": (p) => {
    const out = scenity(p, [
      "assets",
      "import",
      ".bench/inbox/RobotExpressive.glb",
      "--rights",
      "rights/polyhaven.yaml",
      "--json",
      "--project",
      p.dir,
    ]);
    const id =
      (JSON.parse(out) as { id?: string; record?: { id?: string } }).id ??
      (JSON.parse(out) as { record?: { id?: string } }).record?.id;
    p.editScene("scenes/main.scene.json", (s) => {
      s.entities.robot = {
        name: "Robot",
        parent: null,
        index: 99,
        components: { model: { asset: `asset:${String(id)}` }, transform: { position: [-2.2, 0, -2] } },
      };
    });
  },
  "project-build-size": (p) => {
    scenity(p, ["build", p.dir]);
    const entries = (p.read("dist/build-report.json").entries ?? []) as { id?: string; gzip?: number }[];
    const gzip = entries.find((e) => e.id === "player")?.gzip ?? 0;
    return `The player entry is ${(gzip / 1024).toFixed(1)} KB gzip.`;
  },
};
