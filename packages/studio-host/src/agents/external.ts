// SPDX-License-Identifier: Apache-2.0
/**
 * The external agents: an MCP client (Claude Code, Codex, Cursor, Claude Desktop) connects to the studio through
 * `scenity mcp` (mcp.ts). Its first step is a connection request. The owner allows or denies it in the studio (the
 * agent panel, the Hub). An allowed connection gets a token and an agent session of the project (Review by default).
 * Its tool calls are actions of that session, with the same gate, the same presence and the same change sets as the
 * built-in agent.
 */
import { randomBytes } from "node:crypto";

/** A connection request as the studio shows it (no token). */
export interface ConnectionView {
  readonly id: string;
  /** The name of the client ("Claude Code"). */
  readonly name: string;
  /** The project of the request, or null (the owner gives it on allow). */
  readonly project: string | null;
  readonly state: "pending" | "allowed" | "denied";
  /** The agent session of an allowed connection, or null. */
  readonly session: string | null;
  readonly at: number;
}

interface Connection extends ConnectionView {
  readonly token: string | null;
}

/** The connection requests of the external agents. */
export class Connections {
  readonly #items = new Map<string, Connection>();
  #next = 1;

  /** A new request. It waits for the owner. */
  request(name: string, project: string | null): ConnectionView {
    const id = `c${String(this.#next++)}`;
    const item: Connection = { id, name, project, state: "pending", session: null, at: Date.now(), token: null };
    this.#items.set(id, item);
    return this.#view(item);
  }

  /** A request with its token after the owner allows it (the client polls it), or null. */
  get(id: string): (ConnectionView & { readonly token: string | null }) | null {
    const item = this.#items.get(id);
    return item === undefined ? null : { ...this.#view(item), token: item.token };
  }

  /** Allow a request for a session. The result is the token of the client. */
  allow(id: string, session: string, project: string): string {
    const item = this.#pending(id);
    const token = randomBytes(24).toString("hex");
    this.#items.set(id, { ...item, project, state: "allowed", session, token });
    return token;
  }

  deny(id: string): void {
    const item = this.#pending(id);
    this.#items.set(id, { ...item, state: "denied" });
  }

  /** A connection that the owner makes in the Hub (an MCP client over HTTP): allowed, with its token. */
  add(name: string, project: string, session: string): { readonly view: ConnectionView; readonly token: string } {
    const id = `c${String(this.#next++)}`;
    const token = randomBytes(24).toString("hex");
    const item: Connection = { id, name, project, state: "allowed", session, at: Date.now(), token };
    this.#items.set(id, item);
    return { view: this.#view(item), token };
  }

  /** Revoke the token of a connection. After that, its client can call no tool. */
  revoke(id: string): void {
    const item = this.#items.get(id);
    if (item === undefined) throw new Error(`No connection request ${id}.`);
    this.#items.set(id, { ...item, state: "denied", token: null });
  }

  /** The session of a token, or null. */
  sessionOf(token: string | null): string | null {
    if (token === null || token === "") return null;
    for (const item of this.#items.values()) if (item.state === "allowed" && item.token === token) return item.session;
    return null;
  }

  /** The requests, the newest first. */
  list(): ConnectionView[] {
    return [...this.#items.values()].map((item) => this.#view(item)).sort((a, b) => b.at - a.at);
  }

  #pending(id: string): Connection {
    const item = this.#items.get(id);
    if (item === undefined) throw new Error(`No connection request ${id}.`);
    if (item.state !== "pending") throw new Error(`The connection request ${id} is ${item.state}.`);
    return item;
  }

  #view(item: Connection): ConnectionView {
    const { id, name, project, state, session, at } = item;
    return { id, name, project, state, session, at };
  }
}

/** The header of the token of an external agent. */
export const AGENT_TOKEN_HEADER = "x-agent-token";

/** The parts of the sessions that the API of the external agents uses (sessions.ts). */
export interface ExternalSessions {
  readonly connections: Connections;
  connectionsChanged(): void;
  create(project: string, patch: { readonly name: string; readonly external: true }): { readonly id: string };
  external(id: string, name: string, input: unknown): Promise<unknown>;
  externalTools(): unknown[];
}

function reply(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/**
 * The API of the external agents:
 * - `POST /api/agent/connect` with `{ name, project? }`: a connection request. `GET /api/agent/connect/<id>`: its
 *   state (the token after the owner allows it);
 * - `GET /api/agent/connections`; `POST /api/agent/connections/<id>/allow` with `{ project? }`, `…/deny`, `…/revoke`;
 * - `POST /api/agent/connections` with `{ name, project }`: an allowed connection for an MCP client over HTTP. The
 *   answer has its token (only this answer has it);
 * - with the header `x-agent-token`: `GET /api/agent/external/tools` and `POST /api/agent/external/call` with
 *   `{ name, arguments }`.
 * Null for another path.
 */
export async function externalApi(sessions: ExternalSessions, request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const own = ["/api/agent/connect", "/api/agent/connections", "/api/agent/external/"];
  if (!own.some((prefix) => path.startsWith(prefix))) return null;
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
  if (path === "/api/agent/connect" && request.method === "POST") {
    const view = sessions.connections.request(text(body.name) ?? "An external agent", text(body.project));
    sessions.connectionsChanged();
    return reply(view);
  }
  const asked = /^\/api\/agent\/connect\/(c\d+)$/.exec(path)?.[1];
  if (asked !== undefined) return reply(sessions.connections.get(asked) ?? { error: "no such request" }, 200);
  if (path === "/api/agent/connections" && request.method === "POST") {
    const name = text(body.name);
    const project = text(body.project);
    if (name === null || project === null) return reply({ error: "give the name and the project of the client" }, 400);
    const made = sessions.connections.add(name, project, sessions.create(project, { name, external: true }).id);
    sessions.connectionsChanged();
    return reply({ ...made.view, token: made.token });
  }
  if (path === "/api/agent/connections") return reply({ connections: sessions.connections.list() });
  const [, id, action] = /^\/api\/agent\/connections\/(c\d+)\/(allow|deny|revoke)$/.exec(path) ?? [];
  if (id !== undefined && action === "revoke" && request.method === "POST") {
    sessions.connections.revoke(id);
    sessions.connectionsChanged();
    return reply(sessions.connections.get(id));
  }
  if (id !== undefined && request.method === "POST") {
    const item = sessions.connections.get(id);
    const project = text(body.project) ?? item?.project ?? null;
    if (item === null || project === null) return reply({ error: "give the project of the connection" }, 400);
    if (action === "deny") sessions.connections.deny(id);
    else sessions.connections.allow(id, sessions.create(project, { name: item.name, external: true }).id, project);
    sessions.connectionsChanged();
    return reply(sessions.connections.get(id));
  }
  if (!path.startsWith("/api/agent/external/")) return null;
  const session = sessions.connections.sessionOf(request.headers.get(AGENT_TOKEN_HEADER));
  if (session === null) return reply({ error: "the token of the agent is not valid" }, 401);
  if (path === "/api/agent/external/tools") return reply({ tools: sessions.externalTools() });
  if (path === "/api/agent/external/call" && request.method === "POST") {
    const name = text(body.name);
    if (name === null) return reply({ error: "give the name of the tool" }, 400);
    return reply(await sessions.external(session, name, body.arguments ?? {}));
  }
  return reply({ error: "no such path" }, 404);
}
