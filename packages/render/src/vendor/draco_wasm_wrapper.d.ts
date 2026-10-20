// SPDX-License-Identifier: Apache-2.0
// The types of the generated Draco decoder (draco_wasm_wrapper.js, packages/assets/src/build/patchDraco.ts).
// An Emscripten factory: it takes the WASM bytes and calls `onModuleLoaded` with the module.
declare const factory: (module: { wasmBinary: ArrayBuffer; onModuleLoaded?: (module: unknown) => void }) => unknown;
export default factory;
