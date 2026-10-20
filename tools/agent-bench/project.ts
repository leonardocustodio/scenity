// SPDX-License-Identifier: Apache-2.0
/**
 * The project of one case of the agent benchmark: a copy of a sample in a run folder, with
 * the docs that the agent may read and the read and write helpers of the checks.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The root of the checkout. */
export const CHECKOUT = resolve(import.meta.dir, "..", "..");
/** The command line of the `scenity` command of the checkout. */
export const SCENITY = ["bun", join(CHECKOUT, "packages", "cli", "src", "cli.ts")];
/** The docs that go into the project, so the agent reads them with no access outside the project. */
const DOCS = ["formats.md", "plugins.md", "editor.md", "cli.md"];
/** Folders of a sample that are outputs or state, not sources. */
const SKIPPED = new Set(["dist", ".scenity", "node_modules"]);

export type Json = Record<string, unknown>;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Entity {
  readonly name?: string;
  readonly parent: string | null;
  readonly index?: number;
  readonly tags?: readonly string[];
  readonly components: Record<string, Json>;
}

export interface SceneDoc {
  readonly environment?: Json;
  readonly entities: Record<string, Entity>;
}

/** Set the position of the entity `id` of a scene. The other transform values stay. */
export function setPosition(scene: SceneDoc, id: string, position: Vec3): void {
  const entity = scene.entities[id];
  if (entity === undefined) throw new Error(`no entity ${id}`);
  entity.components.transform = { ...entity.components.transform, position };
}

/** The value of the component `id` of an entity of a scene, for a change in place. */
export function valueOf(scene: SceneDoc, entity: string, id: string): Json {
  const value = scene.entities[entity]?.components[id];
  if (value === undefined) throw new Error(`no component ${id} on ${entity}`);
  return value;
}

/** Add `tag` to the tags of the entity `id`. */
export function addTag(scene: SceneDoc, id: string, tag: string): void {
  const entity = scene.entities[id];
  if (entity === undefined) throw new Error(`no entity ${id}`);
  scene.entities[id] = { ...entity, tags: [...(entity.tags ?? []), tag] };
}

/** The project of a case: a folder with its documents. */
export class BenchProject {
  constructor(readonly dir: string) {}

  path(file: string): string {
    return join(this.dir, file);
  }

  exists(file: string): boolean {
    return existsSync(this.path(file));
  }

  read<T = Json>(file: string): T {
    return JSON.parse(readFileSync(this.path(file), "utf8")) as T;
  }

  write(file: string, data: unknown): void {
    writeFileSync(this.path(file), `${JSON.stringify(data, null, 2)}\n`);
  }

  text(file: string): string {
    return readFileSync(this.path(file), "utf8");
  }

  project(): Json {
    return this.read("scenity.project.json");
  }

  /** The scene at `file`, else the first scene of the project. */
  scene(file?: string): SceneDoc {
    return this.read<SceneDoc>(file ?? (this.project().scenes as string[])[0] ?? "");
  }

  /** Change the scene at `file` with `change`, and write it. */
  editScene(file: string, change: (scene: SceneDoc) => void): void {
    const scene = this.scene(file);
    change(scene);
    this.write(file, scene);
  }

  /** The files under `folder` (relative paths), in name order. */
  files(folder = ""): string[] {
    const out: string[] = [];
    const walk = (rel: string): void => {
      for (const entry of readdirSync(this.path(rel), { withFileTypes: true })) {
        const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!SKIPPED.has(entry.name)) walk(child);
        } else out.push(child);
      }
    };
    walk(folder);
    return out.sort();
  }
}

/**
 * Copy the sample `name` to `dir` (it must not exist) with no outputs. Each plugin folder of the copy gets a link to
 * the node_modules of its source, so its imports resolve. The docs of the checkout go to `.bench/docs`.
 */
export function copySample(name: string, dir: string): BenchProject {
  const source = join(CHECKOUT, "samples", name);
  if (existsSync(dir)) throw new Error(`the run folder ${dir} exists`);
  cpSync(source, dir, { recursive: true, filter: (path) => !SKIPPED.has(path.split("/").at(-1) ?? "") });
  const plugins = join(source, "plugins");
  if (existsSync(plugins)) {
    for (const plugin of readdirSync(plugins)) {
      const modules = join(plugins, plugin, "node_modules");
      if (existsSync(modules)) symlinkSync(modules, join(dir, "plugins", plugin, "node_modules"), "dir");
    }
  }
  const docs = join(dir, ".bench", "docs");
  mkdirSync(docs, { recursive: true });
  for (const doc of DOCS) cpSync(join(CHECKOUT, "docs", doc), join(docs, doc));
  return new BenchProject(dir);
}
