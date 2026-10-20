// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the binary picture path:
 * - the picture frame of the page (the header with the request and the MIME type, then the bytes);
 * - the join of the frame with the JSON answer of its request;
 * - the picture store and its route `GET /pictures/<id>` behind the token and the sign-in.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { trimMessage } from "../src/agent/messages";
import { pictureId, PictureStore } from "../src/pictures";
import {
  encodePictureFrame,
  encodePictureHeader,
  isBytesMarker,
  isPictureRef,
  readPictureFrame,
  TOKEN_HEADER,
} from "../src/protocol";
import { tokenProvider } from "../src/authProvider";
import { startServer, type PageClient } from "../src/server";
import { SurfaceCalls } from "../src/surfaceCalls";
import { cleanup, rejectsWith, tempDir } from "./helpers";

const made: string[] = [];
afterAll(() => cleanup(...made));

function folder(): string {
  const dir = tempDir("pictures");
  made.push(dir);
  return dir;
}

describe("the picture frame", () => {
  test("a frame gives back its request, its MIME type and its bytes without a copy", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const frame = encodePictureFrame(4_000_000_000, "image/jpeg", bytes);
    expect(frame.length).toBe(4 + 4 + 1 + "image/jpeg".length + 4);
    const read = readPictureFrame(frame);
    expect(read?.request).toBe(4_000_000_000);
    expect(read?.mime).toBe("image/jpeg");
    expect([...(read?.bytes ?? [])]).toEqual([1, 2, 3, 250]);
    // A view into the frame, not a copy.
    expect(read?.bytes.buffer).toBe(frame.buffer);
  });

  test("other bytes are not a frame; a bad request or MIME type cannot make one", () => {
    expect(readPictureFrame(new Uint8Array([0x57, 0x42, 0x50, 0x02, 0, 0, 0, 0, 1, 65]))).toBeNull();
    expect(readPictureFrame(new Uint8Array([0x57, 0x42, 0x50]))).toBeNull();
    const header = encodePictureHeader(7, "image/webp");
    expect(readPictureFrame(header.subarray(0, header.length - 2))).toBeNull();
    const zero = Uint8Array.from(header);
    zero[8] = 0;
    expect(readPictureFrame(zero)).toBeNull();
    expect(() => encodePictureHeader(-1, "image/webp")).toThrow("request");
    expect(() => encodePictureHeader(1, "image/web p")).toThrow("MIME");
    expect(() => encodePictureHeader(1, "")).toThrow("MIME");
  });

  test("the JSON answer names the byte count; a reference names the ID", () => {
    expect(isBytesMarker({ width: 1, bytes: 12 })).toBe(true);
    expect(isBytesMarker({ width: 1, bytes: "12" })).toBe(false);
    expect(isBytesMarker({ width: 1, data: "AAAA" })).toBe(false);
    const ref = { id: "0".repeat(32), simMs: null, width: 2, height: 1, mime: "image/webp" };
    expect(isPictureRef(ref)).toBe(true);
    expect(isPictureRef({ ...ref, id: "../x" })).toBe(false);
    expect(isPictureRef({ ...ref, data: "AAAA", id: undefined })).toBe(false);
  });
});

describe("the join of a frame with its answer", () => {
  const page = (id: number): PageClient => ({ id, origin: null, role: "admin", send: () => undefined });

  function calls(): SurfaceCalls {
    const client = page(1);
    return new SurfaceCalls({ shown: () => client, timeoutText: () => "late" });
  }

  test("the bytes of the frame go into the result of the request", async () => {
    const surface = calls();
    const result = surface.call("lab", "visible", "capture", [640], 1000);
    const bytes = new Uint8Array([9, 8, 7]);
    surface.bytes(page(1), { request: 1, mime: "image/webp", bytes });
    surface.answer(page(1), {
      request: 1,
      result: { simMs: 5, width: 640, height: 400, mime: "image/webp", bytes: 3 },
    });
    expect(await result).toEqual({ simMs: 5, width: 640, height: 400, mime: "image/webp", bytes });
  });

  test("an answer without its bytes fails; bytes of another page or request are refused", async () => {
    const surface = calls();
    const result = surface.call("lab", "visible", "capture", [640], 1000);
    expect(() => surface.bytes(page(2), { request: 1, mime: "image/webp", bytes: new Uint8Array(1) })).toThrow(
      "another page",
    );
    expect(() => surface.bytes(page(1), { request: 9, mime: "image/webp", bytes: new Uint8Array(1) })).toThrow(
      "No open surface request 9",
    );
    surface.answer(page(1), { request: 1, result: { mime: "image/webp", bytes: 3 } });
    await rejectsWith(result, "did not come");
  });
});

