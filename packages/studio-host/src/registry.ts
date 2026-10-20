// SPDX-License-Identifier: Apache-2.0
/**
 * The registry of the projects of the studio: the recent and pinned projects of the person, with a key for each, and
 * the facts that the Hub shows (the name, the format, the picture, the Git branch, the trust). A remove removes a
 * project from the list only. It never deletes a file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonicalJson } from "@scenity/scene/canonical";
import { EMPTY_SCENE, emptyProject, emptyScene } from "@scenity/cli/templates";
import type { RegistryEntry, UserState } from "./userState";

/** The project file of a project folder. */
export const PROJECT_FILE = "scenity.project.json";
/** The newest major version of the project format that this studio reads. */
export const PROJECT_MAJOR = 1;

/** The parts of a project file that the studio reads. */
export interface ProjectDoc {
  readonly format: string;
  readonly id: string;
  readonly name: string;
  readonly scenes: readonly string[];
  readonly plugins: readonly string[];
  readonly runs: boolean;
}

/** The project file of `dir`, or null when it is missing or the studio cannot read it. */
export function readProjectDoc(dir: string): ProjectDoc | null {
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (typeof doc.format !== "string" || !doc.format.startsWith("scenity.project/")) return null;
    const workbench = (doc.workbench ?? {}) as Record<string, unknown>;
    return {
      format: doc.format,
      id: typeof doc.id === "string" ? doc.id : basename(dir),
      name: typeof doc.name === "string" ? doc.name : basename(dir),
      scenes: Array.isArray(doc.scenes) ? doc.scenes.filter((s): s is string => typeof s === "string") : [],
      plugins: Array.isArray(doc.plugins) ? doc.plugins.filter((s): s is string => typeof s === "string") : [],
      runs: workbench.runs !== undefined,
    };
  } catch {
    return null;
  }
}

/** True when the format of a project is newer than this studio reads. */
export function isNewerFormat(format: string): boolean {
  const major = Number(/\/(\d+)$/.exec(format)?.[1] ?? "0");
  return major > PROJECT_MAJOR;
}

/** The picture of a project for the Hub: the first poster, else the first still (a path relative to the folder). */
export function projectPicture(dir: string): string | null {
  for (const folder of ["posters", "stills"]) {
    const path = join(dir, folder);
    if (!existsSync(path)) continue;
    const file = readdirSync(path)
      .filter((name) => /\.(png|jpe?g|webp|avif)$/i.test(name))
      .sort()[0];
    if (file !== undefined) return `${folder}/${file}`;
  }
  return null;
}

/** The Git branch and the number of changed files of a project folder, or null with no Git. */
export function gitState(dir: string): { branch: string; changed: number } | null {
  const branch = spawnSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (branch.status !== 0) return null;
  const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", timeout: 5000 });
  const changed = status.status === 0 ? status.stdout.split("\n").filter((line) => line.trim() !== "").length : 0;
  return { branch: branch.stdout.trim(), changed };
}

/** A key from a project ID: lower case, `[a-z0-9-]` only. */
export function keyOf(id: string): string {
  const key = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key === "" ? "project" : key;
}

/** What the Hub shows of a project. */
export interface ProjectInfo extends RegistryEntry {
  /** False when the folder is gone (the Hub offers Locate and Remove). */
  readonly exists: boolean;
  readonly id: string | null;
  readonly format: string | null;
  readonly newer: boolean;
  readonly scenes: number;
  readonly picture: string | null;
  readonly git: { branch: string; changed: number } | null;
  readonly trusted: boolean;
  /** True when the project runs code (plugins or runs), so it opens in restricted mode until it is trusted. */
  readonly runsCode: boolean;
}

/** The registry of projects over the user state. */
export class ProjectRegistry {
  constructor(private readonly state: UserState) {}

  entries(): RegistryEntry[] {
    return this.state.registry.read().projects;
  }

