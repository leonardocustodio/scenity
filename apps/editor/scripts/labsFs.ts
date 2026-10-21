// SPDX-License-Identifier: Apache-2.0
/**
 * The `server.fs` options of the lab dev server. Vite serves only the files under `fs.allow`, and never the
 * files that match `fs.deny`.
 *
 * - The local mode allows the workspace.
 * - The remote mode of the workbench host (packages/workbench-host `remote.ts`) allows only the folders that the lab
 *   page loads: the editor app, the workspace packages that it imports (the `dependencies` of the package.json files,
 *   step by step), the extra folders of the config (the generated contracts and the review records of a plugin) and
 *   the third-party packages in `node_modules`. The repository root, `docs`, `tools`, the other apps and the state
 *   folders stay out.
 * - A project outside the checkout (`SCENITY_PROJECT`) adds its workspace. The local mode allows it, and the
 *   remote mode allows its packages that the lab page imports and its `node_modules`.
 * - Both modes deny the secret files: `.env` files, keys, certificates and the `.git` folders.
 *
 * The host gives its environment to the lab server, so the server knows the remote mode from
 * `SCENITY_WORKBENCH_PUBLIC_ORIGIN`. In the remote mode the server is also behind the token of the host
 * (scripts/labsGate.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defaultProjectDir, resolvePluginEntries } from "@scenity/cli/plugins";

/** The variable that enables the remote mode of the host (packages/workbench-host `remote.ts`). */
export const REMOTE_ORIGIN_ENV = "SCENITY_WORKBENCH_PUBLIC_ORIGIN";

/**
 * The secret files that the server never serves (picomatch patterns). A pattern without a slash matches the file
 * name. The list has the Vite defaults (`.env`, `.env.*`, `*.{crt,pem}`, `.git`) and more key files.
 */
export const SECRET_DENY: readonly string[] = [
  ".env",
  ".env.*",
  "*.{crt,pem,key,p12,pfx,jks,keystore,kdbx}",
  "id_rsa*",
  "id_dsa*",
  "id_ecdsa*",
  "id_ed25519*",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  "**/.git/**",
  "**/.ssh/**",
];

/** The folders of the remote mode under the workspace that are not packages. */
const REMOTE_FOLDERS = ["apps/editor", "node_modules"] as const;

/** The `server.fs` options of Vite. */
export interface LabFsOptions {
  readonly allow: string[];
  readonly deny: string[];
}

type Env = Readonly<Record<string, string | undefined>>;

/** True when the workbench host runs in the remote mode. */
export function isRemote(env: Env): boolean {
  return (env[REMOTE_ORIGIN_ENV]?.trim() ?? "") !== "";
}

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function readPackage(folder: string): PackageJson | null {
  const file = join(folder, "package.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PackageJson) : null;
}

/** The sub-folders of a folder, or none when the folder does not exist. */
function folders(parent: string): string[] {
  return existsSync(parent) ? readdirSync(parent).map((name) => join(parent, name)) : [];
}

/**
 * The folders of the workspace packages by package name: `packages/<name>`, the plugin parts
 * `plugins/<plugin>/<part>` and the SDK packages `plugins/<plugin>/sdk/<name>`.
 */
function workspacePackages(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const plugins = folders(join(root, "plugins")).flatMap(folders);
  const sdk = plugins.filter((folder) => basename(folder) === "sdk").flatMap(folders);
  for (const folder of [...folders(join(root, "packages")), ...plugins, ...sdk]) {
    const pkg = readPackage(folder);
    if (pkg?.name !== undefined) found.set(pkg.name, folder);
  }
  return found;
}

/**
 * The folders of the plugins of the default project of the workspace (the `scenity.project` field of the root
 * package.json). The editor app names no plugin, so its dependencies do not give them. None when the workspace has no
 * default project or a plugin entry does not resolve.
 */
export function projectPluginFolders(root: string): string[] {
  const projectDir = defaultProjectDir(root);
  const file = projectDir === null ? null : join(projectDir, "scenity.project.json");
  if (projectDir === null || file === null || !existsSync(file)) return [];
  const doc = JSON.parse(readFileSync(file, "utf8")) as { readonly plugins?: unknown };
  const entries = Array.isArray(doc.plugins) ? doc.plugins.filter((entry) => typeof entry === "string") : [];
  try {
    // The page never loads a host face: a plugin with only a host face (and its host imports) stays out.
    const pagePlugins = resolvePluginEntries(entries, projectDir).filter(
      (plugin) => plugin.host === undefined || plugin.runtime !== undefined || plugin.editor !== undefined,
    );
    return pagePlugins.map((plugin) => plugin.dir);
  } catch {
    return [];
  }
}

/**
 * The workspace packages that the editor app imports: the workspace `dependencies` and `peerDependencies` of
 * apps/editor and of the plugins of the default project, then of each package that it found, step by step.
 * The dev dependencies stay out: the page does not load them.
 */
export function labPackageFolders(root: string, workspaces: readonly string[] = []): string[] {
  const byName = new Map([...workspaces.flatMap((dir) => [...workspacePackages(dir)]), ...workspacePackages(root)]);
  const plugins = projectPluginFolders(root);
  const seen = new Set<string>(plugins);
  const queue = [join(root, "apps/editor"), ...plugins];
  for (let folder = queue.pop(); folder !== undefined; folder = queue.pop()) {
    const pkg = readPackage(folder);
    for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.peerDependencies })) {
      const target = byName.get(name);
      if (target === undefined || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * The workspace of a project outside the checkout (the nearest folder above it with a package.json that has
 * `workspaces`), else the project folder.
 */
export function projectWorkspace(dir: string): string {
  for (let at = resolve(dir); dirname(at) !== at; at = dirname(at)) {
    const pkg = readPackage(at) as { readonly workspaces?: unknown } | null;
    if (pkg?.workspaces !== undefined) return at;
  }
  return dir;
}

/** The workspaces of the default project of `root` when it is outside the checkout, else none. */
export function outsideWorkspaces(root: string): string[] {
  const project = defaultProjectDir(root);
  if (project === null) return [];
  const rel = relative(resolve(root), project);
  return rel.startsWith("..") || isAbsolute(rel) ? [projectWorkspace(project)] : [];
}

/**
 * The `server.fs` options for the workspace at `root`. `extra` are more folders outside the packages (the generated
 * contracts of a plugin, from vite.config.ts), in both modes. `workspaces` are the workspaces of a project outside the
 * checkout.
 */
export function labFsOptions(
  env: Env,
  root: string,
  extra: readonly string[] = [],
  workspaces: readonly string[] = [],
): LabFsOptions {
  const deny = [...SECRET_DENY];
  if (!isRemote(env)) return { allow: [resolve(root), ...workspaces.map((dir) => resolve(dir)), ...extra], deny };
  const folders = [
    ...REMOTE_FOLDERS.map((folder) => join(root, folder)),
    ...workspaces.map((dir) => join(dir, "node_modules")),
  ];
  return { allow: [...folders, ...extra, ...labPackageFolders(root, workspaces)], deny };
}
