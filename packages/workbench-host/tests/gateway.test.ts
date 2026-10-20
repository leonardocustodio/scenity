// SPDX-License-Identifier: Apache-2.0
// The Scenity gateway (src/gateway/): the relay of HTTP and WebSockets to the host (only with the host token) and to
// the lab dev server, and the private host paths.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { connect } from "node:net";
import { gatewayFetch } from "../src/gateway/gateway";
import { GATEWAY_MAX_BODY_BYTES, gatewayEnv, gatewayServeOptions } from "../src/gateway/main";
import { socketRelay, type SocketData } from "../src/gateway/proxy";
import { HOST_BODY_MAX_BYTES, IMPORT_MAX_BYTES } from "../src/importProtocol";
import { labGateKey, makeLabTicket } from "../src/labTicket";
import { SERVE_OPTIONS } from "../src/server";

const HOST_TOKEN = "a".repeat(64);
const LAB_BASE = "/s/secret123/";
const ROLE_TOKEN = "c".repeat(64);

/** A fake host: `/health`, an echo of the path and the token header, and an echo WebSocket on `/ws`. */
function fakeHost(): Server<undefined> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        const token = url.searchParams.get("token");
        if (token !== HOST_TOKEN && token !== ROLE_TOKEN) return new Response("no", { status: 401 });
        if (server.upgrade(request, { data: undefined })) return undefined;
      }
      if (url.pathname === "/health") return new Response("ok");
      const body = { path: url.pathname, search: url.search, token: request.headers.get("x-workbench-token") };
      return Response.json(body, { headers: { "x-from": "host" } });
    },
    websocket: {
      message(ws, message) {
        ws.send(typeof message === "string" ? `echo:${message}` : message);
      },
    },
  });
}

/**
 * A fake lab dev server: a page under the base path and an HMR WebSocket with the `vite-hmr` subprotocol. It refuses
 * a request without the gate key, as scripts/labsGate.ts of apps/editor does.
 */
function fakeLab(): Server<undefined> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (request.headers.get("x-scenity-lab-gate") !== labGateKey(HOST_TOKEN))
        return new Response("gate", { status: 401 });
      if (request.headers.get("cookie") !== null) return new Response("a cookie came through", { status: 500 });
      if (request.headers.get("upgrade") === "websocket") {
        const protocol = request.headers.get("sec-websocket-protocol") ?? "";
        return server.upgrade(request, { data: undefined, headers: { "sec-websocket-protocol": protocol } })
          ? undefined
          : new Response("no", { status: 400 });
      }
      return new Response(`lab ${url.pathname}${url.search}`);
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message: () => undefined,
    },
  });
}

let host: Server<undefined>;
let lab: Server<undefined>;
let gateway: Server<SocketData>;
let base: string;

beforeAll(() => {
  host = fakeHost();
  lab = fakeLab();
  gateway = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: gatewayFetch({
      hostToken: HOST_TOKEN,
      hostOrigin: `http://127.0.0.1:${String(host.port)}`,
      labOrigin: `http://127.0.0.1:${String(lab.port)}`,
      labBase: LAB_BASE,
      roleTokens: [ROLE_TOKEN],
    }),
    websocket: socketRelay,
  });
  base = `http://127.0.0.1:${String(gateway.port)}`;
});

afterAll(() => {
  void gateway.stop(true);
  void host.stop(true);
  void lab.stop(true);
});

/** The WebSocket of Bun with its options form (the headers of the upgrade request). */
const BunSocket = WebSocket as unknown as new (
  url: string,
  options: { readonly protocols: string[]; readonly headers: Readonly<Record<string, string>> },
) => WebSocket;

/** Open a WebSocket and give its first message. */
function firstMessage(url: string, protocols: string[] = [], headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new BunSocket(url, { protocols, headers });
    socket.addEventListener("open", () => {
      socket.send("hello");
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      resolve(event.data);
      socket.close();
    });
    socket.addEventListener("error", () => {
      reject(new Error("socket error"));
    });
  });
}

