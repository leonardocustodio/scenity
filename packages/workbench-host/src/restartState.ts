// SPDX-License-Identifier: Apache-2.0
/**
 * The restart state of the host. At its stop, the host writes `restart.json` to its state folder: the open checkout,
 * the tab in front, the terminals and the runs that ran, and the chat sessions. The next host of the same state
 * folder reads it once, when it is at most RESTART_MAX_AGE_MS old (a restart, not the next day). Then it restores the
 * state of the old host:
 *
 * - the checkout opens again and the surfaces open at their URLs again (the URLs are in surfaces.json);
 * - a terminal or a run of the old host shows that it ended with the old host (RESTART_ENDED_TEXT);
 * - each chat session resumes by its SDK session ID (without an API key the resume fails, and the owner resumes).
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentStartParams } from "./agentProtocol";
import type { RunInfo, SurfaceId, TerminalKind } from "./protocol";
import { isRecord, isSurfaceId } from "./protocol";
import { readJsonObject, writeJsonAtomic } from "./state";

/** The file of the restart state in a state folder. */
export const RESTART_FILE = "restart.json";
/** The oldest restart state that a new host takes (ms). */
export const RESTART_MAX_AGE_MS = 10 * 60_000;

/** What a host gives to the next host. */
export interface RestartSnapshot {
  /** The ISO time of the stop. */
  readonly at: string;
  readonly checkout: string;
  /** The surface ID of the tab in front, or null for the scene surface. */
  readonly front: SurfaceId | null;
  readonly terminals: readonly { readonly id: string; readonly kind: TerminalKind }[];
  readonly runs: readonly RunInfo[];
  readonly chats: readonly { readonly sdkSessionId: string; readonly params: AgentStartParams }[];
}

/** Write the restart state of a stopping host. A failure only loses the state. */
export function writeRestart(stateDir: string, snapshot: RestartSnapshot): void {
  try {
    writeJsonAtomic(join(stateDir, RESTART_FILE), snapshot);
  } catch {
    // The state folder is gone. The next host starts clean.
  }
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Read the restart state once (the function removes the file) when it is new enough, else null. */
export function takeRestart(stateDir: string, now: number = Date.now()): RestartSnapshot | null {
  const path = join(stateDir, RESTART_FILE);
  const value = readJsonObject(path);
  rmSync(path, { force: true });
  const at = typeof value.at === "string" ? Date.parse(value.at) : Number.NaN;
  if (!Number.isFinite(at) || now - at > RESTART_MAX_AGE_MS || typeof value.checkout !== "string") return null;
  const front = value.front;
  return {
    at: value.at as string,
    checkout: value.checkout,
    front: isSurfaceId(front) ? front : null,
    terminals: arrayOf(value.terminals).filter(
      (item): item is { id: string; kind: TerminalKind } =>
        isRecord(item) && typeof item.id === "string" && (item.kind === "claude" || item.kind === "shell"),
    ),
    runs: arrayOf(value.runs).filter(
      (item): item is RunInfo => isRecord(item) && typeof item.run === "string" && typeof item.command === "string",
    ),
    chats: arrayOf(value.chats).filter(
      (item): item is { sdkSessionId: string; params: AgentStartParams } =>
        isRecord(item) && typeof item.sdkSessionId === "string" && isRecord(item.params),
    ),
  };
}
