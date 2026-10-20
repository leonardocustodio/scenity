// SPDX-License-Identifier: Apache-2.0
// The remote mode of the host behind the Scenity gateway (src/remote.ts): the settings from the environment, and the
// frame URLs on the public origin with the base path of the lab server.
import { describe, expect, test } from "bun:test";
import { remoteSetup } from "../src/remote";
import { surfaceUrl } from "../src/surfaces";

const ENV = {
  SCENITY_WORKBENCH_PUBLIC_ORIGIN: "https://scenity.example.org/",
  SCENITY_WORKBENCH_LAB_PORT: "4310",
  SCENITY_WORKBENCH_LAB_BASE: "/s/abc123/",
};

describe("remoteSetup", () => {
  test("is null without a public origin", () => {
    expect(remoteSetup({})).toBeNull();
    expect(remoteSetup({ SCENITY_WORKBENCH_PUBLIC_ORIGIN: " " })).toBeNull();
  });

  test("reads the origin without its last slash, the port and the base path", () => {
    expect(remoteSetup(ENV)).toEqual({
      publicOrigin: "https://scenity.example.org",
      labPort: 4310,
      labBase: "/s/abc123/",
      pageOrigin: null,
    });
  });

  test("refuses a bad origin, port or base path", () => {
    expect(() => remoteSetup({ ...ENV, SCENITY_WORKBENCH_PUBLIC_ORIGIN: "https://x.org/path" })).toThrow();
    expect(() => remoteSetup({ ...ENV, SCENITY_WORKBENCH_LAB_PORT: "0" })).toThrow();
    expect(() => remoteSetup({ ...ENV, SCENITY_WORKBENCH_LAB_PORT: "x" })).toThrow();
    expect(() => remoteSetup({ ...ENV, SCENITY_WORKBENCH_LAB_BASE: "/s/abc" })).toThrow();
    expect(() => remoteSetup({ ...ENV, SCENITY_WORKBENCH_LAB_BASE: "/s/../x/" })).toThrow();
  });
});

describe("surfaceUrl with a base path", () => {
  const origin = "https://scenity.example.org/s/new/";
  const page = "https://workbench.example.org";

  test("a first frame opens at the base path", () => {
    expect(surfaceUrl(origin, null, page)).toBe(
      `https://scenity.example.org/s/new/?workbench=${encodeURIComponent(page)}`,
    );
  });

  test("a saved URL keeps its query and gets the new base path and origin", () => {
    const saved = "http://127.0.0.1:4310/s/old/?take=greet&t=6350";
    const url = new URL(surfaceUrl(origin, saved, page) ?? "");
    expect(url.origin).toBe("https://scenity.example.org");
    expect(url.pathname).toBe("/s/new/");
    expect(url.searchParams.get("take")).toBe("greet");
    expect(url.searchParams.get("t")).toBe("6350");
  });

  test("an origin without a path keeps the saved path", () => {
    expect(surfaceUrl("http://127.0.0.1:1", "http://127.0.0.1:9/dev/gallery?x=1", null)).toBe(
      "http://127.0.0.1:1/dev/gallery?x=1",
    );
  });
});
