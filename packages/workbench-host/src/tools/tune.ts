// SPDX-License-Identifier: Apache-2.0
/**
 * The tune tools of the workbench. `lab_tune` changes one tuned number of the runtime live (the next frame uses it).
 * `lab_tunes` lists the tunables with their defaults and values. The values stay in the URL of the lab (`tune=`)
 * until `labs tune-apply` writes them into the runtime source.
 */
import { z } from "zod";
import { call, cut, defineTool, fmt, frameUrl, list, number, portOf, record, shownUrl, text, textResult } from "./kit";
import { whereInput } from "./frame";

export { tuneText } from "@scenity/agent-tools/tunes";
import { tuneLines as coreTuneLines, tuneText } from "@scenity/agent-tools/tunes";

/** The tune lines of the lab: the core lines, the tool of every value and the command of the lab. */
export function tuneLines(values: Readonly<Record<string, unknown>>, max = 12): string[] {
  const lines = coreTuneLines(values, max, "lab_tunes");
  if (lines.length === 1) return lines;
  return [...lines, `Write them into the code: bun run labs tune-apply "${tuneText(values)}" (or the Tune tab).`];
}

export const labTune = defineTool({
  name: "lab_tune",
  description:
    "Tune one number of the runtime live in the lab: the next frame uses it. A null value puts the default back. " +
    "Gives the tune values now and the `labs tune-apply` text that writes them into the code.",
  input: z.object({
    path: z
      .string()
      .min(1)
      .describe("The path of the tunable, for example 'pose.maskHand.side' (lab_tunes lists them)."),
    value: z.number().nullable().describe("The new value, or null for the default."),
    where: whereInput,
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = portOf(ctx, input.where);
    const known = list(await call(port, "tunables")).some((item) => record(item).path === input.path);
    if (!known) throw new Error(`tune: no tunable "${input.path}". lab_tunes lists the paths.`);
    await call(port, "tune", [input.path, input.value]);
    const values = record(await call(port, "tunes"));
    const url = shownUrl(await frameUrl(port));
    return textResult([...tuneLines(values), `URL: ${url}`]);
  },
});

export const labTunes = defineTool({
  name: "lab_tunes",
  description:
    "List the tuned numbers of the runtime with their defaults, their values now and their steps. A filter keeps " +
    "the paths that contain its text; changed values come first.",
  input: z.object({
    filter: z.string().optional().describe("Keep the paths that contain this text, for example 'maskHand'."),
    where: whereInput,
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = portOf(ctx, input.where);
    const all = list(await call(port, "tunables")).map(record);
    const needle = input.filter?.toLowerCase() ?? "";
    const kept = all.filter((item) => (text(item.path) ?? "").toLowerCase().includes(needle));
    const changed = (item: Record<string, unknown>): boolean => item.value !== item.default;
    const sorted = [...kept.filter(changed), ...kept.filter((item) => !changed(item))];
    const line = (item: Record<string, unknown>): string => {
      const value = number(item.value);
      const base = number(item.default);
      const step = number(item.step);
      const mark = changed(item) ? " (tuned)" : "";
      return `  ${text(item.path) ?? "?"} = ${value === null ? "?" : fmt(value, 4)}${mark} · default ${base === null ? "?" : fmt(base, 4)} · step ${step === null ? "?" : fmt(step, 4)}`;
    };
    const head = `Tunables${needle === "" ? "" : ` with "${input.filter ?? ""}"`}: ${String(kept.length)} of ${String(all.length)}.`;
    return textResult([head, ...cut(sorted, 40, line, "give a filter")]);
  },
});
