// SPDX-License-Identifier: Apache-2.0
/**
 * The Rapier module of the physics plugin: the deterministic build of Rapier 3D (Apache-2.0). The same steps
 * give the same bits on each platform. The compat package holds the WASM bytes as base64 text in its script, so the
 * module compiles the bytes with `WebAssembly.instantiate`: no fetch, no eval, no `new Function`. The CSP of the pages
 * already allows this with `script-src 'wasm-unsafe-eval'` (the Basis and Draco decoders need it too).
 *
 * The module waits for the WASM at its top level. Thus the dynamic import of the plugin chunk resolves only when
 * Rapier is ready, and the systems can use it with no promise.
 */
import Rapier from "@dimforge/rapier3d-deterministic-compat";

/**
 * The Rapier module after its WASM is ready. The export comes from the wait, so a bundler cannot drop the wait (the
 * package has `sideEffects: false`, and a bundler drops a plain top-level `await Rapier.init()` from the build).
 */
async function load(): Promise<typeof Rapier> {
  await Rapier.init();
  return Rapier;
}

export const RAPIER = await load();
