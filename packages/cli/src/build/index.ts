// SPDX-License-Identifier: Apache-2.0
/**
 * The entry `@scenity/cli/build`: `scenity build`, the marker gate and the size budgets of a build.
 * `tools/size-budget.ts` and `tools/lab-markers.ts` use the generic parts for the 3D room.
 */
export * from "./command";
export * from "./markers";
export * from "./plugins";
export * from "./report";
export * from "./run";
export * from "./sizes";
export { buildPath, BUILD_ASSETS, documentStep } from "./documents";
export { assetStep, type AssetMode } from "./assets";
export { PLAYER_ENTRIES, playerGroups } from "./player";
