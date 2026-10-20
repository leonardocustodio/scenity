// SPDX-License-Identifier: Apache-2.0
// The types of the generated Basis Universal transcoder (basis_transcoder.js, packages/assets/src/build/patchBasis.ts).
// An Emscripten factory: it takes the WASM bytes and gives the module.
declare const factory: (module: { wasmBinary: ArrayBuffer }) => Promise<unknown>;
export default factory;
