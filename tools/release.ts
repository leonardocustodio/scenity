// SPDX-License-Identifier: Apache-2.0
/**
 * The release of the public packages to the npm scope `@scenity`.
 *
 * Run from the repo root after `bun install` and `bun run generate`:
 *     bun tools/release.ts check                          # exit 1 on a problem in a manifest of a public package
 *     bun tools/release.ts pack [--out <dir>] [--all]      # the tarballs and publish-plan.json; no write to npm
 *     bun tools/release.ts publish [--out <dir>] [--dry-run] [--all]
 *
 * A package is public when its package.json has no `"private": true`. Each public package ships its TypeScript
 * source: Bun and Vite read the `.ts` and `.vue` files of the `exports` field, so a package has no build step.
 *
 * `pack` packs each package with `bun pm pack`, which writes real versions in place of the `workspace:` and
 * `catalog:` ranges. The tool adds LICENSE and NOTICE to each tarball and checks the manifest in it. An `exports`
 * field in `publishConfig` replaces the `exports` of the tarball (the editor keeps its checkout-only entries). Each
 * module of a tarball imports only files of the tarball and declared packages (release-imports.ts). With no `--all`,
 * the list of packages is the publish plan of Changesets (the versions that npm does not have). `publish` packs, then
 * `changeset publish --from-pack-dir` publishes the tarballs with npm, makes the git tags and writes the output file of
 * the Changesets action. `publish --dry-run` gives each tarball to `npm publish --dry-run` in place of that.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { importProblems } from "./release-imports";

export const ROOT = resolve(import.meta.dir, "..");
/** The default output folder of `pack` and `publish` (Git ignores `.scenity/`). */
export const DEFAULT_OUT = join(ROOT, ".scenity", "release");
export const REPOSITORY_URL = "git+https://github.com/leonardocustodio/scenity.git";
export const LICENCE = "Apache-2.0";
export const AUTHOR = "Leonardo Amoroso Custodio";
/** The files of the repo root that each tarball gets (Apache-2.0 §4: the licence and the NOTICE file). */
export const LEGAL_FILES = ["LICENSE", "NOTICE"] as const;
/** The dependency fields that a consumer installs. */
const INSTALLED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
/** The dependency fields that the tarball must give with real versions. */
const RANGE_FIELDS = [...INSTALLED_FIELDS, "devDependencies"] as const;
/** The range forms that only a workspace can read. */
const LOCAL_RANGE = /^(workspace|catalog|link|file|portal):/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export type Manifest = Readonly<Record<string, unknown>> & {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
};

export interface WorkspacePackage {
  /** The folder relative to the repo root, with "/". */
  readonly dir: string;
  readonly manifest: Manifest;
}

/** One entry of a publish plan of Changesets (format 1). */
export interface Release {
  readonly kind: "publish" | "tag-only";
  readonly name: string;
  readonly version: string;
  readonly access?: string;
  readonly tag?: string;
  readonly tarball?: { readonly path: string; readonly integrity: string };
}

function readJson(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** The packages of the workspace patterns of the root package.json, in path order. */
export function workspacePackages(root = ROOT): WorkspacePackage[] {
  const field = readJson(join(root, "package.json")).workspaces as { packages?: string[] } | string[] | undefined;
  const patterns = Array.isArray(field) ? field : (field?.packages ?? []);
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })) {
      if (!file.split("/").includes("node_modules")) dirs.add(file.slice(0, -"/package.json".length));
    }
  }
  return [...dirs].sort().map((dir) => ({ dir, manifest: readJson(join(root, dir, "package.json")) }));
}

/** The public packages of the workspace. */
export function publicPackages(root = ROOT): WorkspacePackage[] {
  return workspacePackages(root).filter((pkg) => pkg.manifest.private !== true);
}

function dependencyNames(manifest: Manifest, fields: readonly string[]): string[] {
  return fields.flatMap((field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}));
}

/** The packages in an order with each `@scenity` dependency before the packages that use it. */
export function releaseOrder(packages: readonly WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name ?? pkg.dir, pkg]));
  const done = new Set<string>();
  const order: WorkspacePackage[] = [];
  const visit = (name: string, path: readonly string[]): void => {
    const pkg = byName.get(name);
    if (pkg === undefined || done.has(name)) return;
    if (path.includes(name)) throw new Error(`a dependency cycle: ${[...path, name].join(" -> ")}`);
    for (const dep of dependencyNames(pkg.manifest, INSTALLED_FIELDS).sort()) visit(dep, [...path, name]);
    done.add(name);
    order.push(pkg);
  };
  for (const name of [...byName.keys()].sort()) visit(name, []);
  return order;
}

/** The entries of the dependency fields that have a range that only a workspace can read. */
export function localRanges(manifest: Manifest): string[] {
  return RANGE_FIELDS.flatMap((field) =>
    Object.entries((manifest[field] as Record<string, string> | undefined) ?? {})
      .filter(([, range]) => LOCAL_RANGE.test(range))
      .map(([name, range]) => `${field}.${name}: ${range}`),
  );
}

