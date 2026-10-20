// SPDX-License-Identifier: Apache-2.0
/**
 * The journeys that need a model: the start from a sentence (`start`, journeyStart.ts) and the plugin (`plugin`,
 * journeyPlugin.ts). Each run uses the Claude driver of the studio host, so it costs money.
 *
 *   bun tools/agent-bench/journeys.ts                        # the start journey with its five prompts, then the plugin
 *   bun tools/agent-bench/journeys.ts --journey start --prompts museum,garden --minutes 10
 *   bun tools/agent-bench/journeys.ts --journey plugin --out .scenity/journeys/try
 *
 * A run writes `results.json` and `summary.md` into `--out` (default `.scenity/journeys/<time>`), with the projects
 * that the journeys made. `--minutes` is the time limit of each agent turn.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runPlugin, type PluginRun } from "./journeyPlugin";
import { runStart, START_PROMPTS, type StartRun } from "./journeyStart";
import { CHECKOUT } from "./project";

/** The summary of a run in Markdown. */
export function journeySummary(start: readonly StartRun[], plugin: PluginRun | null): string {
  const lines = ["# The journeys with a model", ""];
  if (start.length > 0) {
    const passed = start.filter((run) => run.passed).length;
    lines.push(`## Start from a sentence: ${String(passed)} of ${String(start.length)}`, "");
    lines.push("| Prompt | Passed | Waited | Time (s) | Cost ($) | Detail |", "| --- | --- | --- | --- | --- | --- |");
    for (const run of start) {
      const cells = [run.id, run.passed ? "yes" : "no", run.waiting, (run.durationMs / 1000).toFixed(0)];
      lines.push(`| ${[...cells, run.costUsd.toFixed(2), run.detail].join(" | ")} |`);
    }
    lines.push("");
  }
  if (plugin !== null) {
    lines.push(`## A plugin: ${plugin.passed ? "passed" : "failed"}`, "");
    lines.push(`- ${plugin.detail}`);
    lines.push(`- File reviews: ${String(plugin.reviews)}; time ${(plugin.durationMs / 1000).toFixed(0)} s`);
    lines.push(`- Cost: $${plugin.costUsd.toFixed(2)}`, "");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      journey: { type: "string", default: "all" },
      prompts: { type: "string" },
      minutes: { type: "string", default: "10" },
      out: { type: "string" },
    },
  });
  const minutes = Number(values.minutes);
  const out = values.out ?? join(CHECKOUT, ".scenity", "journeys", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  const chosen = values.prompts?.split(",") ?? null;
  const start: StartRun[] = [];
  if (values.journey === "all" || values.journey === "start") {
    for (const prompt of START_PROMPTS.filter((item) => chosen === null || chosen.includes(item.id))) {
      console.log(`start ${prompt.id}: ${prompt.words}`);
      const run = await runStart(prompt, minutes, join(out, "start"));
      console.log(`  ${run.passed ? "passed" : "failed"}: ${run.detail}`);
      start.push(run);
    }
  }
  let plugin: PluginRun | null = null;
  if (values.journey === "all" || values.journey === "plugin") {
    console.log("plugin bounce.bob");
    plugin = await runPlugin(minutes, out);
    console.log(`  ${plugin.passed ? "passed" : "failed"}: ${plugin.detail}`);
  }
  writeFileSync(join(out, "results.json"), `${JSON.stringify({ start, plugin }, null, 2)}\n`);
  const summary = journeySummary(start, plugin);
  writeFileSync(join(out, "summary.md"), summary);
  console.log(`\n${summary}\n${out}`);
}

if (import.meta.main) await main();
