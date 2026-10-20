// SPDX-License-Identifier: Apache-2.0
// Parts of this file come from three.js (MIT licence, copyright 2010-2026 three.js authors). See NOTICE.
/**
 * The Draco decoder without workers. The generic loader imports this module only
 * when a file has KHR_draco_mesh_compression (dracoLoader.ts), so a project with no Draco file loads none of it.
 *
 * DRACOLoader of three.js starts Blob workers, and the CSP of the app blocks them. This module runs the same decoder in
 * the thread of the caller (the render worker, or the main thread in the fallback path). The decoder JavaScript is the
 * ES module copy of patchDraco.ts (@scenity/assets): it has no dynamic code. The geometry code is the code of
 * DRACOLoader (three.js, MIT): the same attributes, strides and index. Thus a Draco file gives the geometry of the
 * stock loader.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ColorManagement,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  SRGBColorSpace,
} from "three";
import dracoDecoderModule from "./vendor/draco_wasm_wrapper.js";

/** The typed array classes of the attributes, by the names of GLTFLoader. */
const ARRAYS = { Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array } as const;
type ArrayName = keyof typeof ARRAYS;
type AttributeArray = InstanceType<(typeof ARRAYS)[ArrayName]>;

/** The parts of a Draco object that this module uses. */
interface DracoPointer {
  readonly ptr: number;
}
interface DracoGeometry extends DracoPointer {
  num_points(): number;
  num_faces(): number;
}
interface DracoAttribute {
  num_components(): number;
}
interface DracoDecoder {
  GetEncodedGeometryType(array: Int8Array): number;
  DecodeArrayToMesh(array: Int8Array, length: number, out: DracoGeometry): DracoStatus;
  DecodeArrayToPointCloud(array: Int8Array, length: number, out: DracoGeometry): DracoStatus;
  GetAttributeByUniqueId(geometry: DracoGeometry, id: number): DracoAttribute;
  GetTrianglesUInt32Array(geometry: DracoGeometry, bytes: number, ptr: number): void;
  GetAttributeDataArrayForAllPoints(
    geometry: DracoGeometry,
    attribute: DracoAttribute,
    type: number,
    bytes: number,
    ptr: number,
  ): void;
}
interface DracoStatus {
  ok(): boolean;
  error_msg(): string;
}
interface DracoModule {
  readonly TRIANGULAR_MESH: number;
  readonly POINT_CLOUD: number;
  readonly HEAPF32: Float32Array<ArrayBuffer>;
  readonly Decoder: new () => DracoDecoder;
  readonly Mesh: new () => DracoGeometry;
  readonly PointCloud: new () => DracoGeometry;
  readonly [type: `DT_${string}`]: number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  destroy(object: unknown): void;
}

/** The decoded data of one attribute. */
interface DecodedAttribute {
  readonly name: string;
  readonly array: AttributeArray;
  readonly itemSize: number;
  readonly stride: number;
}

const DATA_TYPES: Readonly<Record<ArrayName, `DT_${string}`>> = {
  Float32Array: "DT_FLOAT32",
  Int8Array: "DT_INT8",
  Int16Array: "DT_INT16",
  Int32Array: "DT_INT32",
  Uint8Array: "DT_UINT8",
  Uint16Array: "DT_UINT16",
  Uint32Array: "DT_UINT32",
};

/** The modules by WASM loader: one decoder module per loader. */
const modules = new WeakMap<() => Promise<ArrayBuffer>, Promise<DracoModule>>();

/** Start the decoder module with the WASM bytes. No fetch, no worker and no dynamic code. */
export function loadDracoModule(wasm: ArrayBuffer): Promise<DracoModule> {
  return new Promise<{ readonly draco: DracoModule }>((resolve) => {
    dracoDecoderModule({
      wasmBinary: wasm,
      // The module can be "thenable": wrap it, so the promise does not wait on it again (as DRACOLoader).
      onModuleLoaded: (module) => {
        resolve({ draco: module as DracoModule });
      },
    });
  }).then((wrapped) => wrapped.draco);
}

function moduleOf(wasm: () => Promise<ArrayBuffer>): Promise<DracoModule> {
  let made = modules.get(wasm);
  if (made === undefined) {
    made = wasm().then(loadDracoModule);
    modules.set(wasm, made);
    made.catch(() => modules.delete(wasm));
  }
  return made;
}

