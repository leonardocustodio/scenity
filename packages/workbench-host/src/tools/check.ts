// SPDX-License-Identifier: Apache-2.0
/**
 * The tool `scene_check`: `scenity check` for the open project. It runs
 * the rules of the project, of its scenes and of their sequences with no browser (the same check as the CLI and the
 * writer gate) and gives the table and the JSON report. The host loads `@scenity/cli/check` on demand: it holds the
 * runtime, so a host that never checks does not load it.
 */
import { z } from "zod";
import { defineTool, errorResult, errorText } from "./kit";

export const sceneCheck = defineTool({
  name: "scene_check",
  description:
    "Check the rules of the open project with no browser (as `scenity check` and the save gate): each rule of the " +
    "project, its scenes and their sequences, with its scope, worst time, value, limit and result. A failed block " +
    "rule passes only with a logged override for the scene file now. Gives a table and the JSON report.",
  input: z.object({
    scene: z
      .string()
      .min(1)
      .optional()
      .describe("Check this scene only (a path in the project, scenes/main.scene.json)."),
    sequence: z.string().min(1).optional().describe("Check the rules of this sequence only (a path in the project)."),
    tier: z.string().min(1).optional().describe("The LOD tier of the built models (default high)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    if (input.scene !== undefined && input.sequence !== undefined) {
      return errorResult("scene_check: give a scene or a sequence, not both.");
    }
    const { reportText, runCheck } = await import("@scenity/cli/check");
    try {
      const report = await runCheck({
        dir: ctx.projectDir ?? ctx.checkout,
        ...(input.scene === undefined ? {} : { scene: input.scene }),
        ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
        ...(input.tier === undefined ? {} : { tier: input.tier }),
      });
      return {
        content: [
          { type: "text", text: reportText(report).join("\n") },
          { type: "text", text: JSON.stringify(report) },
        ],
      };
    } catch (error) {
      // A setup problem (no project file, no build) gives its words and the command that builds the project.
      return errorResult(`scene_check: ${errorText(error)}`);
    }
  },
});
