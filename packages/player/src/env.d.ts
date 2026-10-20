// SPDX-License-Identifier: Apache-2.0
// The player imports the worker entry and the WASM decoders with the Vite suffixes `?worker&url` and `?url`.
/// <reference types="vite/client" />

// Type-aware lint reads .vue imports through this declaration; vue-tsc reads the real component types.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
