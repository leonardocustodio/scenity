// SPDX-License-Identifier: Apache-2.0
/**
 * The document step of `scenity build`: the project, its scenes, its sequences and its rules files, read with the
 * reader of `@scenity/scene` (migrations and checks) and written in canonical form into the `project` folder of the
 * build.
 *
 * A path of the project that goes out of the project folder (`../../plugins/x/scenes/a.scene.json`) goes to
 * `external/<path with no "../">` in the build, and the copy of the project document names the new path. The copy
 * names the asset folder `build` (`build.assets.output`), where the asset step writes the files and the manifest.
 * The poster image of each scene also goes into the build (posters.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { builtinRegistry, readDocument, type ProjectDocument, type SceneDocument } from "@scenity/scene";
import { writeDocument } from "@scenity/scene/canonical";
import { copyPoster } from "./posters";

/** The asset folder of the project in a build, relative to the `project` folder. */
export const BUILD_ASSETS = "build";

/** The path of a document in the build: the same path, or `external/…` for a path out of the project folder. */
export function buildPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (!parts.includes("..")) return parts.join("/");
  return ["external", ...parts.filter((part) => part !== "..")].join("/");
}

export interface DocumentStep {
  /** The written documents, relative to the `project` folder of the build. */
  readonly files: readonly string[];
  readonly problems: readonly string[];
}

type DocumentKindName = "scene" | "sequence" | "rules";

/** Write the canonical documents of a project into `target` (the `project` folder of the build). */
export function documentStep(dir: string, project: ProjectDocument, target: string): DocumentStep {
  const registry = builtinRegistry();
  const files: string[] = [];
  const problems: string[] = [];
  const copy = (path: string, kind: DocumentKindName): string => {
    const out = buildPath(path);
    const source = join(dir, ...path.split("/"));
    if (!existsSync(source)) {
      problems.push(`the project names ${path}, but the file does not exist`);
      return out;
    }
    const read = readDocument(readFileSync(source, "utf8"), kind, { registry });
    if (!read.ok) {
      const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
      problems.push(`${path} does not read: ${first.join("; ")}`);
      return out;
    }
    let doc = read.doc;
    if (kind === "scene") {
      const poster = copyPoster({ dir, path, out, buildPath }, read.doc as SceneDocument, target);
      if (poster.problem !== null) problems.push(poster.problem);
      if (poster.file !== null) files.push(poster.file);
      doc = poster.doc;
    }
    write(target, out, writeDocument(doc));
    files.push(out);
    return out;
  };
  const scenes = project.scenes.map((path) => copy(path, "scene"));
  const sequences = project.sequences?.map((path) => copy(path, "sequence"));
  const rules = project.rules?.map((item) => (typeof item === "string" ? copy(item, "rules") : item));
  const output = project.build?.assets?.output;
  const build =
    output === undefined || output === BUILD_ASSETS || project.build === undefined
      ? project.build
      : { ...project.build, assets: { ...project.build.assets, output: BUILD_ASSETS } };
  const copied: ProjectDocument = {
    ...project,
    scenes,
    ...(sequences === undefined ? {} : { sequences }),
    ...(rules === undefined ? {} : { rules }),
    ...(build === undefined ? {} : { build }),
  };
  write(target, "scenity.project.json", writeDocument(copied));
  files.unshift("scenity.project.json");
  return { files, problems };
}

function write(target: string, path: string, text: string): void {
  const file = join(target, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
