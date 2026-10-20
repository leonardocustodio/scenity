// SPDX-License-Identifier: Apache-2.0
/**
 * `labs clip --format mp4` in the labs app. With the host of the app in the environment, the tool asks
 * `POST /clips/mp4` and reads the MP4 by its ID. Without the host, or with a browser page (501), the tool keeps its own
 * page (MediaRecorder).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { clipWidth, desktopMp4 } from "../../scripts/lab/desktopClip";

const ENV = { SCENITY_WORKBENCH_ORIGIN: "http://127.0.0.1:4100", SCENITY_WORKBENCH_TOKEN: "t".repeat(64) };
const REQUEST = { take: "walk", from: 4000, to: 7950, fps: 15, camera: "chest", width: 640 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the MP4 of the labs app", () => {
  test("asks the host for the clip and reads the file by its ID", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.endsWith("/clips/mp4")) return Promise.resolve(Response.json({ id: "a".repeat(32), frames: 60 }));
      return Promise.resolve(new Response(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])));
    });
    const made = await desktopMp4(REQUEST, ENV);
    expect(made?.bytes.length).toBe(8);
    expect(made?.answer.frames).toBe(60);
    expect(calls[0]?.url).toBe("http://127.0.0.1:4100/clips/mp4");
    expect(JSON.parse(calls[0]?.init?.body as string)).toMatchObject({ width: 640, height: 400, take: "walk" });
    expect(calls[1]?.url).toBe(`http://127.0.0.1:4100/pictures/${"a".repeat(32)}`);
  });

  test("no host, a browser page (501) or a host that does not answer: null (the page of the tool)", async () => {
    expect(await desktopMp4(REQUEST, {})).toBeNull();
    expect(await desktopMp4(REQUEST, { ...ENV, SCENITY_WORKBENCH_ORIGIN: "http://example.org" })).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("NO_NATIVE_MP4", { status: 501 })));
    expect(await desktopMp4(REQUEST, ENV)).toBeNull();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("refused")));
    expect(await desktopMp4(REQUEST, ENV)).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("boom", { status: 502 })));
    await expect(desktopMp4(REQUEST, ENV)).rejects.toThrow("boom");
  });

  test("the width is a multiple of 16, so the 16:10 height is even (H.264)", () => {
    expect(clipWidth(640)).toBe(640);
    expect(clipWidth(650)).toBe(656);
    expect(clipWidth(5)).toBe(16);
    expect(clipWidth(9999)).toBe(4096);
  });
});
