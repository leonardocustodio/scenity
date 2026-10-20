// SPDX-License-Identifier: Apache-2.0
// Access to the studio host: the Host check against DNS rebinding, the session cookie from a one-use launch code, the
// token of the tools, the Origin check and the CSRF value of writes. Also the roles of the studio.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  EDITOR_REFUSAL,
  SESSION_COOKIE,
  StudioAccess,
  TOKEN_HEADER,
  VIEWER_REFUSAL,
} from "../src/access";

const ORIGIN = "http://127.0.0.1:5170";
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "studio-access-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(
  init: { method?: string; host?: string; origin?: string; cookie?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  headers.set("host", init.host ?? "127.0.0.1:5170");
  if (init.origin !== undefined) headers.set("origin", init.origin);
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  return new Request(`${ORIGIN}/api/state`, { method: init.method ?? "GET", headers });
}

function session(access: StudioAccess): { cookie: string; csrf: string } {
  const made = access.useCode(access.launchCode());
  if (made === null) throw new Error("no session");
  return { cookie: `${SESSION_COOKIE}=${made.session}; ${CSRF_COOKIE}=${made.csrf}`, csrf: made.csrf };
}

describe("access to the studio host", () => {
  test("refuses a rebinding Host, a request with no session and a bad token", () => {
    const access = new StudioAccess(temp(), ORIGIN);
    expect(access.check(request({ host: "evil.example:5170" }))?.status).toBe(421);
    expect(access.check(request())?.status).toBe(401);
    expect(access.check(request({ headers: { [TOKEN_HEADER]: "wrong" } }))?.status).toBe(401);
    expect(access.check(request({ headers: { [TOKEN_HEADER]: access.secret } }))).toBeNull();
    expect(access.check(request({ host: "localhost:5170", headers: { [TOKEN_HEADER]: access.secret } }))).toBeNull();
  });

  test("a launch code gives one session, once, for 60 s", () => {
    let now = 1000;
    const access = new StudioAccess(temp(), ORIGIN, () => now);
    const code = access.launchCode();
    expect(access.useCode(code)).not.toBeNull();
    expect(access.useCode(code)).toBeNull();
    const late = access.launchCode();
    now += 61_000;
    expect(access.useCode(late)).toBeNull();
  });

  test("the session cookie is HttpOnly and SameSite=Strict; the CSRF cookie is readable", () => {
    const access = new StudioAccess(temp(), ORIGIN);
    const [sessionCookie, csrfCookie] = access.cookies("s", "c");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Strict");
    expect(csrfCookie).not.toContain("HttpOnly");
  });

  test("a page reads with its session; a write needs the origin and the CSRF value", () => {
    const access = new StudioAccess(temp(), ORIGIN);
    const { cookie, csrf } = session(access);
    expect(access.check(request({ cookie }))).toBeNull();
    expect(access.check(request({ method: "POST", cookie, origin: "https://evil.example" }))?.status).toBe(403);
    expect(access.check(request({ method: "POST", cookie, origin: ORIGIN }))?.status).toBe(403);
    expect(
      access.check(request({ method: "POST", cookie, origin: ORIGIN, headers: { [CSRF_HEADER]: csrf } })),
    ).toBeNull();
    // A write that goes to the scene server needs the origin only.
    expect(access.check(request({ method: "POST", cookie, origin: ORIGIN }), false, false)).toBeNull();
    // A WebSocket from another origin fails.
    expect(access.check(request({ cookie, origin: "https://evil.example" }), true)?.status).toBe(403);
  });

  test("a new host keeps the sessions of the last one, with a new secret, in a file of mode 600", () => {
    const dir = temp();
    const first = new StudioAccess(dir, ORIGIN);
    const { cookie } = session(first);
    const second = new StudioAccess(dir, ORIGIN);
    expect(second.secret).not.toBe(first.secret);
    expect(second.check(request({ cookie }))).toBeNull();
    expect(statSync(join(dir, "host.json")).mode & 0o777).toBe(0o600);
  });
});

describe("the roles of the studio", () => {
  /** A request of a session of a role to a path. */
  function asRole(access: StudioAccess, role: "viewer" | "editor", method: string, path: string): Request {
    const made = access.useCode(access.launchCode(role));
    if (made === null) throw new Error("no session");
    const headers = new Headers({
      host: "127.0.0.1:5170",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE}=${made.session}; ${CSRF_COOKIE}=${made.csrf}`,
      [CSRF_HEADER]: made.csrf,
    });
    return new Request(`${ORIGIN}${path}`, { method, headers });
  }

  test("a viewer reads and writes the note files only; the refusal says why", () => {
    const access = new StudioAccess(temp(), ORIGIN);
    expect(access.check(asRole(access, "viewer", "GET", "/api/state"))).toBeNull();
    expect(access.check(asRole(access, "viewer", "POST", "/api/projects/open"))).toEqual({
      status: 403,
      reason: VIEWER_REFUSAL,
    });
    expect(access.check(asRole(access, "viewer", "POST", "/projects/room/scenes/main.scene.json"))?.status).toBe(403);
    expect(access.check(asRole(access, "viewer", "POST", "/projects/room/scenes/main.notes.json"))).toBeNull();
    expect(access.check(asRole(access, "viewer", "GET", "/api/terminals"))?.status).toBe(403);
    expect(access.roleOf(asRole(access, "viewer", "GET", "/api/state"))).toBe("viewer");
  });

  test("an editor changes the project but does no action of the owner", () => {
    const access = new StudioAccess(temp(), ORIGIN);
    expect(access.check(asRole(access, "editor", "POST", "/projects/room/scenes/main.scene.json"))).toBeNull();
    expect(access.check(asRole(access, "editor", "POST", "/api/projects/trust"))).toEqual({
      status: 403,
      reason: EDITOR_REFUSAL,
    });
    expect(access.check(asRole(access, "editor", "POST", "/api/launch-code"))?.status).toBe(403);
    expect(access.roleOf(asRole(access, "editor", "GET", "/api/state"))).toBe("editor");
    // A tool with the secret is the owner.
    const tool = new Request(`${ORIGIN}/api/state`, {
      headers: { host: "127.0.0.1:5170", [TOKEN_HEADER]: access.secret },
    });
    expect(access.roleOf(tool)).toBe("admin");
  });
});