describe("the relay", () => {
  test("a host path goes to the host without the /host prefix, with the host token of the request", async () => {
    const answer = await fetch(`${base}/host/pictures/x?size=2`, { headers: { "x-workbench-token": HOST_TOKEN } });
    expect(answer.headers.get("x-from")).toBe("host");
    expect(await answer.json()).toEqual({ path: "/pictures/x", search: "?size=2", token: HOST_TOKEN });
  });

  test("a host request without the host token, or with a wrong token, gets 401", async () => {
    expect((await fetch(`${base}/host/pictures/x`)).status).toBe(401);
    const wrong = "b".repeat(64);
    expect((await fetch(`${base}/host/pictures/x`, { headers: { "x-workbench-token": wrong } })).status).toBe(401);
  });

  test("the private host paths are not public", async () => {
    for (const path of ["/host/hooks/stop", "/host/context", "/host/tools/lab_shot", "/host/auth/login"])
      expect((await fetch(`${base}${path}`, { headers: { "x-workbench-token": HOST_TOKEN } })).status).toBe(404);
  });

  test("the hooks of a background run are not public; the other loop paths are", async () => {
    const headers = { "x-workbench-token": HOST_TOKEN };
    for (const path of ["/host/loops/run-1/hooks/Stop", "/host/loops/run-1/hooks/PreToolUse", "/host/loops/x/hooks"])
      expect((await fetch(`${base}${path}`, { method: "POST", headers })).status).toBe(404);
    const answer = await fetch(`${base}/host/loops/run-1`, { headers });
    expect(await answer.json()).toEqual({ path: "/loops/run-1", search: "", token: HOST_TOKEN });
  });

  test("the gateway has no login paths", async () => {
    expect((await fetch(`${base}/auth/login`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/auth/check`)).status).toBe(404);
  });

  test("the WebSocket of the host needs the host token", async () => {
    expect(await firstMessage(`${base.replace("http", "ws")}/host/ws?token=${HOST_TOKEN}`)).toBe("echo:hello");
    const refused = await firstMessage(`${base.replace("http", "ws")}/host/ws?token=${"b".repeat(64)}`).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);
  });

  test("a role token opens the host paths too; the host gives it its role", async () => {
    const answer = await fetch(`${base}/host/pictures/x`, { headers: { "x-workbench-token": ROLE_TOKEN } });
    expect(answer.status).toBe(200);
    expect(await firstMessage(`${base.replace("http", "ws")}/host/ws?token=${ROLE_TOKEN}`)).toBe("echo:hello");
  });

  test("the lab needs the lab ticket; the ticket gives a cookie, and the lab server gets the gate key", async () => {
    expect((await fetch(`${base}${LAB_BASE}?take=greet`)).status).toBe(401);
    expect((await fetch(`${base}${LAB_BASE}?labTicket=1.${"x".repeat(43)}`)).status).toBe(401);
    const ticket = makeLabTicket(HOST_TOKEN);
    const first = await fetch(`${base}${LAB_BASE}?take=greet&labTicket=${ticket}`);
    // The lab server sees the request without the ticket and without the cookie.
    expect(await first.text()).toBe(`lab ${LAB_BASE}?take=greet`);
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`scenity_lab=${ticket}`);
    for (const part of [`Path=${LAB_BASE}`, "HttpOnly", "Secure", "SameSite=None", "Partitioned"])
      expect(cookie).toContain(part);
    const next = await fetch(`${base}${LAB_BASE}src/main.ts`, { headers: { cookie: `scenity_lab=${ticket}` } });
    expect(await next.text()).toBe(`lab ${LAB_BASE}src/main.ts`);
    expect(next.headers.get("set-cookie")).toBeNull();
    // A forged gate header of the browser does not help.
    const forged = await fetch(`${base}${LAB_BASE}`, { headers: { "x-scenity-lab-gate": labGateKey(HOST_TOKEN) } });
    expect(forged.status).toBe(401);
  });

  test("the HMR WebSocket of the lab with the cookie, and no socket without it", async () => {
    const socketBase = `${base.replace("http", "ws")}${LAB_BASE}`;
    const cookie = { cookie: `scenity_lab=${makeLabTicket(HOST_TOKEN)}` };
    expect(await firstMessage(socketBase, ["vite-hmr"], cookie)).toBe("connected");
    const refused = await firstMessage(socketBase, ["vite-hmr"]).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);
    expect((await fetch(`${base}/s/other/`)).status).toBe(404);
  });

  test("health follows the host", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

/** Send the head of a POST request with a Content-Length and no body, and give the status line of the answer. */
function postHead(port: number, length: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`POST /host/imports HTTP/1.1\r\nHost: x\r\nContent-Length: ${String(length)}\r\n\r\n`);
    });
    let text = "";
    const done = (): void => {
      socket.destroy();
      resolve(text.split("\r\n")[0] ?? "");
    };
    socket.on("data", (data) => {
      text += String(data);
      done();
    });
    socket.on("close", done);
    setTimeout(done, 500);
  });
}

describe("the body limit of the gateway", () => {
  test("is the body limit of the host server, above the largest import", () => {
    expect(GATEWAY_MAX_BODY_BYTES).toBe(HOST_BODY_MAX_BYTES);
    expect(SERVE_OPTIONS.maxRequestBodySize).toBe(HOST_BODY_MAX_BYTES);
    expect(HOST_BODY_MAX_BYTES).toBeGreaterThan(IMPORT_MAX_BYTES);
    expect(HOST_BODY_MAX_BYTES).toBeLessThan(IMPORT_MAX_BYTES + 2 * 1024 * 1024);
  });

  test("the gateway server refuses a body above the limit with 413", async () => {
    const env = { SCENITY_HOST_TOKEN: HOST_TOKEN, SCENITY_LAB_BASE: LAB_BASE, SCENITY_HOST_PORT: String(host.port) };
    const { setup } = gatewayEnv(env);
    const server = Bun.serve<SocketData>(gatewayServeOptions(setup, 0, "127.0.0.1"));
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(await postHead(server.port ?? 0, GATEWAY_MAX_BODY_BYTES + 1)).toContain("413");
    } finally {
      void server.stop(true);
    }
  });
});
