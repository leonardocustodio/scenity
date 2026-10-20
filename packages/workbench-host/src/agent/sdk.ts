// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the Agent SDK that the chat mode uses. The host imports the SDK from
 * its root entry (not `/core`). A test gives a fake `AgentSdk`, so no test spawns Claude Code.
 *
 * The SDK 0.3.284 bundles Claude Code 2.1.284 (`claudeCodeVersion` of its package.json). The SDK spawns that native
 * binary per session. The runtime of the host does not matter.
 */
import {
  forkSession,
  getSessionInfo,
  listSessions,
  query,
  type ForkSessionOptions,
  type ForkSessionResult,
  type GetSessionInfoOptions,
  type ListSessionsOptions,
  type Options,
  type Query,
  type SDKMessage,
  type SDKSessionInfo,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type {
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/** The parts of a `Query` that a session uses. A fake query implements only these. */
export type QueryLike = AsyncIterable<SDKMessage> &
  Pick<Query, "interrupt" | "setModel" | "setPermissionMode" | "close"> &
  Partial<Pick<Query, "applyFlagSettings" | "supportedModels" | "getContextUsage">>;

/** The functions of the SDK that the host calls. */
export interface AgentSdk {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): QueryLike;
  listSessions(options: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  getSessionInfo(sessionId: string, options: GetSessionInfoOptions): Promise<SDKSessionInfo | undefined>;
  forkSession(sessionId: string, options: ForkSessionOptions): Promise<ForkSessionResult>;
}

/** The real SDK. */
export const realSdk: AgentSdk = { query, listSessions, getSessionInfo, forkSession };
