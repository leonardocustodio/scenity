// SPDX-License-Identifier: Apache-2.0
/**
 * The posters of `scenity build`: the document step copies the poster image of each scene (the `poster` field, a path
 * relative to the scene file) into the `project` folder of the build. The poster goes to its build path (`external/…`
 * for a path out of the project folder, as a document), and the copy of the scene names the poster relative to the new
 * place of the scene.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { SceneDocument } from "@scenity/scene";

/** The image types of a poster. */
const POSTER_TYPES = [".webp", ".png", ".jpg", ".jpeg", ".avif"];

export interface PosterCopy {
  /** The scene for the build: the same document, or a document with the new poster path. */
  readonly doc: SceneDocument;
  /** The copied poster, relative to the `project` folder of the build, or null. */
  readonly file: string | null;
  readonly problem: string | null;
}

/** Where a scene is: its path in the project folder `dir`, and its path in the build (`buildPath` gives each path). */
export interface ScenePlace {
  readonly dir: string;
  readonly path: string;
  readonly out: string;
  readonly buildPath: (path: string) => string;
}

/** Copy the poster of a scene into `target`, the `project` folder of the build. */
export function copyPoster(place: ScenePlace, doc: SceneDocument, target: string) {
  const { dir, path: scenePath, out: sceneOut } = place;
  const poster = doc.poster;
  if (poster === undefined) return { doc, file: null, problem: null } satisfies PosterCopy;
  const source = posix.join(posix.dirname(scenePath), poster);
  const fail = (problem: string): PosterCopy => ({ doc, file: null, problem });
  if (!POSTER_TYPES.some((type) => poster.toLowerCase().endsWith(type))) {
    return fail(`${scenePath} names the poster ${poster}, which is not a WebP, PNG, JPEG or AVIF image`);
  }
  const from = join(dir, ...source.split("/"));
  if (!existsSync(from)) return fail(`${scenePath} names the poster ${poster}, but the file does not exist`);
  const file = place.buildPath(source);
  const to = join(target, ...file.split("/"));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  const moved = posix.relative(posix.dirname(sceneOut), file);
  const copy: PosterCopy = { doc: moved === poster ? doc : { ...doc, poster: moved }, file, problem: null };
  return copy;
}
