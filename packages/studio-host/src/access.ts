// SPDX-License-Identifier: Apache-2.0
/**
 * Access to the studio host. The host is a web server on 127.0.0.1 with file and agent access. Thus each request
 * passes these checks:
 *
 * - The `Host` header is the host itself (127.0.0.1 or localhost and its port). A DNS-rebinding page fails.
 * - A page has a session cookie (HttpOnly, SameSite=Strict) from a launch link. A tool (the CLI, an MCP server) sends
 *   the host secret in the header `x-studio-token`.
 * - A write (POST, PUT, PATCH, DELETE) or a WebSocket from a page has the host origin in `Origin`, and a write has the
 *   CSRF value of its session in the header `x-studio-csrf` (a second cookie that the page reads).
 *
 * A launch link holds a launch code: one use, 60 s. The host keeps a hash of each session in `host.json` (mode 600).
 * Thus a restart keeps the sessions. A session lasts 30 days.
 *
 * A launch code has a role, and its session keeps it. The owner (`admin`) can do all actions. An `editor` does no
 * owner action (the terminals, the trust, the links, the plugins). A `viewer` writes only the note files of the
 * scenes. A refusal names the role, so the page and a tool show the cause.
 *
 * The remote mode: the host behind the gateway of the studio (gateway.ts) has a public origin. The host then accepts
 * the `Host` and the `Origin` of the public origin too, and its launch links have the public origin. With HTTPS, the
 * cookies are `Secure`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { AgentRole } from "./agents/permissions";
import { JsonFile } from "./store";

export const SESSION_COOKIE = "scenity_studio";
export const CSRF_COOKIE = "scenity_studio_csrf";
export const TOKEN_HEADER = "x-studio-token";
export const CSRF_HEADER = "x-studio-csrf";
const CODE_LIFE_MS = 60_000;
/** The life of the code of a review link (a viewer opens it later). */
const REVIEW_LIFE_MS = 7 * 24 * 3600_000;
const SESSION_LIFE_MS = 30 * 24 * 3600_000;

const hostFileSchema = z.object({
  format: z.literal("scenity.studio-host/1"),
  origin: z.string(),
  pid: z.number().int(),
  secret: z.string().min(32),
  sessions: z.array(
    z.object({
      hash: z.string(),
      csrf: z.string(),
      created: z.number(),
      role: z.enum(["viewer", "editor", "admin"]).default("admin"),
    }),
  ),
});
export type HostFile = z.infer<typeof hostFileSchema>;

const random = (): string => randomBytes(32).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** True when `a` and `b` are the same text, in a time that does not depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The value of a cookie of a request, or null. */
export function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The writes of a viewer: the note files of the scenes (a viewer writes notes). */
const VIEWER_WRITES = /^\/projects\/[a-z0-9-]+\/.+\.notes\.json$/;
/** The actions of the owner only: the terminals, the trust, the links and the plugins of a project. */
const OWNER_PATHS = /^\/api\/(terminals|launch-code|projects\/(trust|remove))|^\/projects\/[a-z0-9-]+\/plugins\./;
/** The reasons of the refusals of a role. */
export const VIEWER_REFUSAL = "a viewer looks and leaves notes: a change needs a link with the editor role";
export const EDITOR_REFUSAL = "only the owner of the studio does this, not an editor";

/** The result of a check: null for a request that passes, else the status and the reason of the refusal. */
export type Refusal = { readonly status: number; readonly reason: string } | null;

/** The access state of the host: its secret, its launch codes and its sessions. */
export class StudioAccess {
  readonly #file: JsonFile<HostFile>;
  readonly #codes = new Map<string, { until: number; role: AgentRole }>();
  #state: HostFile;

  constructor(
    stateDir: string,
    readonly origin: string,
    private readonly now: () => number = Date.now,
    /** The public origin of the remote mode, or null for a local studio. */
    readonly publicOrigin: string | null = null,
  ) {
    this.#file = new JsonFile(join(stateDir, "host.json"), hostFileSchema, () => this.#fresh(), true);
    const old = this.#file.read();
    // A new host keeps the sessions of the last host (with the same origin) and gets a new secret.
    const sessions = old.origin === origin ? old.sessions.filter((s) => s.created + SESSION_LIFE_MS > now()) : [];
    this.#state = this.#file.write({ ...this.#fresh(), sessions });
  }

