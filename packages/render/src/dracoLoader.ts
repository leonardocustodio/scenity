// SPDX-License-Identifier: Apache-2.0
/**
 * The Draco loader of the generic glTF loader: an object with the part of the
 * DRACOLoader API that GLTFLoader calls. The decoder is an optional chunk: the first Draco primitive imports
 * `dracoDecoder.ts` (a dynamic import), and that chunk fetches the WASM file. A project with no Draco file never loads
 * the chunk or the WASM file.
 */
import type { BufferGeometry } from "three";

/** The part of DRACOLoader that GLTFLoader calls (`setDRACOLoader`, KHR_draco_mesh_compression). */
export interface DracoLoaderLike {
  preload(): DracoLoaderLike;
  decodeDracoFile(
    buffer: ArrayBuffer,
    callback: (geometry: BufferGeometry) => void,
    attributeIDs: Readonly<Record<string, number>>,
    attributeTypes: Readonly<Record<string, string>>,
    vertexColorSpace: string,
    onError: (error: unknown) => void,
  ): Promise<void>;
}

/**
 * A Draco loader that imports the decoder at the first decode. `wasm` gives the bytes of draco_decoder.wasm (the
 * glTF build of three.js) from a same-origin URL.
 */
export function lazyDracoLoader(wasm: () => Promise<ArrayBuffer>): DracoLoaderLike {
  const loader: DracoLoaderLike = {
    // GLTFLoader calls it when a file has Draco; the decoder still loads at the first decode.
    preload: () => loader,
    decodeDracoFile: async (buffer, callback, attributeIDs, attributeTypes, vertexColorSpace, onError) => {
      try {
        const { decodeDraco } = await import("./dracoDecoder");
        callback(await decodeDraco(wasm, buffer, attributeIDs, attributeTypes, vertexColorSpace));
      } catch (error) {
        onError(error);
      }
    },
  };
  return loader;
}
