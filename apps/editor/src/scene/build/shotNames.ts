// SPDX-License-Identifier: Apache-2.0
/**
 * The names of the shots of the Shots panel. A shot is `<scene>--<camera>[@<ms>].png` (`<camera>` is `scene` for the
 * camera of the scene). A baseline is `baselines/<platform>/<scene>--<camera>.png`. Pure functions, no DOM.
 */

/** The parts of the name of a shot, or null for another file. */
export function shotParts(file: string): { scene: string; camera: string; at: number | null } | null {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const match = /^(.+)--([^@/]+?)(?:@(\d+))?\.png$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { scene: match[1], camera: match[2], at: match[3] === undefined ? null : Number(match[3]) };
}

/** The scene file of a scene name (the file name with no `.scene.json`), or null. */
export function sceneOfName(scenes: readonly string[], name: string): string | null {
  return scenes.find((scene) => scene.slice(scene.lastIndexOf("/") + 1).replace(/\.scene\.json$/, "") === name) ?? null;
}

/** The `poster` value of a scene for a poster file of the project: the path from the folder of the scene. */
export function posterValue(scene: string, poster: string): string {
  const depth = scene.split("/").length - 1;
  return `${"../".repeat(depth)}${poster}`;
}
