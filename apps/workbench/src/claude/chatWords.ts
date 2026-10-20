// SPDX-License-Identifier: Apache-2.0
/**
 * The words of the chat panel: the credentials, the three permission modes, the states of a session and the effort
 * levels. Developer text (tools/wording-allowlist.json).
 */
import {
  AGENT_EFFORTS,
  type AgentCredential,
  type AgentMode,
  type AgentSessionInfo,
  type AgentState,
} from "@scenity/workbench-host/protocol";

/** The credentials of the chat. The subscription is first and is the default. */
export const CREDENTIALS: readonly {
  readonly value: AgentCredential;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "subscription", label: "Subscription", hint: "The claude.ai login of this machine (the default)." },
  {
    value: "api-key",
    label: "API key (.env)",
    hint: "ANTHROPIC_API_KEY of .env at the checkout root (mode 600), else of the host environment. The API bills each call.",
  },
];

/** The credential of a session in the status line: the choice, the source of the key and the SDK source. */
export function credentialWords(info: Pick<AgentSessionInfo, "credential" | "keyFrom" | "apiKeySource">): string {
  if (info.credential === "subscription") return "subscription (claude.ai login)";
  const from = info.keyFrom === "environment" ? "host environment" : ".env";
  return `API key (${from})${info.apiKeySource === null ? "" : ` · apiKeySource ${info.apiKeySource}`}`;
}

/** The modes of the panel: ask (the default), edits and all. */
export const MODES: readonly { readonly value: AgentMode; readonly label: string; readonly hint: string }[] = [
  { value: "default", label: "Ask", hint: "An approval card for every edit and command." },
  { value: "acceptEdits", label: "Edits", hint: "Edits in the checkout run; commands ask." },
  { value: "bypassPermissions", label: "All", hint: "Everything runs, with a budget and a turn limit. Never commits." },
];

export const STATE_WORDS: Readonly<Record<AgentState, { readonly color: string; readonly words: string }>> = {
  starting: { color: "bg-status-caution", words: "starting" },
  idle: { color: "bg-status-positive", words: "ready" },
  running: { color: "bg-status-info", words: "working" },
  waiting: { color: "bg-status-caution", words: "waits for you" },
  error: { color: "bg-status-negative", words: "stopped with an error" },
  ended: { color: "bg-status-neutral", words: "ended" },
};

export const EFFORTS = AGENT_EFFORTS;
