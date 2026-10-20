// SPDX-License-Identifier: Apache-2.0
/**
 * The import spec of a bought prop: the settings of the prop importer `blender/import_fbx_prop.py`. A project keeps it
 * in its asset list (for example the `import` of a prop entry) and checks it there. The test of that list checks that
 * each key of the file has a type here.
 */
/** One mesh reduction of `PropImportSpec.decimate`. */
export interface DecimateSpec {
  readonly above: number;
  readonly ratio?: number;
  readonly unsubdivide?: number;
  readonly smooth?: boolean;
  readonly objects?: readonly string[];
}

/**
 * The source of a bought prop and how blender/import_fbx_prop.py makes its master. Paths are relative to the root of
 * the import (the argument --root). Places are metres in the FBX frame (Z up, the prop faces -Y).
 */
export interface PropImportSpec {
  /**
   * "fbx-prop": an FBX with static meshes. The importer also reads a glTF (.glb, .gltf), an OBJ or a .blend file, for
   * example the `normalized.glb` of a promoted scratch prop.
   */
  readonly format: "fbx-prop";
  readonly model: string;
  /** Only these objects of the FBX and the objects under them (default: all). */
  readonly keep?: readonly string[];
  /** The importer removes these objects of the FBX and the objects under them. */
  readonly drop?: readonly string[];
  /**
   * Reduce each mesh over `above` triangles to `ratio` (or by `unsubdivide` un-subdivide steps). `smooth`: clear the
   * custom normals and shade smooth after the reduction. `objects`: only those meshes. A list gives one spec for each
   * group of meshes.
   */
  readonly decimate?: DecimateSpec | readonly DecimateSpec[];
  /** The point of the FBX that becomes the origin of the prop, and the scale after the move. */
  readonly origin?: readonly number[];
  readonly scale?: number;
  /** A material without a texture set: a new color (by the start of its name), painted texture areas. */
  readonly colors?: Readonly<Record<string, { readonly color: readonly number[]; readonly roughness?: number }>>;
  readonly fills?: Readonly<
    Record<string, readonly { readonly rect: readonly number[]; readonly color: readonly number[] }[]>
  >;
  /** A material without a texture set: a new roughness and metalness (by the start of its name); the texture stays. */
  readonly surfaces?: Readonly<Record<string, { readonly roughness?: number; readonly metallic?: number }>>;
  readonly maxTextureSize?: number;
  /**
   * More FBX files: their meshes join the prop at `at` (metres in the frame of the first model), rolled by `roll`
   * degrees about Y, tilted by `tilt` degrees about X, then turned by `turn` degrees about Z (for example a tray on the
   * top of a stand). `drop` removes the objects of those names from that file.
   */
  readonly add?: readonly {
    readonly model: string;
    readonly at?: readonly number[];
    readonly turn?: number;
    readonly tilt?: number;
    readonly roll?: number;
    readonly drop?: readonly string[];
  }[];
  /**
   * Bake the colors of every material into one texture of `size` px (one draw call). The materials whose names start
   * with a name of `keep` stay apart with their own texture and UVs.
   */
  readonly bake?: { readonly size: number; readonly roughness?: number; readonly keep?: readonly string[] };
  /** Empties for the renderer: {name: {at, size}}. */
  readonly sockets?: Readonly<
    Record<string, { readonly at: readonly number[]; readonly size?: readonly number[]; readonly tilt?: number }>
  >;
  /** Texture set name -> its files; a source material takes the first set whose name starts its name. */
  readonly materials?: Readonly<
    Record<
      string,
      {
        readonly color: string;
        /**
         * Change the color texture to this color (sRGB, 0 to 1) and keep its shading: each texel gets the color times
         * its luminance over the median luminance (for example a white pillow from a tinted fabric).
         */
        readonly recolor?: readonly [number, number, number];
        /** Scale the metalness of the ORM texture (0 to 1): the room has no reflections, so a full metal renders black. */
        readonly metalness?: number;
        readonly normal: string;
        /** The ORM texture, or the separate roughness and metallic maps that the importer packs into one. */
        readonly orm?: string;
        /** An Unreal RMA texture (roughness, metalness, occlusion) in place of the ORM texture. */
        readonly rma?: string;
        readonly roughness?: string;
        readonly metallic?: string;
        /** A V-Ray glossiness map in place of the roughness (roughness = 1 - glossiness). */
        readonly glossiness?: string;
        /**
         * A map of the clear parts (a 3ds Max refraction map): the polygons on clear texels get a second material with
         * alpha blend, with its alpha decreased to `opacity` (default 0.4). A texel is clear above `threshold`
         * (default 0.5).
         */
        readonly clear?: { readonly map: string; readonly opacity?: number; readonly threshold?: number };
        /** A part that emits light (a screen): the glTF emissive texture. */
        readonly emissive?: string;
        readonly normalConvention?: "opengl" | "directx";
      }
    >
  >;
  /**
   * Separate meshes in place of one body: each part joins the named objects, keeps about `triangles` triangles and
   * has its origin at `pivot` (metres in the FBX frame; default `origin`). The importer removes the objects of no
   * part.
   */
  readonly parts?: Readonly<
    Record<
      string,
      { readonly objects: readonly string[]; readonly triangles?: number; readonly pivot?: readonly number[] }
    >
  >;
  /** Boxes {min, max}: the importer removes the connected pieces of the meshes inside a box. */
  readonly dropParts?: readonly { readonly min: readonly number[]; readonly max: readonly number[] }[];
  /**
   * Move the connected pieces in the boxes to new objects of the names (in the frame of the FBX), before `parts`. Then
   * a part can be a piece of one merged mesh. `minVertices` skips smaller pieces in a box.
   */
  readonly splitParts?: Readonly<
    Record<
      string,
      readonly { readonly min: readonly number[]; readonly max: readonly number[]; readonly minVertices?: number }[]
    >
  >;
  /** Lift everything above `to` by `by`, and stretch the vertices between `from` and `to`. */
  readonly lift?: { readonly from: number; readonly to: number; readonly by: number };
  /** The edge in px of each texture of a texture set (default 1024 each; `emissive` for a part that emits light). */
  readonly textureSize?: Readonly<Partial<Record<"color" | "normal" | "orm" | "emissive", number>>>;
}
