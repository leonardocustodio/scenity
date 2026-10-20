// SPDX-License-Identifier: Apache-2.0
/**
 * A new geometry of a mesh on WebGPU.
 *
 * The WebGPU renderer of three.js (r186) keeps a render object for each object, material and pass. The render object
 * keeps its render pipeline, and the pipeline holds the layout of the vertex buffers: the format, the stride and the
 * offset of each attribute. When an object gets another geometry, the render object reads the buffers of the new
 * geometry, but it keeps its pipeline while the material stays the same. A new geometry with another layout then
 * draws with the old layout.
 *
 * The cushion of a face mask prop showed this. A conform step gives the mask a float position attribute in place
 * of the quantized, interleaved attribute of the file. When the mask drew before the conform, the GPU read the float
 * positions as 16-bit values, and the mask showed as a crumpled box. The panes of the labs showed it on each load;
 * WebGL showed the mask correctly.
 *
 * `GeometrySwaps` keeps the layout of the geometry of each object. When an object draws with a geometry of another
 * layout, the WebGPU backend sends a `dispose` event to the object (render/webgpu.ts). The renderer then removes the
 * render objects of the object, and the next draw makes new ones with the new layout. A new geometry with the same
 * layout (a cable that the core makes again) keeps its render objects. WebGLRenderer makes the vertex layout for each
 * geometry, so only the WebGPU backend loads this module.
 *
 * Limit: the check compares geometries, not the attributes of one geometry. A change of an attribute of the same
 * geometry to another layout needs a new geometry.
 */
import type { BufferGeometry, Object3D } from "three";

/** The parts of a buffer attribute or of an interleaved buffer attribute that set its vertex layout. */
interface AttributeLike {
  readonly itemSize: number;
  readonly normalized: boolean;
  readonly array?: ArrayLike<number>;
  readonly offset?: number;
  readonly data?: { readonly array: ArrayLike<number>; readonly stride: number };
}

/** The type of the values of an array: the name of its typed array class (a built-in class keeps its name). */
function typeOf(array: ArrayLike<number> | undefined): string {
  return array === undefined ? "none" : (array.constructor as { readonly name: string }).name;
}

/** The vertex layout of a geometry: for each attribute its name, its value type, its size, its stride and offset. */
export function layoutOf(geometry: BufferGeometry): string {
  const attributes = geometry.attributes as Record<string, AttributeLike>;
  return Object.entries(attributes)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, attribute]) => {
      const data = attribute.data;
      const values = typeOf(data === undefined ? attribute.array : data.array);
      const normalized = attribute.normalized ? "n" : "";
      const stride = data === undefined ? "" : `${String(data.stride)}+${String(attribute.offset ?? 0)}`;
      return `${name}:${values}:${String(attribute.itemSize)}${normalized}:${stride}`;
    })
    .join(",");
}

/** The geometry of the last draw of each object and its layout. */
export class GeometrySwaps {
  private readonly seen = new WeakMap<Object3D, { geometry: BufferGeometry; layout: string }>();

  /**
   * True when `object` draws with `geometry` and its last draw used a geometry with another layout. The first draw
   * of an object gives false.
   */
  changed(object: Object3D, geometry: BufferGeometry): boolean {
    const last = this.seen.get(object);
    if (last === undefined) {
      this.seen.set(object, { geometry, layout: layoutOf(geometry) });
      return false;
    }
    if (last.geometry === geometry) return false;
    const layout = layoutOf(geometry);
    const changed = layout !== last.layout;
    last.geometry = geometry;
    last.layout = layout;
    return changed;
  }
}
