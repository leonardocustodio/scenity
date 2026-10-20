// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the token and of the loopback server: `/health` without the token, 401
 * without the correct token, 200 with it, and the WebSocket with the token in the query.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { TOKEN_ENV, TOKEN_HEADER, answerOk, isToken } from "../src/protocol";
import { startServer } from "../src/server";
import { makeToken, sameToken } from "../src/token";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "ab".repeat(32);

describe("the launch token", () => {
  test("a new token is 32 random bytes as hex", () => {
    const a = makeToken({});
    const b = makeToken({});
    expect(isToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  test("the environment variable sets the token", () => {
    expect(makeToken({ [TOKEN_ENV]: TOKEN })).toBe(TOKEN);
    expect(() => makeToken({ [TOKEN_ENV]: "short" })).toThrow(TOKEN_ENV);
  });

  test("the compare accepts only the same text", () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(TOKEN.toUpperCase(), TOKEN)).toBe(false);
    expect(sameToken("", TOKEN)).toBe(false);
    expect(sameToken(null, TOKEN)).toBe(false);
    expect(sameToken(`${TOKEN}0`, TOKEN)).toBe(false);
  });
});

describe("the server", () => {
  const server = startServer({
    port: 0,
    token: TOKEN,
    onMessage: (_client, text) => Promise.resolve(answerOk(1, { echo: text })),
    http: (_request, url) => (url.pathname === "/context" ? new Response("packet") : null),
  });
  afterAll(() => server.stop());

  test("it binds 127.0.0.1 on a free port", () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);
  });

  test("/health needs no token", async () => {
    const response = await fetch(`${server.origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("another path without the token gets 401", async () => {
    expect((await fetch(`${server.origin}/context`)).status).toBe(401);
    const wrong = await fetch(`${server.origin}/context`, { headers: { [TOKEN_HEADER]: "cd".repeat(32) } });
    expect(wrong.status).toBe(401);
    expect((await fetch(`${server.origin}/context?token=${TOKEN}`)).status).toBe(401);
  });

  test("a path with the token gets 200, and an unknown path 404", async () => {
    const response = await fetch(`${server.origin}/context`, { headers: { [TOKEN_HEADER]: TOKEN } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("packet");
    expect((await fetch(`${server.origin}/other`, { headers: { [TOKEN_HEADER]: TOKEN } })).status).toBe(404);
  });

  test("/ws without the correct token gets 401", async () => {
    expect((await fetch(`${server.origin}/ws`)).status).toBe(401);
    expect((await fetch(`${server.origin}/ws?token=${"cd".repeat(32)}`)).status).toBe(401);
  });

  test("/ws with the token opens a WebSocket that answers", async () => {
    const socket = new WebSocket(`${server.origin.replace("http", "ws")}/ws?token=${TOKEN}`);
    const message = new Promise<string>((resolve) => {
      socket.addEventListener("message", (event) => resolve(String(event.data)));
    });
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    expect(server.clients()).toHaveLength(1);
    socket.send("hello");
    expect(JSON.parse(await message)).toEqual({ id: 1, ok: true, result: { echo: "hello" } });
    socket.close();
  });
});
