// SPDX-License-Identifier: Apache-2.0
// The Khronos glTF validator (a Dart program compiled to JavaScript, without types).
// The asset build uses only validateBytes.
declare module "gltf-validator" {
  export function validateBytes(data: Uint8Array, options?: { readonly maxIssues?: number }): Promise<unknown>;
  export function version(): string;
}
