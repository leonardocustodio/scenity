// SPDX-License-Identifier: Apache-2.0
/**
 * The endpoint of the host: the Tauri command first, then `?host=` and `#token=` of the page URL. The page removes the
 * token from the address bar at once and keeps the endpoint in the session storage, so a reload works.
 */
import { describe, expect, test } from "vitest";
import { ENDPOINT_STORAGE_KEY, findEndpoint, readUrlEndpoint, type EndpointWindow } from "../../src/host/endpoint";

const TOKEN = "0f".repeat(32);
const HOST = "http://127.0.0.1:4100";

function fakeWindow(href: string, storage: Map<string, string> | "blocked" = new Map()) {
  const location = { href };
  const replaced: string[] = [];
  const win: EndpointWindow = {
    location,
    history: {
      state: null,
      replaceState: (_state, _unused, url) => {
        replaced.push(url);
        location.href = url;
      },
    },
    get sessionStorage() {
      if (storage === "blocked") throw new Error("SecurityError");
      return {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
      };
    },
  };
  return { win, replaced, location };
}

describe("readUrlEndpoint", () => {
  test("reads the token once, removes it from the URL and keeps the endpoint", () => {
    const storage = new Map<string, string>();
    const { win, replaced, location } = fakeWindow(
      `http://127.0.0.1:5300/?host=${encodeURIComponent(HOST)}#token=${TOKEN}`,
      storage,
    );
    expect(readUrlEndpoint(win)).toEqual({ endpoint: { origin: HOST, token: TOKEN }, source: "url" });
    expect(replaced).toEqual([`http://127.0.0.1:5300/?host=${encodeURIComponent(HOST)}`]);
    expect(location.href).not.toContain(TOKEN);
    expect(JSON.parse(storage.get(ENDPOINT_STORAGE_KEY) ?? "{}")).toEqual({ origin: HOST, token: TOKEN });
    // The reload: no fragment, the storage gives the token.
    expect(readUrlEndpoint(win)).toEqual({ endpoint: { origin: HOST, token: TOKEN }, source: "storage" });
  });

  test("keeps other fragment values and removes a token that is not valid", () => {
    const { win, location } = fakeWindow(`http://127.0.0.1:5300/?host=${HOST}/#token=short&panel=1`);
    expect(readUrlEndpoint(win)).toBeNull();
    expect(location.href).toBe(`http://127.0.0.1:5300/?host=${HOST}/#panel=1`);
  });

  test("gives null for a host that is not a loopback origin, or a stored token of another host", () => {
    const storage = new Map([
      [ENDPOINT_STORAGE_KEY, JSON.stringify({ origin: "http://127.0.0.1:4200", token: TOKEN })],
    ]);
    expect(readUrlEndpoint(fakeWindow(`http://x/?host=http://example.com:80#token=${TOKEN}`).win)).toBeNull();
    expect(readUrlEndpoint(fakeWindow(`http://x/?host=${HOST}`, storage).win)).toBeNull();
    expect(readUrlEndpoint(fakeWindow("http://x/").win)).toBeNull();
  });

  test("works with a blocked storage, without the reload", () => {
    const { win } = fakeWindow(`http://x/?host=${HOST}#token=${TOKEN}`, "blocked");
    expect(readUrlEndpoint(win)?.endpoint.token).toBe(TOKEN);
    expect(readUrlEndpoint(win)).toBeNull();
  });
});

describe("findEndpoint", () => {
  test("asks the labs app first", async () => {
    const { win } = fakeWindow(`http://x/?host=${HOST}#token=${TOKEN}`);
    const calls: string[] = [];
    const app: EndpointWindow = {
      ...win,
      __TAURI_INTERNALS__: {
        invoke: (command) => {
          calls.push(command);
          return Promise.resolve({ origin: "http://127.0.0.1:4555", token: TOKEN });
        },
      },
    };
    expect(await findEndpoint(app)).toEqual({
      endpoint: { origin: "http://127.0.0.1:4555", token: TOKEN },
      source: "tauri",
    });
    expect(calls).toEqual(["host_endpoint"]);
  });

  test("uses the URL when the command fails", async () => {
    const { win } = fakeWindow(`http://x/?host=${HOST}#token=${TOKEN}`);
    const app: EndpointWindow = { ...win, __TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error("no host")) } };
    expect((await findEndpoint(app))?.source).toBe("url");
  });
});
