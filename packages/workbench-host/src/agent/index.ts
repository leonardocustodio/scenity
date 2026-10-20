// SPDX-License-Identifier: Apache-2.0
/**
 * The chat mode of the workbench host: the Agent SDK sessions, their in-process MCP
 * server and hook callbacks, and the routes of the `agent.*` requests.
 */
export { AgentManager, askNotice, resumeOverrides, startParams, type AgentManagerDeps } from "./manager";
export { keptParams, mergeParams, OPTIONS_FILE, OptionsStore, parseKept } from "./keptOptions";
export { addAgentHandlers, decisionOf } from "./routes";
export { createWorkbenchServer } from "./mcpServer";
export { sdkHooks } from "./sdkHooks";
export {
  NO_KEY_MESSAGE,
  parseEnvKey,
  readEnvFileKey,
  redactKey,
  resolveCredential,
  type ResolvedCredential,
} from "./credential";
export type { AgentSdk, QueryLike } from "./sdk";
