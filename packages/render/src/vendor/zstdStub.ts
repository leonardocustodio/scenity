// SPDX-License-Identifier: Apache-2.0
/**
 * The Zstandard decoder of three.js (`examples/jsm/libs/zstddec.module.js`, 17.7 KB gzip in the render worker) in the
 * builds of the apps: a stub. KTX2Loader uses the decoder only for a KTX2 image that is
 * not Basis Universal with Zstandard supercompression. Every KTX2 image of the built assets is Basis Universal
 * (packages/assets/src/build/glbImages.ts, in `check:assets`), and the Basis transcoder decodes its Zstandard itself.
 * The Vite config of apps/editor and of each runtime user replaces the module with this one.
 *
 * `init` resolves: KTX2Loader awaits it in the executor of a promise, so a rejection would stop the load without an
 * error. `decode` throws, so an image that needs the decoder fails as an asset failure.
 */
export class ZSTDDecoder {
  init(): Promise<void> {
    return Promise.resolve();
  }

  decode(): Uint8Array {
    throw new Error("The 3D room reads Basis Universal KTX2 images only: this image needs a Zstandard decoder.");
  }
}
