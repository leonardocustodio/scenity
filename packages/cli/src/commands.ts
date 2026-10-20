// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of `scenity`. Each entry loads its module on demand, so a light command never loads the runtime. `help`
 * gives the lines of `scenity <command> --help`.
 */
import type { CommandResult } from "./args";

/** The module of a command: its run function and its help lines. */
export interface CommandModule {
  run(argv: readonly string[]): Promise<CommandResult>;
  readonly help: readonly string[];
}

export interface CommandEntry {
  readonly name: string;
  /** One line for the command list. */
  readonly summary: string;
  load(): Promise<CommandModule>;
}

/** The usage text of a command, with the name of the bin in place of `bun packages/cli/src/cli.ts`. */
function usage(text: string): string {
  return `usage: ${text.replace("bun packages/cli/src/cli.ts", "scenity")}`;
}

export const COMMANDS: readonly CommandEntry[] = [
  {
    name: "create",
    summary: "a new project folder from a template (empty or showroom)",
    load: async () => {
      const module = await import("./create/command");
      return { run: module.runCreateCommand, help: module.CREATE_HELP };
    },
  },
  {
    name: "studio",
    summary: "Scenity Studio: the Hub, the editor of each project and the agents, in the browser",
    load: async () => {
      const module = await import("./studio/command");
      return { run: module.runStudioCommand, help: module.STUDIO_HELP };
    },
  },
  {
    name: "mcp",
    summary: "the tools of Scenity Studio over MCP (stdio) for an external agent",
    load: async () => {
      const module = await import("./studio/mcp");
      return { run: module.runMcpCommand, help: module.MCP_HELP };
    },
  },
  {
    name: "dev",
    summary: "the scene page dev server of a project, with the editor (edit=1)",
    load: async () => {
      const module = await import("./dev/command");
      return { run: module.runDevCommand, help: module.DEV_HELP };
    },
  },
  {
    name: "build",
    summary: "the static build of a project, its size budgets and its marker gate",
    load: async () => {
      const module = await import("./build/command");
      return { run: module.runBuildCommand, help: [usage(module.BUILD_USAGE)] };
    },
  },
  {
    name: "check",
    summary: "the rules of a project, with no browser",
    load: async () => {
      const module = await import("./check/command");
      return { run: module.runCheckCommand, help: [usage(module.CHECK_USAGE)] };
    },
  },
  {
    name: "shot",
    summary: "one picture of a scene or a sequence in the player, and its comparison with a baseline",
    load: async () => {
      const module = await import("./shot/command");
      return { run: module.runShotCommand, help: [usage(module.SHOT_USAGE)] };
    },
  },
  {
    name: "sheet",
    summary: "a contact sheet of times and cameras in the player",
    load: async () => {
      const module = await import("./sheet/command");
      return { run: module.runSheetCommand, help: module.SHEET_HELP };
    },
  },
  {
    name: "frames",
    summary: "the frame index: a picture of each sequence, camera and moment",
    load: async () => {
      const module = await import("./frames/command");
      return { run: module.runFramesCommand, help: module.FRAMES_HELP };
    },
  },
  {
    name: "clip",
    summary: "a WebM video of a time range of a sequence in the player",
    load: async () => {
      const module = await import("./clip/command");
      return { run: module.runClipCommand, help: module.CLIP_HELP };
    },
  },
  {
    name: "bench",
    summary: "the frame numbers of a scene or a sequence in the player, with the project budgets",
    load: async () => {
      const module = await import("./bench/command");
      return { run: module.runBenchCommand, help: [usage(module.BENCH_USAGE)] };
    },
  },
  {
    name: "verify",
    summary: "the project checks: check, build --check and shot --compare against the project baselines",
    load: async () => {
      const module = await import("./verify/command");
      return { run: module.runVerifyCommand, help: module.VERIFY_HELP };
    },
  },
  {
    name: "publish",
    summary: "the release gate of the assets, then the build folder as a ZIP archive",
    load: async () => {
      const module = await import("./publish/command");
      return { run: module.runPublishCommand, help: module.PUBLISH_HELP };
    },
  },
  {
    name: "pool",
    summary: "the scene pool: warm player pages for shot, sheet and clip (start, status, stop)",
    load: async () => {
      const module = await import("./pool/command");
      return { run: module.runPoolCommand, help: module.POOL_HELP };
    },
  },
  {
    name: "assets",
    summary: "the asset tools: import, build, stills, release-check, export, index, missing, used-by, new-id",
    load: async () => {
      const module = await import("./assets/command");
      return { run: module.runAssetsCommand, help: module.ASSETS_HELP };
    },
  },
];

/** The lines of `scenity --help`. */
export function usageLines(pluginCommands: readonly { name: string; summary: string }[] = []): string[] {
  const width = Math.max(...[...COMMANDS, ...pluginCommands].map((entry) => entry.name.length));
  const line = (entry: { name: string; summary: string }) => `  ${entry.name.padEnd(width)}  ${entry.summary}`;
  return [
    "usage: scenity <command> [arguments]   (scenity <command> --help for the arguments of a command)",
    "commands:",
    ...COMMANDS.map(line),
    ...(pluginCommands.length === 0 ? [] : ["commands of the project plugins:", ...pluginCommands.map(line)]),
  ];
}
