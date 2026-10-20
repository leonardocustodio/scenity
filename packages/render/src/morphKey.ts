// SPDX-License-Identifier: Apache-2.0
/**
 * The morph targets of quantized meshes on WebGPU.
 *
 * The WebGPU renderer of three.js (r186) shares one node state (the shader, its uniforms and its textures) between
 * the render objects with the same cache key. The geometry part of that key names each morph target by `attribute.id`
 * ("only if the targets are all equal the texture and thus the `morphReference` can be shared"). A
 * `BufferAttribute` has an `id`; an `InterleavedBufferAttribute` has none. The build quantizes the meshes (meshopt,
 * KHR_mesh_quantization), so the morph targets of a character model are interleaved attributes, and the key of every
 * morph target is "undefined". Then two meshes of the character with the same material settings share one node state:
 * the first mesh that draws gives its morph texture to the other. The head and the chest drew with the morph texture
 * of a small mesh without deltas, so `jaw_open`, `eyes_closed`, `chest_rise` and the other morph targets did nothing.
 *
 * `keyInterleavedAttributes` gives each interleaved attribute its own id, so the key changes with the morph targets
 * as for a `BufferAttribute`. Only the WebGPU backend loads this module: WebGLRenderer keeps its morph textures per
 * geometry and reads no attribute id.
 */
import { InterleavedBufferAttribute } from "three";

/** The ids of the interleaved attributes. A string id never equals the number id of a `BufferAttribute`. */
const IDS = new WeakMap<object, string>();
let next = 0;

/** The id of an interleaved attribute: the same attribute always gets the same id. */
function idOf(attribute: object): string {
  let id = IDS.get(attribute);
  if (id === undefined) {
    next += 1;
    id = `interleaved-${String(next)}`;
    IDS.set(attribute, id);
  }
  return id;
}

/**
 * Give each `InterleavedBufferAttribute` an `id` (see the module comment). The call is idempotent. Throws when a
 * three.js upgrade gives the class an `id`: then check whether the fix is still necessary.
 */
export function keyInterleavedAttributes(): void {
  const prototype = InterleavedBufferAttribute.prototype as object;
  const present = Object.getOwnPropertyDescriptor(prototype, "id");
  if (present?.get === idGetter) return;
  if (present !== undefined) throw new Error("morphKey: InterleavedBufferAttribute has an id (a three.js upgrade?)");
  Object.defineProperty(prototype, "id", { configurable: true, get: idGetter });
}

function idGetter(this: object): string {
  return idOf(this);
}