  byKey(key: string): RegistryEntry | undefined {
    return this.entries().find((entry) => entry.key === key);
  }

  isTrusted(dir: string): boolean {
    return this.state.trust.read().trusted.includes(resolve(dir));
  }

  /** The projects, pinned first, then the last opened first. */
  list(): ProjectInfo[] {
    return this.entries()
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened.localeCompare(a.lastOpened))
      .map((entry) => this.info(entry));
  }

  info(entry: RegistryEntry): ProjectInfo {
    const doc = readProjectDoc(entry.dir);
    return {
      ...entry,
      exists: doc !== null,
      id: doc?.id ?? null,
      format: doc?.format ?? null,
      newer: doc !== null && isNewerFormat(doc.format),
      scenes: doc?.scenes.length ?? 0,
      picture: doc === null ? null : projectPicture(entry.dir),
      git: doc === null ? null : gitState(entry.dir),
      trusted: this.isTrusted(entry.dir),
      runsCode: doc !== null && (doc.plugins.length > 0 || doc.runs),
    };
  }

  /**
   * Add a project folder (or touch it when it is in the list) and give its entry. Throws for a folder with no project.
   */
  add(dir: string, now = new Date()): RegistryEntry {
    const folder = resolve(dir);
    const doc = readProjectDoc(folder);
    if (doc === null) throw new Error(`${folder} has no ${PROJECT_FILE}`);
    const registry = this.state.registry.read();
    const found = registry.projects.find((entry) => entry.dir === folder);
    const used = new Set(registry.projects.filter((entry) => entry.dir !== folder).map((entry) => entry.key));
    let key = found?.key ?? keyOf(doc.id);
    for (let n = 2; used.has(key); n += 1) key = `${keyOf(doc.id)}-${String(n)}`;
    const entry: RegistryEntry = {
      dir: folder,
      key,
      name: doc.name,
      lastOpened: now.toISOString(),
      pinned: found?.pinned ?? false,
    };
    this.state.registry.write({ ...registry, projects: [...registry.projects.filter((e) => e.dir !== folder), entry] });
    return entry;
  }

  remove(key: string): void {
    this.state.registry.update((r) => ({ ...r, projects: r.projects.filter((entry) => entry.key !== key) }));
  }

  pin(key: string, pinned: boolean): void {
    this.state.registry.update((r) => ({
      ...r,
      projects: r.projects.map((e) => (e.key === key ? { ...e, pinned } : e)),
    }));
  }

  /** Rename a project: the name field of its project file and of the entry. */
  rename(key: string, name: string): void {
    const entry = this.byKey(key);
    if (entry === undefined) throw new Error(`no project ${key}`);
    const file = join(entry.dir, PROJECT_FILE);
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, canonicalJson({ ...doc, name }));
    this.state.registry.update((r) => ({
      ...r,
      projects: r.projects.map((e) => (e.key === key ? { ...e, name } : e)),
    }));
  }

  /** Trust a project folder: its code can run. */
  trust(dir: string): void {
    const folder = resolve(dir);
    this.state.trust.update((t) => ({ ...t, trusted: [...new Set([...t.trusted, folder])].sort() }));
  }
}

/**
 * Make a folder a project: the project file and the scene of the empty template, with the folder name as the
 * ID and the name. Throws when the folder has a project file. The other files of the folder stay.
 */
export function makeProject(dir: string, name: string = basename(resolve(dir))): string {
  const folder = resolve(dir);
  if (existsSync(join(folder, PROJECT_FILE))) throw new Error(`${folder} has a ${PROJECT_FILE}`);
  const id = keyOf(basename(folder));
  mkdirSync(join(folder, "scenes"), { recursive: true });
  writeFileSync(join(folder, PROJECT_FILE), canonicalJson(emptyProject(id, name)));
  if (!existsSync(join(folder, EMPTY_SCENE))) writeFileSync(join(folder, EMPTY_SCENE), canonicalJson(emptyScene(name)));
  return folder;
}
