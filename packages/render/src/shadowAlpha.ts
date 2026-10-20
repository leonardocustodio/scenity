// SPDX-License-Identifier: Apache-2.0
/**
 * The version of the shadow pass material on WebGPU.
 *
 * The WebGPU renderer of three.js (r186) draws the shadow map of a light with one override material. Before it draws
 * an object, `Renderer.renderObject` copies some properties of the material of the object to that override material:
 * `alphaTest`, `alphaMap`, the displacement, `transparent`, the side and the shadow nodes. The `alphaTest` setter of
 * `Material` adds 1 to `version` when the value goes from 0 to more than 0, or back. The room has materials with an
 * alpha test (the glTF materials with the alpha mode MASK, the foam of the pads) and materials without it. Thus the
 * version of the override material changes many times in each shadow pass. Without this module, each object then
 * sees a new version and calculates the cache key of its render object and of its pipeline again (a long string of
 * the material properties). That costs about 0.4 ms of each frame in the worker, but the key is almost always the
 * same.
 *
 * `steadyShadowAlpha` keeps the version of the override material when the alpha test goes on or off between two
 * objects. It adds 1 to the version only when the material of one object, or a property of it that the renderer
 * copies, is not the same as in the last shadow pass of that object. Then the renderer calculates the keys of that
 * object again, as the setter of three.js makes it do. Thus it makes the same render objects and pipelines and draws
 * the same frame. Only the WebGPU backend loads this module.
 */
import type { Material, Object3D } from "three";

/** The parts of the override material that this module changes. */
interface OverrideMaterial {
  version: number;
  readonly isShadowPassMaterial?: boolean;
}

/**
 * The properties of the material of an object that `Renderer.renderObject` (three.js r186) reads for the override
 * material of a shadow pass, directly or through `_getShadowNodes`.
 */
const COPIED = [
  "version",
  "alphaTest",
  "alphaMap",
  "displacementMap",
  "displacementScale",
  "displacementBias",
  "transparent",
  "transmission",
  "transmissionNode",
  "backdropNode",
  "side",
  "shadowSide",
  "positionNode",
  "map",
  "colorNode",
  "castShadowNode",
  "maskShadowNode",
  "maskNode",
] as const;

/** Per override material: the material of each object in its last shadow pass and the values of COPIED. */
const SEEN = new WeakMap<object, WeakMap<object, unknown[]>>();

/** The `alphaTest` accessor of the prototype chain of a material, or undefined. */
function accessorOf(material: object): PropertyDescriptor | undefined {
  let proto = Object.getPrototypeOf(material) as object | null;
  while (proto !== null) {
    const found = Object.getOwnPropertyDescriptor(proto, "alphaTest");
    if (found !== undefined) return found;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return undefined;
}

/**
 * Give an override material an `alphaTest` accessor that keeps `version` (see the module comment). Throws when a
 * three.js upgrade removes the accessor: then check whether the fix is still necessary.
 */
function steady(override: OverrideMaterial): WeakMap<object, unknown[]> {
  const accessor = accessorOf(override);
  if (accessor?.get === undefined || accessor.set === undefined) {
    throw new Error("shadowAlpha: Material has no alphaTest accessor (a three.js upgrade?)");
  }
  Object.defineProperty(override, "alphaTest", {
    configurable: true,
    get(this: OverrideMaterial): unknown {
      return accessor.get?.call(this);
    },
    set(this: OverrideMaterial, value: number): void {
      const version = this.version;
      accessor.set?.call(this, value);
      this.version = version;
    },
  });
  const seen = new WeakMap<object, unknown[]>();
  SEEN.set(override, seen);
  return seen;
}

/**
 * Write the material and the values of COPIED into `last`. Returns true when one of them is not the same as before.
 * The alpha test counts only as on or off, as the setter of three.js does.
 */
function changed(last: unknown[], material: Material): boolean {
  const values = material as unknown as Record<string, unknown>;
  let different = last[0] !== material;
  last[0] = material;
  for (let index = 0; index < COPIED.length; index += 1) {
    const key = COPIED[index] as string;
    const value = key === "alphaTest" ? (values[key] as number) > 0 : values[key];
    if (last[index + 1] !== value) {
      different = true;
      last[index + 1] = value;
    }
  }
  return different;
}

/** True for the override material of a shadow pass. */
export function isShadowPass(material: Material | null): material is Material & OverrideMaterial {
  return (material as Partial<OverrideMaterial> | null)?.isShadowPassMaterial === true;
}

/**
 * Call before `Renderer.renderObject` draws `object` with its `material`. Does nothing when the override material of
 * the scene is not the material of a shadow pass.
 */
export function steadyShadowAlpha(override: Material | null, object: Object3D, material: Material): void {
  if (!isShadowPass(override) || !material.allowOverride) return;
  const shadow = override;
  const seen = SEEN.get(shadow) ?? steady(shadow);
  const last = seen.get(object);
  if (last === undefined) {
    const made: unknown[] = [];
    changed(made, material);
    seen.set(object, made);
    return;
  }
  // The material of this object changed after its last shadow pass: a new version, as the setter of three.js gives.
  if (changed(last, material)) shadow.version += 1;
}
