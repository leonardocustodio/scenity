// SPDX-License-Identifier: Apache-2.0
/**
 * The picture path of the page. The relay takes the bytes out of a frame answer. The host client sends them as one
 * binary frame before the JSON `surface.call`. The picture cache reads a picture by ID with the token header. It keeps
 * one object URL for each picture until the last view releases it.
 */
import { readPictureFrame } from "@scenity/workbench-host/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HostClient } from "../../src/host/hostClient";
import { PictureCache, pictureSource } from "../../src/host/pictures";
import { createRelay, splitPicture, type FrameTarget, type RelayPicture } from "../../src/surfaces/relay";
import { socketFactory } from "./fakeSocket";

const ENDPOINT = { origin: "http://127.0.0.1:4100", token: "ab".repeat(32) };
const ID = "0123456789abcdef0123456789abcdef";
const LAB = "http://127.0.0.1:5400";

describe("the relay of a picture answer", () => {
  test("a result with bytes gives the byte count in the JSON and the bytes beside it", () => {
    const bytes = new Uint8Array([82, 73, 70, 70]).buffer;
    const answers: { params: unknown; picture: RelayPicture | undefined }[] = [];
    const relay = createRelay({
      answer: (params, picture) => answers.push({ params, picture }),
      report: () => undefined,
    });
    const frame: FrameTarget = { origin: LAB, window: { postMessage: () => undefined } };
    relay.attach("lab", "visible", frame);
    relay.request({ request: 7, surface: "lab", where: "visible", call: "capture", args: [640] });
    const result = { simMs: 5, width: 640, height: 400, mime: "image/jpeg", bytes };
    relay.receive({ source: frame.window, origin: LAB, data: { workbench: 1, id: 1, result } });
    expect(answers).toEqual([
      {
        params: { request: 7, result: { simMs: 5, width: 640, height: 400, mime: "image/jpeg", bytes: 4 } },
        picture: { mime: "image/jpeg", bytes },
      },
    ]);
    expect(splitPicture({ data: "AAAA" })).toBeNull();
    expect(splitPicture(null)).toBeNull();
  });
});

describe("the binary frame of the host client", () => {
  test("the bytes go as one frame before the JSON answer of the same request", async () => {
    const factory = socketFactory();
    const client = new HostClient({ endpoint: ENDPOINT, pageOrigin: "http://x", socket: factory.make });
    client.connect();
    const socket = factory.sockets[0]!;
    socket.open();
    socket.push({ id: socket.last("host.hello")?.id, ok: true, result: { protocol: 3, checkout: null, surfaces: [] } });
    await Promise.resolve();
    client.sendPicture(7, "image/webp", new Uint8Array([1, 2, 3]).buffer);
    void client.request("surface.call", { request: 7, result: { bytes: 3 } }).catch(() => undefined);
    const [frame] = socket.binary;
    expect(frame?.after).toBe(socket.sent.length - 1);
    const read = readPictureFrame(new Uint8Array(await frame!.blob.arrayBuffer()));
    expect(read?.request).toBe(7);
    expect(read?.mime).toBe("image/webp");
    expect([...(read?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(pictureSource()).toBe(client.pictures);
    client.close();
    expect(() => client.sendPicture(8, "image/webp", new ArrayBuffer(1))).toThrow("not connected");
  });
});

describe("the picture cache", () => {
  let made: number;
  let revoked: string[];
  let fetches: { url: string; token: string | null }[];

  function cache(status = 200): PictureCache {
    return new PictureCache({
      endpoint: ENDPOINT,
      keepMs: 1000,
      fetch: ((url: string, init: RequestInit) => {
        fetches.push({ url, token: new Headers(init.headers).get("x-workbench-token") });
        return Promise.resolve(new Response(new Blob([new Uint8Array([1])]), { status }));
      }) as typeof fetch,
      createUrl: () => `blob:test-${String((made += 1))}`,
      revokeUrl: (url) => revoked.push(url),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    made = 0;
    revoked = [];
    fetches = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("one fetch with the token per picture; the URL goes after the last release and the keep time", async () => {
    const pictures = cache();
    const [a, b] = await Promise.all([pictures.acquire(ID), pictures.acquire(ID)]);
    expect([a, b]).toEqual(["blob:test-1", "blob:test-1"]);
    expect(fetches).toEqual([{ url: `${ENDPOINT.origin}/pictures/${ID}`, token: ENDPOINT.token }]);
    pictures.release(ID);
    pictures.release(ID);
    vi.advanceTimersByTime(500);
    // A view that returns in the keep time loads nothing again.
    expect(await pictures.acquire(ID)).toBe("blob:test-1");
    pictures.release(ID);
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(["blob:test-1"]);
    expect(pictures.size).toBe(0);
    expect(fetches).toHaveLength(1);
  });

  test("a failed load leaves the cache; a bad ID never fetches; clear revokes every URL", async () => {
    const missing = cache(404);
    await expect(missing.acquire(ID)).rejects.toThrow("404");
    expect(missing.size).toBe(0);
    await expect(missing.acquire("../state.json")).rejects.toThrow("Not a picture ID");
    expect(fetches).toHaveLength(1);
    const pictures = cache();
    await pictures.acquire(ID);
    pictures.clear();
    expect(revoked).toEqual(["blob:test-1"]);
  });
});
