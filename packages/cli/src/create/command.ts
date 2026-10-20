// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity create`:
 *
 *   scenity create <name> [--template empty|showroom|sample:<name> | --from <folder>] [--version <range>] [--install]
 *     [--json]
 *
 * It makes the folder `<name>` (relative to the work folder) with a project from a template (templates.ts) or from a
 * copy of a project folder (folder.ts), a `.gitignore` and a `package.json` (package.ts). The project ID is the last
 * part of the name. A folder that exists and is not empty stops the command. `--install` links the packages of the
 * checkout and runs `bun install`. The exit code: 0, 1 for a setup failure, 2 for a usage error.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ID_PATTERN } from "@scenity/scene";
import { readArgs, type CommandResult } from "../args";
import { checkoutRoot } from "../workspace";
import { folderTemplate } from "./folder";
import { commandRange, installSteps, PACKAGE_FOLDERS, projectPackage, runInstall } from "./package";
import { SAMPLE_TEMPLATES, sampleOf, sampleTemplate } from "./sample";
import type { FetchFile } from "./showroom";
import {
  emptyTemplate,
  GITIGNORE,
  showroomTemplate,
  TEMPLATES,
  type TemplateFiles,
  type TemplateName,
} from "./templates";

export const CREATE_USAGE =
  "scenity create <name> [--template empty|showroom|sample:<name> | --from <folder>] [--version <range>] [--install] [--json]";

export const CREATE_HELP = [
  `usage: ${CREATE_USAGE}`,
  "Make a new project folder <name>: scenity.project.json, a scene, the assets and rights folders, a .gitignore",
  "and a package.json. --template: empty (default; a floor, a box, two lights, a camera) or showroom (the",
  "documents of samples/showroom; its CC0 sources come from the checkout, else from Poly Haven with a hash check;",
  "no asset build: scenity build writes it) or sample:<name> (a copy of a sample of the checkout:",
  `${SAMPLE_TEMPLATES.join(", ")}; its plugin packages are linked too). --from <folder>: a copy of a project folder (a`,
  "template of the studio) with no outputs and no local state, and the dependencies of its package.json.",
  "The package.json links the packages of this checkout",
  "(link:@scenity/<name>); --version <range> uses a published version (the default of an installed command: its",
  "own version). --install runs `bun link` in the package folders (only for the links) and `bun install`.",
];

export interface CreateOptions {
  /** The folder of the new project (relative to the work folder, or absolute). */
  readonly name: string;
  /** A template name, or `sample:<name>`. */
  readonly template: TemplateName | `sample:${string}`;
  /** A project folder to copy in place of the template, or null. */
  readonly from?: string | null;
  /** A published version range, or null for the links of the checkout. */
  readonly version: string | null;
  readonly install: boolean;
}

/** The options of the arguments after the word `create`, or null for a usage error. */
export function parseCreateArgs(argv: readonly string[]): { options: CreateOptions; json: boolean } | null {
  const args = readArgs(argv, ["--template", "--version", "--from"], ["--install", "--json"]);
  if (args?.plain.length !== 1) return null;
  if (args.values.from !== undefined && args.values.template !== undefined) return null;
  const template = args.values.template ?? "empty";
  if (!(TEMPLATES as readonly string[]).includes(template) && sampleOf(template) === null) return null;
  const options: CreateOptions = {
    name: args.plain[0] ?? "",
    template: template as CreateOptions["template"],
    version: args.values.version ?? null,
    install: args.flags.has("--install"),
    ...(args.values.from === undefined ? {} : { from: args.values.from }),
  };
  return { options, json: args.flags.has("--json") };
}

/** The result of a create. */
export interface CreateResult {
  readonly dir: string;
  readonly id: string;
  /** The template name, or `folder` for `--from`. */
  readonly template: CreateOptions["template"] | "folder";
  readonly files: readonly string[];
  readonly linked: boolean;
  readonly installed: boolean;
}

/** The files of a template, with the dependencies and the package folders to link of a sample template. */
interface TemplateParts {
  readonly files: TemplateFiles;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly links: readonly string[];
}

