// SPDX-License-Identifier: Apache-2.0
/**
 * The client of the terminals of the studio host: the API `/api/terminals` with the session
 * of the studio, and the events `terminal.output` and `terminal.exit` of the socket `/events`.
 */
import { csrfValue } from "../../hub/studioApi";

export type TerminalKind = "claude" | "shell";

/** The answer of an open: the terminal and its scrollback. */
export interface TerminalOpened {
  readonly terminal: string;
  readonly kind: TerminalKind;
  readonly cwd: string;
  readonly attached: boolean;
  readonly replay: string;
  readonly exit: { readonly code: number | null; readonly signal: string | null } | null;
}

export type TerminalEvent =
  | { readonly type: "terminal.output"; readonly terminal: string; readonly data: string }
  | { readonly type: "terminal.exit"; readonly terminal: string; readonly code: number | null };

export interface TerminalClient {
  open(kind: TerminalKind, project: string, cols: number, rows: number, terminal?: string): Promise<TerminalOpened>;
  input(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  /** Follow the events of the terminals. The result stops it. */
  events(listener: (event: TerminalEvent) => void): () => void;
}

/** The client over `fetch`. */
export function terminalClient(): TerminalClient {
  const call = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const answer = await fetch(path, {
      method,
      headers: { "x-studio-csrf": csrfValue(), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await answer.json().catch(() => ({}))) as T & { error?: string };
    if (!answer.ok) throw new Error(data.error ?? `${method} ${path}: ${String(answer.status)}`);
    return data;
  };
  const one = (id: string, action = ""): string => `/api/terminals/${encodeURIComponent(id)}${action}`;
  return {
    open: (kind, project, cols, rows, terminal) =>
      call("/api/terminals", "POST", { kind, project, cols, rows, ...(terminal === undefined ? {} : { terminal }) }),
    input: async (id, data) => {
      await call(one(id, "/input"), "POST", { data });
    },
    resize: async (id, cols, rows) => {
      await call(one(id, "/resize"), "POST", { cols, rows });
    },
    close: async (id) => {
      await call(one(id), "DELETE");
    },
    events: (listener) => {
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as { type?: unknown };
        if (event.type === "terminal.output" || event.type === "terminal.exit") listener(event as TerminalEvent);
      };
      return () => socket.close();
    },
  };
}
