// SPDX-License-Identifier: Apache-2.0
// The ui package uses Vite features: import.meta.glob for the Fluent files and ?raw imports.
/// <reference types="vite/client" />

// Type-aware lint reads .vue imports through this declaration; vue-tsc reads the real component types.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
