// SPDX-License-Identifier: Apache-2.0
/**
 * The host client: the URL with the token, `host.hello` with the page origin, the answers by `id`, the time limit, the
 * events, and a new connection with a longer wait after a loss.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { backoffMs, HostClient, socketUrl, type HostStatus } from "../../src/host/hostClient";
import { socketFactory, type FakeSocket } from "./fakeSocket";

const TOKEN = "ab".repeat(32);
const ENDPOINT = { origin: "http://127.0.0.1:4100", token: TOKEN };
const HELLO = { protocol: 1, checkout: null, surfaces: [] };

function connected(): { client: HostClient; socket: FakeSocket; sockets: FakeSocket[]; statuses: HostStatus[] } {
  const factory = socketFactory();
  const client = new HostClient({
    endpoint: ENDPOINT,
    pageOrigin: "http://127.0.0.1:5300",
    socket: factory.make,
    timeoutMs: 1000,
  });
  const statuses: HostStatus[] = [];
  client.onStatus((status) => statuses.push(status));
  client.connect();
  const socket = factory.sockets[0]!;
  socket.open();
  const hello = socket.last("host.hello");
  socket.push({ id: hello?.id, ok: true, result: HELLO });
  return { client, socket, sockets: factory.sockets, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HostClient", () => {
  test("opens /ws with the token and says hello with the page origin", async () => {
    const { client, socket, statuses } = connected();
    expect(socket.url).toBe(`ws://127.0.0.1:4100/ws?token=${TOKEN}`);
    expect(socketUrl(ENDPOINT)).toBe(socket.url);
    expect(socket.sent[0]).toEqual({ id: 1, type: "host.hello", origin: "http://127.0.0.1:5300" });
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    expect(client.hello).toEqual(HELLO);
    expect(statuses).toEqual(["connected"]);
  });

  test("matches each answer to its request by id", async () => {
    const { client, socket } = connected();
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    const list = client.request("checkouts.list", {});
    const open = client.request("checkouts.open", { path: "/repo" });
    const openId = socket.last("checkouts.open")?.id;
    const listId = socket.last("checkouts.list")?.id;
    socket.push({ id: openId, ok: false, error: "No such worktree." });
    socket.push({ id: listId, ok: true, result: [] });
    await expect(list).resolves.toEqual([]);
    await expect(open).rejects.toThrow("No such worktree.");
  });

  test("fails a request after the time limit", async () => {
    const { client } = connected();
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    const list = client.request("checkouts.list", {});
    vi.advanceTimersByTime(1001);
    await expect(list).rejects.toThrow("did not answer checkouts.list in 1000 ms");
  });

  test("refuses a request before the connection", async () => {
    const client = new HostClient({ endpoint: ENDPOINT, pageOrigin: "x", socket: socketFactory().make });
    await expect(client.request("checkouts.list", {})).rejects.toThrow("not connected");
  });

  test("gives each event to its listeners and ignores other text", async () => {
    const { client, socket } = connected();
    const seen: unknown[] = [];
    const stop = client.on("surface.request", (payload) => seen.push(payload));
    socket.push({ type: "surface.request", request: 7, surface: "lab", where: "visible", call: "url", args: [] });
    socket.onmessage?.({ data: "not json" } as MessageEvent);
    socket.push({ type: "unknown.event" });
    stop();
    socket.push({ type: "surface.request", request: 8, surface: "lab", where: "visible", call: "url", args: [] });
    expect(seen).toEqual([{ request: 7, surface: "lab", where: "visible", call: "url", args: [] }]);
    await vi.waitFor(() => expect(client.status).toBe("connected"));
  });

  test("fails the open requests on a loss and connects again with a longer wait", async () => {
    const { client, socket, sockets, statuses } = connected();
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    const list = client.request("checkouts.list", {});
    socket.close();
    await expect(list).rejects.toThrow("closed");
    expect(client.status).toBe("lost");
    vi.advanceTimersByTime(backoffMs(1) - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // The second attempt fails at once: the wait doubles.
    sockets[1]?.close();
    vi.advanceTimersByTime(backoffMs(2) - 1);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = sockets[2]!;
    third.open();
    third.push({ id: third.last("host.hello")?.id, ok: true, result: HELLO });
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    expect(statuses).toEqual(["connected", "lost", "connected"]);
  });

  test("closes a socket whose hello fails, and stops for good on close()", async () => {
    const factory = socketFactory();
    const client = new HostClient({ endpoint: ENDPOINT, pageOrigin: "x", socket: factory.make });
    client.connect();
    const first = factory.sockets[0]!;
    first.open();
    first.push({ id: first.last("host.hello")?.id, ok: false, error: "protocol 2 needed" });
    await vi.waitFor(() => expect(first.closed).toBe(true));
    expect(client.status).toBe("lost");
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(factory.sockets).toHaveLength(1);
  });

  test("the wait doubles up to its limit", () => {
    expect([1, 2, 3, 10].map((failures) => backoffMs(failures))).toEqual([250, 500, 1000, 8000]);
  });
});
