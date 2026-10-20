// SPDX-License-Identifier: Apache-2.0
/**
 * The change of a shared material in place (the material editor). The values of a new material of the same type go
 * into the material that the users hold, so no user must change its mesh.
 *
 * - The texture copy of a slot stays when the new copy has the same image, colour space, repeat and offset. Else the
 *   new copy goes in, and the function disposes the previous copy.
 * - The material compiles again only when a part of its program changes: a texture slot, the transparency, the
 *   alpha test, the flat shading or the side. A change of a colour or a number needs no new program.
 */
import type { Material, Texture } from "three";
import { materialTextures } from "./assets";

/** The texture properties of a three.js material that `makeMaterial` sets. */
const MAP_PROPERTIES = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap"];

type Values = Record<string, unknown>;

/** True when two texture copies show the same pixels in the same way. */
function sameTexture(a: Texture, b: Texture): boolean {
  return (
    a.source === b.source && a.colorSpace === b.colorSpace && a.repeat.equals(b.repeat) && a.offset.equals(b.offset)
  );
}

/** The parts of a material that change its program. */
function programKey(material: Material): string {
  const values = material as unknown as Values;
  const maps = MAP_PROPERTIES.map((key) => (values[key] ? "1" : "0")).join("");
  const flat = values.flatShading === true ? "1" : "0";
  return `${maps}|${String(material.transparent)}|${String(material.alphaTest > 0)}|${flat}|${String(material.side)}`;
}

/**
 * Put the values of `fresh` into `target` (a material of the same type) and dispose `fresh`. `target` keeps each
 * texture copy that `fresh` has in the same form. It takes the other copies of `fresh`.
 */
export function updateMaterial(target: Material, fresh: Material): void {
  if (target.type !== fresh.type) throw new Error(`a ${target.type} material cannot take ${fresh.type} values`);
  const before = programKey(target);
  const own = target as unknown as Values;
  const next = fresh as unknown as Values;
  const kept = new Map<string, Texture>();
  for (const key of MAP_PROPERTIES) {
    const old = own[key] as Texture | null | undefined;
    const now = next[key] as Texture | null | undefined;
    if (old && now && sameTexture(old, now)) kept.set(key, old);
  }
  const oldTextures = materialTextures(target);
  target.copy(fresh);
  for (const [key, texture] of kept) {
    (next[key] as Texture).dispose();
    own[key] = texture;
  }
  const now = new Set(materialTextures(target));
  for (const texture of oldTextures) if (!now.has(texture)) texture.dispose();
  // `fresh` gave its texture copies to `target`: dispose only the material itself.
  fresh.dispose();
  if (programKey(target) !== before) target.needsUpdate = true;
}
