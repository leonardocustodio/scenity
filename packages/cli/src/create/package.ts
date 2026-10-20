// SPDX-License-Identifier: Apache-2.0
/**
 * The `package.json` of a new project and the links to the packages of the checkout.
 *
 * A `file:` dependency of a checkout package does not install: the package.json files of the workspace use the
 * `workspace:` and `catalog:` versions. So a project outside the checkout uses the links of Bun:
 *
 * 1. `bun link` in each package folder of the checkout records the package in the link folder of Bun;
 * 2. the project depends on `link:@scenity/<name>`, and `bun install` makes `node_modules/@scenity/<name>` a link to
 *    the package folder, and `node_modules/.bin/scenity` a link to the command.
 *
 * Bun resolves a linked module from its real path, so the imports of a package come from the checkout and its
 * `node_modules`. With `--version <range>` the project depends on a published version in place of the links, and an
 * installed command (no checkout) uses the range of its own version.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The packages of a new project: the command, the documents, the runtime (for the project plugins) and the editor
 * (the scene page of `scenity dev`).
 */
export const PROJECT_PACKAGES = ["@scenity/cli", "@scenity/scene", "@scenity/runtime", "@scenity/editor"] as const;

/** The folder of each package in the checkout. */
export const PACKAGE_FOLDERS: Readonly<Record<(typeof PROJECT_PACKAGES)[number], string>> = {
  "@scenity/cli": "packages/cli",
  "@scenity/scene": "packages/scene",
  "@scenity/runtime": "packages/runtime",
  "@scenity/editor": "apps/editor",
};

/** The version of each package: `link:<name>`, or the range of a published version. */
export function dependencySpecs(version: string | null): Record<string, string> {
  return Object.fromEntries(PROJECT_PACKAGES.map((name) => [name, version ?? `link:${name}`]));
}

/** The range of the version of this command (`^<version>` of its package.json). */
export function commandRange(): string {
  const file = join(import.meta.dir, "..", "..", "package.json");
  return `^${(JSON.parse(readFileSync(file, "utf8")) as { version: string }).version}`;
}

/**
 * The package.json of a new project. `scenity.project` makes the folder the default project of the commands. `extra`
 * adds dependencies (the plugins of a sample template).
 */
export function projectPackage(
  id: string,
  version: string | null,
  extra: Readonly<Record<string, string>> = {},
): string {
  const data = {
    name: id.toLowerCase(),
    private: true,
    type: "module",
    scripts: {
      dev: "scenity dev",
      build: "scenity build",
      check: "scenity check",
      verify: "scenity verify",
    },
    dependencies: { ...extra, ...dependencySpecs(version) },
    scenity: { project: "." },
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** One step of the install: the work folder and the command line. */
export interface InstallStep {
  readonly cwd: string;
  readonly args: readonly string[];
}

/**
 * The steps of `create --install`: `bun link` in each package folder (only for links), then `bun install`. `extra`
 * names more package folders to link (the plugin packages of a sample template).
 */
export function installSteps(
  checkout: string | null,
  projectDir: string,
  linked: boolean,
  extra: readonly string[] = [],
): InstallStep[] {
  const core = linked && checkout !== null ? PROJECT_PACKAGES.map((name) => join(checkout, PACKAGE_FOLDERS[name])) : [];
  const links = [...core, ...extra].map((cwd) => ({ cwd, args: ["link"] }));
  return [...links, { cwd: projectDir, args: ["install"] }];
}

/** Run the steps with the Bun of this process. The result is the first failure, or null. */
export function runInstall(steps: readonly InstallStep[], log: (text: string) => void): string | null {
  for (const step of steps) {
    log(`scenity create: bun ${step.args.join(" ")} (in ${step.cwd})`);
    const run = spawnSync(process.execPath, [...step.args], { cwd: step.cwd, encoding: "utf8" });
    if (run.status !== 0) {
      const text = `${run.stderr}${run.stdout}`.trim().split("\n").slice(-3).join(" ");
      return `bun ${step.args.join(" ")} in ${step.cwd} failed: ${text}`;
    }
  }
  return null;
}
