// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point `@scenity/assets/build`: the generic asset build. The pipeline optimizes the jobs of a project, runs
 * the generic checks and gives the built files. A project adds its own checks and its manifest.
 */
export * from "./buildState";
export * from "./cache";
export * from "./checks";
export * from "./glbImages";
export * from "./images";
export * from "./manifest";
export * from "./optimize";
export * from "./output";
export * from "./pipeline";
export * from "./project";
export * from "./settings";
export * from "./stamps";
export * from "./textures";
export * from "./workspace";
