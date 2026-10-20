// SPDX-License-Identifier: Apache-2.0
/**
 * The host of the Scenity workbench (docs/workbench.md): the protocol,
 * the start of the host and the surface client of the tools. The page imports only `./protocol`.
 */
export * from "./protocol";
export { startHost, type Host, type HostOptions } from "./host";
export type { CallOptions, Surface } from "./surfaces";
export type { HmrRecord, HmrTarget } from "./hmr";
