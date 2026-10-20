// SPDX-License-Identifier: Apache-2.0
// The contract of the bridge alone: the envelope, the typed calls, the events and the
// index reads, with the shared case table that the editor, the workbench page and the host run too.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  answerOf,
  bridgeCallTable,
  bridgeOrigin,
  callMessage,
  cloneable,
  defineBridgeCall,
  eventMessage,
  indexReadMessage,
  isBridgeAnswer,
  isBridgeCall,
  isBridgeEvent,
  isIndexReadAnswer,
  answerOutcome,
  readCall,
  readIndexRead,
  sendBridgeCall,
  serveBridgeCall,
  transferOf,
  BRIDGE_EVENT_NAMES,
} from "../src";
import { ANSWER_CASES, BASE_CALL_CASES, bodyOf, CALL_MESSAGE_CASES, EVENT_CASES, SCENE_FILE_CALL_CASES } from "./cases";

/** The error text of a promise that rejects, or null. */
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("the source of the bridge", () => {
  it("imports no Vue, no Node or Bun module and no other workspace package", () => {
    const src = join(import.meta.dir, "..", "src");
    const files = readdirSync(src).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const name of files) {
      const text = readFileSync(join(src, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["'](vue|@vue\/[^"']*|node:[^"']*|bun:[^"']*|@scenity\/[^"']*)["']/);
    }
  });
});

describe("the origin of the workbench parameter", () => {
  it("takes an origin without a path, also the origin of the Tauri page", () => {
    const origin = "http://127.0.0.1:4800";
    expect(bridgeOrigin(`?take=greet&workbench=${encodeURIComponent(origin)}`)).toBe(origin);
    expect(bridgeOrigin("?workbench=http://LOCALHOST:5000/")).toBe("http://localhost:5000");
    expect(bridgeOrigin("?workbench=tauri://localhost")).toBe("tauri://localhost");
  });

  it("refuses no value, a path, a query and a text that is not an origin", () => {
    for (const search of [
      "?take=greet",
      "?workbench=",
      "?workbench=http://127.0.0.1:4800/page",
      "?workbench=http://127.0.0.1:4800?x=1",
      "?workbench=*",
      "?workbench=http://user@evil.test",
    ]) {
      expect(bridgeOrigin(search), search).toBeNull();
    }
  });
});

describe("the envelope", () => {
  for (const item of CALL_MESSAGE_CASES) {
    it(`reads a call message: ${item.name}`, () => {
      const read = readCall(item.data);
      expect(read === null ? null : { call: read.call, args: read.args }).toEqual(item.read);
      if (read !== null) expect(isBridgeCall(read)).toBe(true);
    });
  }

  for (const item of ANSWER_CASES) {
    it(`reads an answer: ${item.name}`, () => {
      expect(isBridgeAnswer(item.data)).toBe(item.outcome !== null);
      if (item.outcome !== null && isBridgeAnswer(item.data)) expect(answerOutcome(item.data)).toEqual(item.outcome);
    });
  }

  it("makes the messages of a call and of an answer", () => {
    expect(callMessage(3, "seek", [5])).toEqual({ workbench: 1, id: 3, call: "seek", args: [5] });
    expect(answerOf(3, undefined).message).toEqual({ workbench: 1, id: 3, result: null });
  });

  it("moves the picture bytes of a result and sends other values through JSON when clone refuses them", () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    const picture = answerOf(1, { mime: "image/webp", bytes });
    expect(picture.transfer).toEqual([bytes]);
    expect((picture.message as { result: { bytes: unknown } }).result.bytes).toBe(bytes);
    expect(transferOf({ bytes: "AAAA" })).toEqual([]);
    expect(transferOf(null)).toEqual([]);
    expect(cloneable({ name: "x", run: () => 1, nested: { at: 2 } })).toEqual({ name: "x", nested: { at: 2 } });
    expect(cloneable(undefined)).toBeNull();
    const plain = { a: [1, 2] };
    expect(cloneable(plain)).toBe(plain);
  });
});

describe("the base calls and the scene file calls on both sides of one contract", () => {
  for (const item of [...BASE_CALL_CASES, ...SCENE_FILE_CALL_CASES]) {
    it(`${item.def.name}: ${item.name}`, async () => {
      const sent: { call: string; args: unknown }[] = [];
      const send = (call: string, args: readonly unknown[]) => {
        sent.push({ call, args });
        return Promise.resolve(undefined);
      };
      const caller = sendBridgeCall(item.def, send, ...item.args);
      const served: unknown[] = [];
      const frame = serveBridgeCall(item.def, (...args) => {
        served.push([...args]);
        return null;
      })(item.args);
      if (item.error !== undefined) {
        expect(await rejection(caller)).toBe(item.error);
        expect(await rejection(frame)).toBe(item.error);
        expect(sent).toEqual([]);
        expect(served).toEqual([]);
      } else {
        await Promise.allSettled([caller, frame]);
        expect(sent).toEqual([{ call: item.def.name, args: item.wire }]);
        expect(served).toEqual([item.wire]);
      }
    });
  }

  it("refuses a bad call name and two calls with one name", () => {
    expect(() => defineBridgeCall({ name: "a b" })).toThrow('The bridge call name "a b" is not valid.');
    const one = defineBridgeCall({ name: "one" });
    expect(() => bridgeCallTable([one, one])).toThrow('Two bridge calls have the name "one".');
    expect(bridgeCallTable([one]).get("one")).toBe(one);
  });
});

describe("the events", () => {
  for (const item of EVENT_CASES) {
    it(`${item.ok ? "accepts" : "refuses"} ${item.name}`, () => {
      expect(isBridgeEvent(item.message)).toBe(item.ok);
      if (item.ok) expect(eventMessage(bodyOf(item)) as unknown).toEqual(item.message);
    });
  }

  it("has a valid case for each event", () => {
    const named = new Set(EVENT_CASES.filter((item) => item.ok).map((item) => item.message.event));
    expect([...BRIDGE_EVENT_NAMES].filter((name) => !named.has(name))).toEqual([]);
  });
});

describe("the index reads", () => {
  const hash = "0123456789abcdef0123456789abcdef";
  it("reads a take read and a frame read, and refuses other messages", () => {
    const take = indexReadMessage({ id: 1, op: "take", contentHash: hash, take: "0123456789abcdef" });
    expect(readIndexRead(take)).toEqual({ id: 1, op: "take", contentHash: hash, take: "0123456789abcdef" });
    expect(readIndexRead({ workbenchIndex: 1, id: 2, op: "frame", key: hash, size: 320 })?.op).toBe("frame");
    expect(readIndexRead({ workbenchIndex: 1, id: 2, op: "frame", key: hash, size: 0 })).toBeNull();
    expect(readIndexRead({ workbench: 1, id: 1, call: "url" })).toBeNull();
    expect(isIndexReadAnswer({ workbenchIndex: 1, id: 1, result: null })).toBe(true);
    expect(isIndexReadAnswer(take)).toBe(false);
  });
});
