// SPDX-License-Identifier: Apache-2.0
// The types of the generic GLTFLoader (GLTFLoaderGeneric.js, `packages/assets/src/build/trimGltf.ts --loader generic`).
// They are the types of the three.js loader. The generic loader has the same API, but it reads only the glTF
// extensions of GENERIC_GLTF_EXTENSIONS.
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
  GLTFReference,
  GLTFReferenceType,
} from "three/examples/jsm/loaders/GLTFLoader.js";
