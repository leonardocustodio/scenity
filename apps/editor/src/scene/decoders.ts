// SPDX-License-Identifier: Apache-2.0
/**
 * The same-origin URLs of the WASM decoders of the asset loader for a Vite page: the Basis transcoder (KTX2
 * textures) and the Draco decoder of the glTF build of three.js. Vite copies both files into the build.
 */
import basisWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?url";
import dracoWasm from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import type { SceneDecoders } from "@scenity/runtime/protocol";

export const DECODERS: SceneDecoders = { basisWasm, dracoWasm };
