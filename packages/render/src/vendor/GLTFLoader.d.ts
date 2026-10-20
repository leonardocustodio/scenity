// SPDX-License-Identifier: Apache-2.0
// The types of the trimmed GLTFLoader (GLTFLoader.js, packages/assets/src/build/trimGltf.ts). They are the types of
// the three.js loader. The trimmed loader has the same API, but it reads only the four glTF extensions
// of the 3D room assets.
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
  GLTFReference,
  GLTFReferenceType,
} from "three/examples/jsm/loaders/GLTFLoader.js";
