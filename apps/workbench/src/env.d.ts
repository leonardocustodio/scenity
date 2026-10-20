// SPDX-License-Identifier: Apache-2.0
/// <reference types="vite/client" />

// The single-file components of the workbench, for the TypeScript of the lint (vue-tsc reads them itself).
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