  #fresh(): HostFile {
    return { format: "scenity.studio-host/1", origin: this.origin, pid: process.pid, secret: random(), sessions: [] };
  }

  /** The origin of the launch links: the public origin in remote mode, else the origin of the host. */
  get linkOrigin(): string {
    return this.publicOrigin ?? this.origin;
  }

  /** The host secret of the tools (the CLI, an MCP server). */
  get secret(): string {
    return this.#state.secret;
  }

  /** A new launch code (one use, 60 s). Its session gets the role. A review code lasts 7 days. */
  launchCode(role: AgentRole = "admin", review = false): string {
    const code = random();
    this.#codes.set(hash(code), { until: this.now() + (review ? REVIEW_LIFE_MS : CODE_LIFE_MS), role });
    return code;
  }

  /** Use a launch code. The result is the cookies of a new session, or null for a code that is not valid. */
  useCode(code: string): { session: string; csrf: string } | null {
    const key = hash(code);
    const found = this.#codes.get(key);
    this.#codes.delete(key);
    if (found === undefined || found.until < this.now()) return null;
    const session = random();
    const csrf = random();
    this.#state = this.#file.write({
      ...this.#state,
      sessions: [...this.#state.sessions, { hash: hash(session), csrf, created: this.now(), role: found.role }],
    });
    return { session, csrf };
  }

  /** The cookies of a session, for a `Set-Cookie` header each. */
  cookies(session: string, csrf: string): string[] {
    const age = Math.floor(SESSION_LIFE_MS / 1000);
    const secure = this.publicOrigin?.startsWith("https:") === true ? "; Secure" : "";
    return [
      `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(age)}${secure}`,
      `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict; Max-Age=${String(age)}${secure}`,
    ];
  }

  /** The role of a request: a tool with the secret is the owner. Null with no session. */
  roleOf(request: Request): AgentRole | null {
    const token = request.headers.get(TOKEN_HEADER);
    if (token !== null) return sameSecret(token, this.secret) ? "admin" : null;
    return this.#session(request)?.role ?? null;
  }

  #session(request: Request): { csrf: string; role: AgentRole } | null {
    const value = cookieOf(request, SESSION_COOKIE);
    if (value === null) return null;
    const key = hash(value);
    return this.#state.sessions.find((s) => s.hash === key && s.created + SESSION_LIFE_MS > this.now()) ?? null;
  }

  /** True when the `Host` of a request is the host itself (or the public origin). */
  hostAllowed(request: Request): boolean {
    const port = new URL(this.origin).port;
    const host = request.headers.get("host") ?? "";
    const remote = this.publicOrigin !== null && host === new URL(this.publicOrigin).host;
    return remote || host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  /** True when an `Origin` header is the host itself (or the public origin). */
  ownOrigin(origin: string | null): boolean {
    const port = new URL(this.origin).port;
    return origin === this.origin || origin === `http://localhost:${port}` || origin === this.publicOrigin;
  }

  /**
   * Check a request. `upgrade` is true for a WebSocket upgrade. `csrf` is true for the API of the host: a write needs
   * the CSRF value. A write that the host passes to the scene server needs the origin only (the server has its own
   * save header and checks the origin too).
   */
  check(request: Request, upgrade = false, csrf = true): Refusal {
    if (!this.hostAllowed(request)) return { status: 421, reason: "the Host header is not this host" };
    const token = request.headers.get(TOKEN_HEADER);
    if (token !== null)
      return sameSecret(token, this.secret) ? null : { status: 401, reason: "the token is not valid" };
    const session = this.#session(request);
    if (session === null) return { status: 401, reason: "no session: open the studio with `scenity studio`" };
    const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if ((write || upgrade) && !this.ownOrigin(request.headers.get("origin")))
      return { status: 403, reason: "the Origin header is not this host" };
    if (write && csrf && !sameSecret(request.headers.get(CSRF_HEADER) ?? "", session.csrf)) {
      return { status: 403, reason: "the CSRF value is missing or wrong" };
    }
    // The role of the session.
    const path = new URL(request.url).pathname;
    if (session.role === "viewer" && (write || OWNER_PATHS.test(path)) && !VIEWER_WRITES.test(path))
      return { status: 403, reason: VIEWER_REFUSAL };
    if (session.role === "editor" && (write || upgrade) && OWNER_PATHS.test(path))
      return { status: 403, reason: EDITOR_REFUSAL };
    return null;
  }
}
