// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the CORS answers of the host and of the lab frame defaults. The page of the labs app (`tauri://localhost`)
 * and a page of a `host.hello` read the HTTP paths with the token. Other origins get no CORS headers. A lab frame URL
 * gets `worker=1` unless it sets `worker`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { TOKEN_HEADER } from "../src/protocol";
import { startServer } from "../src/server";
import { labDefaults } from "../src/surfaces";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "55".repeat(32);
const server = startServer({
  port: 0,
  token: TOKEN,
  onMessage: () => Promise.resolve(null),
  http: () => Response.json({ ok: true }),
});
afterAll(() => server.stop());

function ask(method: string, origin: string | null, token = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.origin = origin;
  if (token) headers[TOKEN_HEADER] = TOKEN;
  return fetch(`${server.origin}/context`, { method, headers });
}

describe("CORS", () => {
  test("the app page gets the preflight and the headers", async () => {
    const preflight = await ask("OPTIONS", "tauri://localhost", false);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(preflight.headers.get("access-control-allow-headers")).toContain(TOKEN_HEADER);
    const answer = await ask("GET", "tauri://localhost");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
  });

  test("another origin gets no CORS headers; a request without the token stays 401", async () => {
    expect((await ask("OPTIONS", "http://evil.example", false)).status).toBe(403);
    const answer = await ask("GET", "http://evil.example");
    expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    const plain = await ask("GET", null, false);
    expect(plain.status).toBe(401);
  });
});

describe("the lab frame defaults", () => {
  test("worker=1 unless the URL sets worker", () => {
    const scene = { capabilities: ["scene"] };
    expect(labDefaults(scene, "http://127.0.0.1:1/?take=greet")).toBe("http://127.0.0.1:1/?take=greet&worker=1");
    expect(labDefaults(scene, "http://127.0.0.1:1/?worker=0")).toBe("http://127.0.0.1:1/?worker=0");
    expect(labDefaults(scene, null)).toBeNull();
  });

  test("a surface without the scene capability keeps its URL", () => {
    expect(labDefaults({ capabilities: ["index"] }, "http://127.0.0.1:1/")).toBe("http://127.0.0.1:1/");
  });
});
