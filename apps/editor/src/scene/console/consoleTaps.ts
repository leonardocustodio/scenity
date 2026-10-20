// SPDX-License-Identifier: Apache-2.0
/**
 * The sources of the Console panel: the console and the uncaught errors of the page (a line
 * from the code of a plugin has the source "plugin"), the console lines of the dev scene worker (`workerLog`), the
 * errors of the dev server (`vite:error`), and the failed jobs of the studio host. The agent panel adds the errors of
 * the agent tools (agent/agentPanel.ts). A tap never writes to the console itself.
 */
import type { SceneLink } from "@scenity/runtime/client";
import { isWorkerLog } from "@scenity/runtime-dev/document/workerLog";
import { consoleText } from "../../core/bridge/workbenchConsole";
import { t } from "../../texts";
import type { ConsoleStore, LogLevel, LogSource } from "./consoleStore";

/** The parts of the window that the tap of the page uses (a test gives a fake). */
export interface PageLogHost {
  readonly console: Pick<Console, "error" | "warn" | "info" | "log">;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The source of a line of the page: "plugin" when a frame of its stack is in a plugin of the project. */
function pageSource(stack: string | undefined): LogSource {
  return stack?.split("\n").slice(2).join("\n").includes("/plugins/") === true ? "plugin" : "page";
}

/** Split a text into its first line and the rest (the detail). */
function lines(text: string): { text: string; detail: string | null } {
  const at = text.indexOf("\n");
  return at < 0 ? { text, detail: null } : { text: text.slice(0, at), detail: text.slice(at + 1) };
}

/** Tap the console and the uncaught errors of the page; the result restores them. */
export function tapPageConsole(store: ConsoleStore, host: PageLogHost = globalThis): () => void {
  const levels: Readonly<Record<"error" | "warn" | "info" | "log", LogLevel>> = {
    error: "error",
    warn: "warn",
    info: "info",
    log: "info",
  };
  const { error, warn, info, log } = host.console;
  const originals = { error, warn, info, log };
  const taps = Object.entries(levels).map(([method, level]) => {
    const name = method as keyof typeof levels;
    const original = originals[name].bind(host.console);
    const tap = (...values: unknown[]): void => {
      // Only an error or a warning pays for a stack (the source of a plugin).
      const source = level === "info" ? "page" : pageSource(new Error().stack);
      store.add({ level, source, ...lines(values.map(consoleText).join(" ")) });
      original(...values);
    };
    host.console[name] = tap;
    return [name, tap] as const;
  });
  const onError = (event: Event): void => {
    const item = event as ErrorEvent;
    const where = typeof item.filename === "string" && item.filename !== "" ? item.filename : "";
    const text = item.error instanceof Error ? consoleText(item.error) : `${item.message} ${where}`.trim();
    store.add({ level: "error", source: pageSource(`\n\n${where}\n${text}`), ...lines(text) });
  };
  const onRejection = (event: Event): void => {
    const text = t("console-rejection", { reason: consoleText((event as PromiseRejectionEvent).reason) });
    store.add({ level: "error", source: "page", ...lines(text) });
  };
  host.addEventListener("error", onError);
  host.addEventListener("unhandledrejection", onRejection);
  return () => {
    for (const [name, tap] of taps) if (host.console[name] === tap) host.console[name] = originals[name];
    host.removeEventListener("error", onError);
    host.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Take the console lines of the dev scene worker (a core on the main thread writes to the console of the page). */
export function tapWorkerLog(store: ConsoleStore, link: SceneLink<unknown>): void {
  if (link.mode !== "worker") return;
  link.listen((message) => {
    if (isWorkerLog(message)) store.add({ level: message.level, source: "worker", ...lines(message.text) });
  });
}

/** The parts of the HMR client of Vite that the tap of the dev server uses. */
export interface HotLike {
  on(event: "vite:error", listener: (payload: { err?: { message?: string; stack?: string } }) => void): void;
}

/** Take the errors of the dev server (a transform or a load that fails). */
export function tapServer(store: ConsoleStore, hot: HotLike | undefined): void {
  hot?.on("vite:error", (payload) => {
    const message = payload.err?.message ?? t("console-server-error");
    store.add({ level: "error", source: "server", ...lines(message), detail: payload.err?.stack ?? null });
  });
}

/** A job of the studio host as its events give it. */
interface JobEvent {
  readonly type?: unknown;
  readonly job?: { readonly argv?: readonly string[]; readonly state?: string; readonly exitCode?: number | null };
}

/** Take the failed jobs of the studio host (its event socket); the result stops it. */
export function tapJobs(store: ConsoleStore, socket: () => WebSocket): () => void {
  const events = socket();
  events.addEventListener("message", (message: MessageEvent<unknown>) => {
    let event: JobEvent;
    try {
      event = JSON.parse(String(message.data)) as JobEvent;
    } catch {
      return;
    }
    if (event.type !== "jobs.state" || event.job?.state !== "failed") return;
    const line = `scenity ${(event.job.argv ?? []).join(" ")}`;
    const code = event.job.exitCode === null || event.job.exitCode === undefined ? "?" : String(event.job.exitCode);
    store.add({ level: "error", source: "job", text: t("console-job-failed", { line, code }) });
  });
  return () => events.close();
}
