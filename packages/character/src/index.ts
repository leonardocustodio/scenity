// SPDX-License-Identifier: Apache-2.0
// The entry point of @scenity/character. It has the types only. Import the code from a subpath
// (`@scenity/character/body`, `/rigDriver`, `/locomotion`, …): a render worker loads only what it uses.
export type * from "./place";
export type { Vec3 } from "./math";
