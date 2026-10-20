// SPDX-License-Identifier: Apache-2.0
/**
 * The host in Vue refs and the relay on a host client. The hello fills the checkout and the surfaces. A
 * `surface.state` event replaces one surface. A `surface.request` of the host goes into the frame and returns as
 * `surface.call`.
 */
import type { SurfaceState } from "@scenity/workbench-host/protocol";
import { effectScope, nextTick } from "vue";
import { describe, expect, test, vi } from "vitest";
import { HostClient } from "../../src/host/hostClient";
import { upsertSurface, useHost } from "../../src/host/useHost";
import { useSurfaceRelay, type RelayWindow } from "../../src/surfaces/useSurface";
import { socketFactory, type FakeSocket } from "./fakeSocket";

const TOKEN = "cd".repeat(32);
const LAB = "http://127.0.0.1:5400";
const CHECKOUT = { path: "/repo", branch: "main", head: "abc", changed: 0, open: true };
const SURFACE: SurfaceState = {
  id: "lab",
  kind: "scene",
  label: "Lab",
  capabilities: ["scene", "index"],
  checkout: "/repo",
  url: `${LAB}/?t=0`,
  server: { status: "ready", port: 5400, error: null },
  lastEdit: null,
};

function start() {
  const factory = socketFactory();
  const listeners = new Set<(event: MessageEvent) => void>();
  const win: RelayWindow = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const scope = effectScope();
  const api = scope.run(() => {
    const host = useHost({
      win: {
        location: { href: "http://127.0.0.1:5300/", origin: "http://127.0.0.1:5300" },
        history: { state: null, replaceState: () => undefined },
      },
      find: () =>
        Promise.resolve({ endpoint: { origin: "http://127.0.0.1:4100", token: TOKEN }, source: "url" as const }),
      makeClient: (endpoint, pageOrigin) => new HostClient({ endpoint, pageOrigin, socket: factory.make }),
    });
    return { host, relay: useSurfaceRelay(host.client, win) };
  });
  if (api === undefined) throw new Error("no scope");
  return { ...api, factory, listeners, scope };
}

async function greet(socket: FakeSocket): Promise<void> {
  socket.open();
  socket.push({
    id: socket.last("host.hello")?.id,
    ok: true,
    result: { protocol: 1, checkout: CHECKOUT, surfaces: [SURFACE] },
  });
  await vi.waitFor(() => undefined);
}

describe("useHost", () => {
  test("fills the checkout and the surfaces, and takes the surface.state events of the checkout", async () => {
    const { host, factory, scope } = start();
    await vi.waitFor(() => expect(factory.sockets).toHaveLength(1));
    const socket = factory.sockets[0]!;
    await greet(socket);
    await vi.waitFor(() => expect(host.state.value).toBe("connected"));
    expect(socket.sent[0]).toMatchObject({ type: "host.hello", origin: "http://127.0.0.1:5300" });
    expect(host.greeted.value).toBe(true);
    expect(host.checkout.value).toEqual(CHECKOUT);
    socket.push({ type: "surface.state", surface: { ...SURFACE, url: `${LAB}/?t=5` } });
    socket.push({ type: "surface.state", surface: { ...SURFACE, checkout: "/other", url: "x" } });
    expect(host.surfaces.value.map((surface) => surface.url)).toEqual([`${LAB}/?t=5`]);
    scope.stop();
    expect(socket.closed).toBe(true);
  });

  test("upsertSurface replaces by id and adds a new id", () => {
    const web = { ...SURFACE, id: "other" };
    expect(upsertSurface([SURFACE], web)).toEqual([SURFACE, web]);
    expect(upsertSurface([SURFACE, web], { ...SURFACE, url: null })).toEqual([{ ...SURFACE, url: null }, web]);
  });
});

describe("useSurfaceRelay", () => {
  test("relays a host request into the frame and the answer back to the host", async () => {
    const { relay, factory, listeners, scope } = start();
    await vi.waitFor(() => expect(factory.sockets).toHaveLength(1));
    const socket = factory.sockets[0]!;
    await greet(socket);
    await nextTick();
    const posted: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => posted.push(message) };
    relay.attach("lab", "visible", { window: frameWindow, origin: LAB });
    socket.push({ type: "surface.request", request: 9, surface: "lab", where: "visible", call: "url", args: [] });
    expect(posted).toEqual([{ workbench: 1, id: 1, call: "url", args: [] }]);
    for (const listener of listeners) {
      listener({
        source: frameWindow,
        origin: LAB,
        data: { workbench: 1, id: 1, result: `${LAB}/?t=5` },
      } as unknown as MessageEvent);
      listener({
        source: frameWindow,
        origin: LAB,
        data: { workbench: 1, event: "url", url: `${LAB}/?t=6` },
      } as unknown as MessageEvent);
    }
    expect(socket.last("surface.call")).toMatchObject({ request: 9, result: `${LAB}/?t=5` });
    expect(socket.last("surface.report")).toMatchObject({
      surface: "lab",
      where: "visible",
      event: { event: "url", url: `${LAB}/?t=6` },
    });
    scope.stop();
    expect(listeners.size).toBe(0);
  });
});