/** The file targets of an `exports` or `bin` value (each condition, each subpath). */
export function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(targetsOf);
}

/** The manifest of the tarball: the fields of `publishConfig` that replace a field (`exports`) go to the top. */
export function publishedManifest(manifest: Manifest): Manifest {
  const config = manifest.publishConfig as Record<string, unknown> | undefined;
  if (config?.exports === undefined) return manifest;
  const { exports, ...rest } = config;
  return { ...manifest, exports, publishConfig: rest };
}

/** True when an entry of the `files` field holds a file target (a path with or without "./"). */
export function covered(target: string, files: readonly string[]): boolean {
  const path = target.replace(/^\.\//, "");
  return files.some((entry) => {
    const item = entry.replace(/^\.\//, "").replace(/\/$/, "");
    if (item.includes("*")) return new Bun.Glob(item).match(path);
    return path === item || path.startsWith(`${item}/`);
  });
}

function manifestProblems(pkg: WorkspacePackage, publicNames: ReadonlySet<string>): string[] {
  const { dir, manifest } = pkg;
  const at = (text: string): string => `${dir}: ${text}`;
  const problems: string[] = [];
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) problems.push(at("no semver version"));
  if (manifest.license !== LICENCE) problems.push(at(`license is not ${LICENCE}`));
  if (manifest.author !== AUTHOR) problems.push(at(`author is not ${AUTHOR}`));
  const repository = manifest.repository as { url?: unknown; directory?: unknown } | undefined;
  if (repository?.url !== REPOSITORY_URL || repository.directory !== dir) {
    problems.push(at(`repository is not { url: ${REPOSITORY_URL}, directory: ${dir} }`));
  }
  if ((manifest.publishConfig as { access?: unknown } | undefined)?.access !== "public") {
    problems.push(at('publishConfig.access is not "public"'));
  }
  const files = Array.isArray(manifest.files) ? (manifest.files as string[]) : [];
  if (files.length === 0) problems.push(at("no files field"));
  const published = publishedManifest(manifest);
  for (const target of [...targetsOf(published.exports), ...targetsOf(published.bin)]) {
    // A pattern target needs its folder in the files field (`./src/core/*.ts` needs `src` or `src/core`).
    const path = target.includes("*") ? target.slice(0, target.indexOf("*")).replace(/\/[^/]*$/, "") : target;
    // npm always packs package.json.
    if (path !== "./package.json" && !covered(path, files)) problems.push(at(`the files field leaves out ${target}`));
  }
  for (const name of dependencyNames(manifest, INSTALLED_FIELDS)) {
    if (name.startsWith("@scenity/") && !publicNames.has(name)) problems.push(at(`depends on private ${name}`));
  }
  return problems;
}

/** The fixed groups of the Changesets config. */
export function fixedGroups(root = ROOT): string[][] {
  const config = readJson(join(root, ".changeset", "config.json")) as { fixed?: string[][] };
  return config.fixed ?? [];
}

/** The problems of the manifests of the public packages and of the fixed group of Changesets. */
export function checkManifests(root = ROOT): string[] {
  const packages = publicPackages(root);
  const names = new Set(packages.map((pkg) => pkg.manifest.name ?? pkg.dir));
  const problems = packages.flatMap((pkg) => manifestProblems(pkg, names));
  const fixed = new Set(fixedGroups(root).flat());
  for (const name of names) if (!fixed.has(name)) problems.push(`.changeset/config.json: ${name} is in no fixed group`);
  for (const name of fixed) if (!names.has(name)) problems.push(`.changeset/config.json: ${name} is not public`);
  return problems;
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} (in ${cwd}) failed: ${`${result.stderr}${result.stdout}`.trim()}`);
  }
  return result.stdout;
}

/** The file name of a tarball, as Changesets names it. */
export function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/** The problems of the unpacked package folder of a tarball. */
export function tarballProblems(dir: string, label: string): string[] {
  const manifest = readJson(join(dir, "package.json"));
  const problems = localRanges(manifest).map((entry) => `${label}: ${entry}`);
  for (const target of [...targetsOf(manifest.exports), ...targetsOf(manifest.bin)]) {
    if (!target.includes("*") && !existsSync(join(dir, target))) problems.push(`${label}: no file ${target}`);
    // An export pattern "*" can hold "/", so the glob takes any depth.
    const pattern = target.replace(/^\.\//, "").replace("*", "**/*");
    if (target.includes("*") && new Bun.Glob(pattern).scanSync({ cwd: dir }).next().done === true) {
      problems.push(`${label}: no file for ${target}`);
    }
  }
  for (const name of LEGAL_FILES) if (!existsSync(join(dir, name))) problems.push(`${label}: no ${name}`);
  return [...problems, ...importProblems(dir, label)];
}

/**
 * Pack one package into `<out>/packages`: `bun pm pack`, then LICENSE and NOTICE go in. Throws on a problem of the
 * tarball. The result is the tarball path relative to `out` and its integrity (the form of Changesets).
 */
export function packPackage(pkg: WorkspacePackage, out: string, root = ROOT): { path: string; integrity: string } {
  const name = pkg.manifest.name ?? pkg.dir;
  const staging = join(out, "staging", tarballName(name, String(pkg.manifest.version)).replace(/\.tgz$/, ""));
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const packed = run("bun", ["pm", "pack", "--destination", staging, "--quiet"], join(root, pkg.dir)).trim();
  const tarball = resolve(staging, basename(packed.split("\n").at(-1) ?? ""));
  run("tar", ["-xzf", tarball, "-C", staging], root);
  rmSync(tarball);
  for (const file of LEGAL_FILES) copyFileSync(join(root, file), join(staging, "package", file));
  const manifestFile = join(staging, "package", "package.json");
  const manifest = publishedManifest(readJson(manifestFile));
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const problems = tarballProblems(join(staging, "package"), name);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const path = join("packages", tarballName(name, String(pkg.manifest.version)));
  mkdirSync(join(out, "packages"), { recursive: true });
  run("tar", ["--no-xattrs", "-czf", join(out, path), "-C", staging, "package"], root);
  const integrity = `sha256-${createHash("sha256")
    .update(readFileSync(join(out, path)))
    .digest("base64")}`;
  return { path, integrity };
}

/** The publish plan: each public package (`all`), else the plan of `changeset publish-plan` (it asks npm). */
export function publishPlan(out: string, all: boolean, root = ROOT): Release[][] {
  if (all) {
    const releases = releaseOrder(publicPackages(root)).map((pkg) => ({
      kind: "publish" as const,
      name: pkg.manifest.name ?? pkg.dir,
      version: String(pkg.manifest.version),
      access: "public",
      tag: "latest",
    }));
    return releases.length === 0 ? [] : [releases];
  }
  const file = join(out, "plan.json");
  run(join(root, "node_modules", ".bin", "changeset"), ["publish-plan", "--output", file], root);
  return (JSON.parse(readFileSync(file, "utf8")) as { plan: Release[][] }).plan;
}

/** Pack the releases of the plan into `out` and write `out/publish-plan.json`. The result is the packed plan. */
export function packRelease(out: string, all: boolean, root = ROOT, log = console.log): Release[][] {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const plan = publishPlan(out, all, root);
  const byName = new Map(publicPackages(root).map((pkg) => [pkg.manifest.name, pkg]));
  const packed = plan.map((chunk) =>
    chunk.map((release) => {
      const pkg = byName.get(release.name);
      if (release.kind !== "publish" || pkg === undefined) return release;
      const tarball = packPackage(pkg, out, root);
      log(`release: packed ${release.name}@${release.version} -> ${relative(root, join(out, tarball.path))}`);
      return { ...release, tarball };
    }),
  );
  rmSync(join(out, "staging"), { recursive: true, force: true });
  writeFileSync(join(out, "publish-plan.json"), `${JSON.stringify({ version: 1, plan: packed }, null, 2)}\n`);
  return packed;
}

/** Publish the packed plan: `npm publish --dry-run` per tarball, else `changeset publish --from-pack-dir`. */
export function publishRelease(out: string, dryRun: boolean, all: boolean, root = ROOT, log = console.log): void {
  const plan = packRelease(out, all, root, log);
  const releases = plan.flat().filter((release) => release.tarball !== undefined);
  if (releases.length === 0) {
    log("release: npm has each version; nothing to publish");
    return;
  }
  if (!dryRun) {
    const result = spawnSync(join(root, "node_modules", ".bin", "changeset"), ["publish", "--from-pack-dir", out], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`changeset publish failed with exit code ${String(result.status)}`);
    return;
  }
  for (const release of releases) {
    const tarball = join(out, release.tarball?.path ?? "");
    run("npm", ["publish", tarball, "--dry-run", "--access", "public", "--tag", release.tag ?? "latest"], root);
    log(`release: dry run of ${release.name}@${release.version} passed`);
  }
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function main(argv: readonly string[]): number {
  const [command] = argv;
  const out = resolve(optionValue(argv, "--out") ?? DEFAULT_OUT);
  const all = argv.includes("--all");
  if (command === "check") {
    const problems = checkManifests();
    for (const problem of problems) console.error(`release: ${problem}`);
    console.log(`release: ${String(publicPackages().length)} public packages; ${String(problems.length)} problems`);
    return problems.length === 0 ? 0 : 1;
  }
  if (command === "pack" || command === "publish") {
    const problems = checkManifests();
    if (problems.length > 0) {
      for (const problem of problems) console.error(`release: ${problem}`);
      return 1;
    }
    if (command === "pack") packRelease(out, all);
    else publishRelease(out, argv.includes("--dry-run"), all);
    const tarballs = existsSync(join(out, "packages")) ? readdirSync(join(out, "packages")).length : 0;
    console.log(`release: ${String(tarballs)} tarballs in ${out}`);
    return 0;
  }
  console.error("usage: bun tools/release.ts check | pack [--out <dir>] [--all] | publish [--out <dir>] [--dry-run]");
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
