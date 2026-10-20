// SPDX-License-Identifier: Apache-2.0
/// <reference types="vite/client" />

/** The key of the checkout of the lab build (vite.config.ts); absent in a test. */
declare const __LABS_CHECKOUT__: string | undefined;

// The single-file components of the lab, for the TypeScript of the scripts and the lint (vue-tsc reads them directly).
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
