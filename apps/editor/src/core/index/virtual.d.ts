// SPDX-License-Identifier: Apache-2.0
// The content hash of the dev server or the build (scripts/labsContentHash.ts).
declare module "virtual:labs-content-hash" {
  /** The hash of the working-tree files that a frame depends on: 32 hex characters. */
  export const contentHash: string;
}
