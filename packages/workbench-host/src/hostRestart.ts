// SPDX-License-Identifier: Apache-2.0
/**
 * The restart of the host. `Restart host` comes from the page (`host.restart`) or from the menu of the shell (which
 * stops the host process and starts a new one). In the two cases, the old host writes its restart state at its stop
 * (restartState.ts). The new host then restores the state of the old host.
 *
 * `host.restart` needs the supervisor of main.ts. The host answers, sends `host.restarting` to the pages, stops every
 * child and ends with RESTART_EXIT_CODE. The supervisor starts a new host on the same port with the same token. Thus
 * the page connects again by itself and keeps its URL.
 */
import { startParams } from "./agent/manager";
import { RESTART_ENDED_TEXT } from "./hostProtocol";
import type { HostParts } from "./hostParts";
import type { Router } from "./router";
import { takeRestart, writeRestart, type RestartSnapshot } from "./restartState";

/** The current restart state of a host. */
export function snapshotOf(parts: HostParts): RestartSnapshot {
  return {
    at: new Date().toISOString(),
    checkout: parts.current,
    front: parts.agent.front.front(),
    terminals: parts.terminals.live(),
    runs: parts.runs.runningAll(),
    chats: parts.chat.resumable(),
  };
}

/** Write the restart state of a stopping host. */
export function saveRestart(parts: HostParts): void {
  writeRestart(parts.state.dir, snapshotOf(parts));
}

/**
 * Read the restart state of the old host, if one. Give the checkout to open (null: the checkout of the command line)
 * and the function that applies the rest after the open.
 */
export function loadRestart(parts: HostParts): { checkout: string | null; apply: () => void } {
  const snapshot = takeRestart(parts.state.dir);
  if (snapshot === null) return { checkout: null, apply: () => undefined };
  return { checkout: snapshot.checkout, apply: () => applyRestart(parts, snapshot) };
}

/** Restore the state of the old host: the tab in front, the ended terminals and runs, the chats. */
function applyRestart(parts: HostParts, snapshot: RestartSnapshot): void {
  parts.agent.front.setFront(snapshot.front);
  parts.terminals.markEnded(snapshot.terminals);
  for (const run of snapshot.runs) parts.runs.addEnded(run, RESTART_ENDED_TEXT);
  for (const chat of snapshot.chats) {
    // An `api-key` chat without a usable key throws. Then the owner resumes it from the Sessions tab.
    void Promise.resolve()
      .then(() => parts.chat.resume(startParams(chat.params), chat.sdkSessionId, false))
      .catch(() => null);
  }
}

/** The wait between the answer of `host.restart` and the stop, so the answer reaches the page (ms). */
const ANSWER_MS = 50;

/**
 * Add `host.restart`. `restart` is the function of the supervisor (main.ts): it stops the host and ends the process.
 * Without it the request fails with a reason.
 */
export function addRestartHandler(router: Router, parts: HostParts, restart: (() => void) | undefined): void {
  router.on("host.restart", () => {
    if (restart === undefined) {
      throw new Error(
        "This host runs without its supervisor, so it cannot restart itself. Use View > Restart Host in the app, " +
          "or stop it and start it again.",
      );
    }
    parts.server.broadcast({ type: "host.restarting", at: new Date().toISOString() });
    setTimeout(restart, ANSWER_MS);
    return { restarting: true as const };
  });
}