describe("the picture store", () => {
  test("one file per content; the ID is the start of the SHA-256; a read gives the bytes and the type", () => {
    const store = new PictureStore(folder());
    const bytes = new TextEncoder().encode("a picture");
    const id = store.put(bytes, "image/jpeg");
    expect(id).toBe(pictureId(bytes));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.put(bytes, "image/jpeg")).toBe(id);
    expect(readdirSync(store.dir)).toEqual([`${id}.jpg`]);
    expect(store.read(id)?.mime).toBe("image/jpeg");
    expect(new TextDecoder().decode(store.read(id)?.bytes)).toBe("a picture");
    expect(store.read("../../etc/passwd")).toBeNull();
    const ref = store.ref({ simMs: 3, width: 4, height: 2, mime: "image/webp", bytes: new Uint8Array([1]) });
    expect(ref).toEqual({ id: pictureId(new Uint8Array([1])), simMs: 3, width: 4, height: 2, mime: "image/webp" });
  });

  test("the store keeps the newest pictures above its limit", () => {
    const store = new PictureStore(folder(), { maxFiles: 2 });
    const ids = ["one", "two", "three"].map((text) => store.put(new TextEncoder().encode(text), "image/webp"));
    ids.forEach((id, index) => {
      const at = new Date(Date.UTC(2026, 9, 13, 10, index));
      utimesSync(join(store.dir, `${id}.webp`), at, at);
    });
    store.prune();
    expect(existsSync(join(store.dir, `${ids[0] ?? ""}.webp`))).toBe(false);
    expect(store.has(ids[1] ?? "")).toBe(true);
    expect(store.has(ids[2] ?? "")).toBe(true);
  });

  test("GET /pictures/<id> gives the bytes with a token, 401 without one; a viewer reads but cannot post", async () => {
    const store = new PictureStore(folder());
    const id = store.put(new TextEncoder().encode("webp bytes"), "image/webp");
    const token = "ab".repeat(32);
    const viewer = "cd".repeat(32);
    const server = startServer({
      port: 0,
      token,
      // A role token of the viewer.
      provider: tokenProvider(token, [{ role: "viewer", token: viewer }]),
      onMessage: () => Promise.resolve(null),
      http: (request, url) => store.http(request, url),
    });
    try {
      const get = (path: string, headers: Record<string, string> = { [TOKEN_HEADER]: token }) =>
        fetch(`${server.origin}${path}`, { headers });
      expect((await get(`/pictures/${id}`, {})).status).toBe(401);
      expect((await get(`/pictures/${id}`, { [TOKEN_HEADER]: "ef".repeat(32) })).status).toBe(401);
      expect((await get(`/pictures/${id}`, { [TOKEN_HEADER]: viewer })).status).toBe(200);
      const post = await fetch(`${server.origin}/imports`, { method: "POST", headers: { [TOKEN_HEADER]: viewer } });
      expect(post.status).toBe(403);
      // The paths of the host processes need the launch token.
      expect((await get("/context", { [TOKEN_HEADER]: viewer })).status).toBe(403);
      const ok = await get(`/pictures/${id}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/webp");
      expect(ok.headers.get("cache-control")).toContain("immutable");
      expect(await ok.text()).toBe("webp bytes");
      expect((await get(`/pictures/${"0".repeat(32)}`)).status).toBe(404);
      expect((await get("/pictures/..%2F..%2Fstate.json")).status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});

describe("the pictures of the chat", () => {
  test("an image of a tool result goes to the store; the page gets its ID, not base64", () => {
    const store = new PictureStore(folder());
    const data = Buffer.from("a chat picture").toString("base64");
    const message = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }],
          },
        ],
      },
    };
    const trimmed = trimMessage(message, store);
    const id = pictureId(new TextEncoder().encode("a chat picture"));
    expect(JSON.stringify(trimmed)).not.toContain(data);
    expect(JSON.stringify(trimmed)).toContain(`"picture":{"id":"${id}","mime":"image/jpeg"}`);
    expect(new TextDecoder().decode(store.read(id)?.bytes)).toBe("a chat picture");
    // Without a store the page gets a note, never the data.
    expect(JSON.stringify(trimMessage(message))).toContain("not stored");
  });
});
