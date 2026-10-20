// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity dev`:
 *
 *   scenity dev [--project <dir>] [--scene <path>] [--port <n>] [--view]
 *
 * It starts the dev server of the scene page of the editor for one project: `vite.scene.config.ts` of `apps/editor`
 * in a checkout, else of the package `@scenity/editor` of the project. It prints the URL of the editor page
 * (`edit=1`; `--view` gives the page without the editor) on the scene of `--scene`, else on the first scene of the
 * project. The editor page with no scene is the start screen of the project: its URL is `start` in the ready
 * line. The project goes to the server in `SCENITY_SCENE_PROJECTS`, so a project outside the checkout also
 * works. The server has its own dependency cache in `<project>/.scenity/vite`, so it does not disturb another scene
 * page server of the checkout. The command runs until SIGINT or SIGTERM.
 *
 * The first line on stdout is `SCENITY_DEV_READY {"url":…,"start":…,"origin":…,"project":…}` for the tools; then the
 * URLs.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Vite from "vite";
import { numberOf, readArgs, type CommandResult } from "../args";
import { commandProjectDir, CommandSetupError, editorAppDir, SCENE_CONFIG } from "../workspace";

export const DEV_USAGE = "scenity dev [--project <dir>] [--scene <path>] [--port <n>] [--view]";

export const DEV_HELP = [
  `usage: ${DEV_USAGE}`,
  "Start the scene page dev server for the project of the work folder (or --project) and print the URL of the",
  "editor page (edit=1) on --scene, else on the first scene of the project. --view: the page without the editor. --port: a fixed port (default: 5176 or the next free",
  "port). The asset hot reload, the save of the edit mode and the scene list work as in the checkout. Ctrl+C stops it.",
];

/** The variable of the extra projects of the scene page dev server (apps/editor/scripts/assetReload.ts). */
export const SCENE_PROJECTS_ENV = "SCENITY_SCENE_PROJECTS";
/** The marker of the ready line on stdout. */
export const DEV_READY = "SCENITY_DEV_READY";

export interface DevOptions {
  readonly project?: string;
  readonly scene?: string;
  readonly port?: number;
  readonly edit: boolean;
}

/** The options of the arguments after the word `dev`, or null for a usage error. */
export function parseDevArgs(argv: readonly string[]): DevOptions | null {
  const args = readArgs(argv, ["--project", "--scene", "--port"], ["--view"]);
  if (args === null || args.plain.length > 1) return null;
  const port = numberOf(args.values.port, -1, 1);
  if (port === null || (port !== -1 && (!Number.isInteger(port) || port > 65_535))) return null;
  const project = args.values.project ?? args.plain[0];
  return {
    ...(project === undefined ? {} : { project }),
    ...(args.values.scene === undefined ? {} : { scene: args.values.scene }),
    ...(port === -1 ? {} : { port }),
    edit: !args.flags.has("--view"),
  };
}

/** The name of a project on the dev server: lower-case letters, digits and "-" (the route `/projects/<name>/`). */
export function serverName(id: string): string {
  const name = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name === "" ? "project" : name;
}

/** The value of `SCENITY_SCENE_PROJECTS` with the project added (it removes a pair with the same name). */
export function projectsValue(current: string | undefined, name: string, dir: string): string {
  const kept = (current ?? "").split(",").filter((pair) => pair.trim() !== "" && !pair.startsWith(`${name}=`));
  return [...kept, `${name}=${dir}`].join(",");
}

/** The URL of the scene page of a project on a server origin. */
export function scenePageUrl(origin: string, name: string, options: Pick<DevOptions, "scene" | "edit">): string {
  const params = new URLSearchParams({ project: name });
  if (options.scene !== undefined) params.set("scene", options.scene);
  if (options.edit) params.set("edit", "1");
  return `${origin.replace(/\/$/, "")}/scene.html?${params.toString()}`;
}

/** A running dev server. */
export interface DevServer {
  readonly origin: string;
  /** The page of the scene. */
  readonly url: string;
  /** The start screen of the project (the editor page with no scene). */
  readonly start: string;
  readonly project: string;
  readonly name: string;
  close(): Promise<void>;
}

/** The ID (else the folder name) and the first scene of the project document of a folder. */
async function projectFacts(dir: string): Promise<{ id: string; scene: string | undefined }> {
  const folder = dir.split(/[\\/]/).at(-1) ?? "project";
  try {
    const data = (await Bun.file(join(dir, "scenity.project.json")).json()) as { id?: unknown; scenes?: unknown };
    const first = Array.isArray(data.scenes) ? (data.scenes[0] as unknown) : undefined;
    return { id: typeof data.id === "string" ? data.id : folder, scene: typeof first === "string" ? first : undefined };
  } catch {
    return { id: folder, scene: undefined };
  }
}

/**
 * The Vite of the editor folder: the config of the scene page imports this copy, so the server also uses it.
 * A checkout with one copy gives the same module as the dependency of the CLI.
 */
async function editorVite(editor: string): Promise<typeof Vite> {
  try {
    return (await import(pathToFileURL(Bun.resolveSync("vite", editor)).href)) as typeof Vite;
  } catch {
    return import("vite");
  }
}

/** Start the dev server of the scene page for the project of the options. */
export async function startDev(options: DevOptions, cwd: string = process.cwd()): Promise<DevServer> {
  const dir = commandProjectDir(options.project, cwd);
  const editor = editorAppDir(dir);
  const facts = await projectFacts(dir);
  const name = serverName(facts.id);
  // The config of the scene page reads the variable when Vite loads it.
  process.env[SCENE_PROJECTS_ENV] = projectsValue(process.env[SCENE_PROJECTS_ENV], name, dir);
  const { createServer, searchForWorkspaceRoot } = await editorVite(editor);
  const server = await createServer({
    configFile: join(editor, SCENE_CONFIG),
    root: editor,
    cacheDir: join(dir, ".scenity", "vite"),
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      ...(options.port === undefined ? {} : { port: options.port, strictPort: true }),
      fs: { allow: [searchForWorkspaceRoot(editor), dir] },
    },
  });
  await server.listen();
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (origin === undefined) {
    await server.close();
    throw new CommandSetupError("The dev server gave no local URL.");
  }
  const scene = options.scene ?? facts.scene;
  const url = scenePageUrl(origin, name, { ...options, ...(scene === undefined ? {} : { scene }) });
  const start = scenePageUrl(origin, name, { edit: true });
  return { origin, url, start, project: dir, name, close: () => server.close() };
}

/** Wait for SIGINT or SIGTERM. */
function stopSignal(): Promise<string> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve("SIGINT"));
    process.once("SIGTERM", () => resolve("SIGTERM"));
  });
}

/** Run `scenity dev` with the arguments after the word `dev`. It returns when a signal stops the server. */
export async function runDevCommand(argv: readonly string[]): Promise<CommandResult> {
  const options = parseDevArgs(argv);
  if (options === null) return { out: [`usage: ${DEV_USAGE}`], code: 2 };
  let server: DevServer;
  try {
    server = await startDev(options);
  } catch (error) {
    if (error instanceof CommandSetupError) return { out: [error.message], code: 1 };
    throw error;
  }
  const { url, start, origin, project } = server;
  console.log(`${DEV_READY} ${JSON.stringify({ url, start, origin, project })}`);
  console.log(`scenity dev: ${project}`);
  console.log(`  the scene:        ${url}`);
  console.log(`  the start screen: ${start}`);
  // The studio has every project, the Hub and the agents in one place.
  console.log("  every project, the Hub and the agents: scenity studio");
  await stopSignal();
  await server.close();
  return { out: [], code: 0 };
}
