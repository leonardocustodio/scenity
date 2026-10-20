// SPDX-License-Identifier: Apache-2.0
// The entry point of @scenity/render. It has the types only. Import the code from a subpath (`@scenity/render/webgl`,
// `/webgpu`, `/assets`, `/ktx2`, `/gpuTimer`): one backend must not import the other backend.
export type * from "./types";