/**
 * The files of the template of the options. The showroom copies its sources from the checkout, else downloads them; a
 * sample template needs the checkout.
 */
async function templateParts(
  options: CreateOptions,
  id: string,
  checkout: string | null,
  log: (text: string) => void,
  download: FetchFile | undefined,
): Promise<TemplateParts> {
  if (options.from != null) {
    try {
      return folderTemplate(resolve(options.from), id, id, checkout);
    } catch (error) {
      throw new CreateError(`The folder template: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const sample = sampleOf(options.template);
  if (sample !== null) {
    if (checkout === null) throw new CreateError(`The template ${options.template} needs a Scenity checkout.`);
    return sampleTemplate(checkout, sample, id, id);
  }
  return { files: await templateFiles(options, id, checkout, log, download), dependencies: {}, links: [] };
}

/** The files of the empty or the showroom template. */
async function templateFiles(
  options: CreateOptions,
  id: string,
  checkout: string | null,
  log: (text: string) => void,
  download: FetchFile | undefined,
): Promise<TemplateFiles> {
  if (options.template === "empty") return emptyTemplate(id, id);
  const sampleDir = checkout === null ? null : join(checkout, "samples", "showroom");
  try {
    return await showroomTemplate(id, id, { sampleDir, log, ...(download === undefined ? {} : { download }) });
  } catch (error) {
    throw new CreateError(`The showroom template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A setup problem of a create. */
export class CreateError extends Error {}

/** Make the project folder. `cwd` is the folder of a relative name; `download` replaces the download of a source file.
 * */
export async function createProject(
  options: CreateOptions,
  cwd: string = process.cwd(),
  log: (text: string) => void = () => undefined,
  download?: FetchFile,
): Promise<CreateResult> {
  const dir = resolve(cwd, options.name);
  const id = basename(dir);
  if (!ID_PATTERN.test(id)) {
    throw new CreateError(`"${id}" is not a project ID: use 1 to 64 letters, digits, "_" or "-".`);
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new CreateError(`${dir} exists and is not empty.`);
  const checkout = checkoutRoot();
  // An installed command has no checkout to link, so the project gets the version of the command.
  const version = options.version ?? (checkout === null ? commandRange() : null);
  const parts = await templateParts(options, id, checkout, log, download);
  const files = parts.files;
  if (!files.has(".gitignore")) files.set(".gitignore", GITIGNORE);
  files.set("package.json", projectPackage(id, version, parts.dependencies));
  for (const [path, data] of files) {
    const file = join(dir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  const linked = version === null;
  if (options.install) {
    const failure = runInstall(installSteps(checkout, dir, linked, parts.links), log);
    if (failure !== null) throw new CreateError(failure);
  }
  const template = options.from == null ? options.template : "folder";
  return { dir, id, template, files: [...files.keys()].sort(), linked, installed: options.install };
}

/** The lines after a create: the folder and the next steps. */
export function createText(result: CreateResult, cwd: string): string[] {
  const folder = relative(cwd, result.dir) || ".";
  const lines = [`scenity create: made ${folder} (${result.template}, ${String(result.files.length)} files)`, "next:"];
  lines.push(`  cd ${folder}`);
  if (!result.installed && result.linked) {
    const folders = Object.values(PACKAGE_FOLDERS).join(", ");
    lines.push(`  bun link     (once in each of ${folders} of the checkout)`);
  }
  if (!result.installed) lines.push("  bun install");
  lines.push("  bun run dev  (scenity dev: the scene page with the editor)");
  return lines;
}

/** Run `scenity create` with the arguments after the word `create`. */
export async function runCreateCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseCreateArgs(argv);
  if (parsed === null) return { out: [`usage: ${CREATE_USAGE}`], code: 2 };
  const cwd = process.cwd();
  try {
    const result = await createProject(parsed.options, cwd, (text) => console.error(text));
    const out = parsed.json ? [JSON.stringify(result, null, 2)] : createText(result, cwd);
    return { out, code: 0 };
  } catch (error) {
    if (!(error instanceof CreateError)) throw error;
    return { out: [error.message], code: 1 };
  }
}