/** One attribute of all points, with a stride of a multiple of 4 bytes (as DRACOLoader). */
function decodeAttribute(
  draco: DracoModule,
  decoder: DracoDecoder,
  geometry: DracoGeometry,
  name: string,
  type: ArrayName,
  attribute: DracoAttribute,
): DecodedAttribute {
  const TypedArray = ARRAYS[type];
  const count = geometry.num_points();
  const itemSize = attribute.num_components();
  const srcByteStride = itemSize * TypedArray.BYTES_PER_ELEMENT;
  const dstByteStride = Math.ceil(srcByteStride / 4) * 4;
  const stride = dstByteStride / TypedArray.BYTES_PER_ELEMENT;
  const srcByteLength = count * srcByteStride;
  const dataType = draco[DATA_TYPES[type]];
  if (dataType === undefined) throw new Error(`Draco: no data type ${DATA_TYPES[type]}`);
  const ptr = draco._malloc(srcByteLength);
  decoder.GetAttributeDataArrayForAllPoints(geometry, attribute, dataType, srcByteLength, ptr);
  const src = new TypedArray(draco.HEAPF32.buffer, ptr, srcByteLength / TypedArray.BYTES_PER_ELEMENT);
  let array: AttributeArray;
  if (srcByteStride === dstByteStride) {
    array = src.slice();
  } else {
    array = new TypedArray((count * dstByteStride) / TypedArray.BYTES_PER_ELEMENT);
    for (let point = 0; point < count; point += 1) {
      for (let item = 0; item < itemSize; item += 1) array[point * stride + item] = src[point * itemSize + item] ?? 0;
    }
  }
  draco._free(ptr);
  return { name, array, itemSize, stride };
}

/** The index of a mesh as 32-bit integers. */
function decodeIndex(draco: DracoModule, decoder: DracoDecoder, geometry: DracoGeometry): Uint32Array {
  const count = geometry.num_faces() * 3;
  const ptr = draco._malloc(count * 4);
  decoder.GetTrianglesUInt32Array(geometry, count * 4, ptr);
  const index = new Uint32Array(draco.HEAPF32.buffer, ptr, count).slice();
  draco._free(ptr);
  return index;
}

/** The colours of an sRGB file in the working colour space (glTF colours are linear, so GLTFLoader skips this). */
function toWorkingColours(attribute: BufferAttribute | InterleavedBufferAttribute): void {
  const colour = new Color();
  for (let at = 0; at < attribute.count; at += 1) {
    colour.fromBufferAttribute(attribute, at);
    ColorManagement.colorSpaceToWorking(colour, SRGBColorSpace);
    attribute.setXYZ(at, colour.r, colour.g, colour.b);
  }
}

/** The three.js geometry of the decoded data, as `DRACOLoader._createGeometry`. */
function geometryOf(index: Uint32Array | null, attributes: readonly DecodedAttribute[], colorSpace: string) {
  const geometry = new BufferGeometry();
  if (index !== null) geometry.setIndex(new BufferAttribute(index, 1));
  for (const { name, array, itemSize, stride } of attributes) {
    const attribute =
      itemSize === stride
        ? new BufferAttribute(array, itemSize)
        : new InterleavedBufferAttribute(new InterleavedBuffer(array, stride), itemSize, 0);
    if (name === "color") {
      if (colorSpace === SRGBColorSpace) toWorkingColours(attribute);
      attribute.normalized = !(array instanceof Float32Array);
    }
    geometry.setAttribute(name, attribute);
  }
  return geometry;
}

/** Decode a Draco buffer of a glTF primitive: `ids` are the unique IDs of the attributes, `types` their arrays. */
export async function decodeDraco(
  wasm: () => Promise<ArrayBuffer>,
  buffer: ArrayBuffer,
  ids: Readonly<Record<string, number>>,
  types: Readonly<Record<string, string>>,
  colorSpace: string,
): Promise<BufferGeometry> {
  const draco = await moduleOf(wasm);
  const decoder = new draco.Decoder();
  const array = new Int8Array(buffer);
  let geometry: DracoGeometry | null = null;
  try {
    const kind = decoder.GetEncodedGeometryType(array);
    if (kind !== draco.TRIANGULAR_MESH && kind !== draco.POINT_CLOUD) throw new Error("Draco: an unknown geometry");
    const mesh = kind === draco.TRIANGULAR_MESH;
    geometry = mesh ? new draco.Mesh() : new draco.PointCloud();
    const status = mesh
      ? decoder.DecodeArrayToMesh(array, array.byteLength, geometry)
      : decoder.DecodeArrayToPointCloud(array, array.byteLength, geometry);
    if (!status.ok() || geometry.ptr === 0) throw new Error(`Draco: the decode failed: ${status.error_msg()}`);
    const attributes: DecodedAttribute[] = [];
    for (const name of Object.keys(ids)) {
      const type = types[name] as ArrayName | undefined;
      if (type === undefined || !(type in ARRAYS)) throw new Error(`Draco: no array type for ${name}`);
      const attribute = decoder.GetAttributeByUniqueId(geometry, ids[name] ?? -1);
      attributes.push(decodeAttribute(draco, decoder, geometry, name, type, attribute));
    }
    return geometryOf(mesh ? decodeIndex(draco, decoder, geometry) : null, attributes, colorSpace);
  } finally {
    if (geometry !== null) draco.destroy(geometry);
    draco.destroy(decoder);
  }
}
