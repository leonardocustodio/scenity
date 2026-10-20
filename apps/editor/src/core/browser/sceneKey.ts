// SPDX-License-Identifier: Apache-2.0
/**
 * The key of a scene: a short hash of the content of the picture of an item (the take, the events, the moment, the
 * camera, the assets). `bun run labs stills` keeps the key of each picture in stills/index.json. The dock puts a mark
 * on a picture when the key of its scene changes. The hash is FNV-1a with 32 bits: a mark, not a security check. This
 * module has no imports, because the Bun tools read it.
 */
export interface KeyedScene {
  readonly take: string;
  readonly events: readonly unknown[];
  readonly moment: number;
  readonly camera: unknown;
  readonly assets: boolean;
}

export function sceneKey(scene: KeyedScene): string {
  const text = JSON.stringify([scene.take, scene.events, Math.round(scene.moment), scene.camera, scene.assets]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
