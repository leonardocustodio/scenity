// SPDX-License-Identifier: Apache-2.0
/**
 * The models of the scratch props in the workbench page. The relay keeps the `scratch` event of a frame in the page.
 * The page reads the record and the model of each import with the token, and gives them to the frame that asked. The
 * indexer window opens its lab frame with the scratch props of a job.
 */
import type { BridgeScratchEvent, RequestParams } from "@scenity/workbench-host/protocol";
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { describe, expect, test } from "vitest";
import { createScratchModels, scratchInfo } from "../../src/imports/scratchModels";
import { frameUrl, specOf } from "../../src/indexer/frameSpec";
import { createRelay, type FrameTarget } from "../../src/surfaces/relay";

const LAB = "http://127.0.0.1:5400";
const HOST = { origin: "http://127.0.0.1:4800", token: "ab".repeat(32) };
const A = "lx0abc-0011aabb";
const B = "lx0abd-22334455";

const RECORD = {
  name: "chair.glb",
  source: "made by me",
  licence: "CC0-1.0",
  rights: { allowed: false, entry: null, reason: 'the source "made by me" is not in the licence register' },
  error: null,
  result: { pass: true, tiers: { high: { triangles: 188, bytes: 7_168 } }, warnings: ["one"] },
};

describe("the relay and a scratch event", () => {
  test("goes to onScratch with the surface and the place of the frame, not to the host", () => {
    const reports: RequestParams<"surface.report">[] = [];
    const seen: [string, string, BridgeScratchEvent][] = [];
    const relay = createRelay({
      answer: () => undefined,
      report: (params) => reports.push(params),
      onScratch: (surface, where, event) => seen.push([surface, where, event]),
    });
    const frame: FrameTarget = { origin: LAB, window: { postMessage: () => undefined } };
    relay.attach("lab", "shadow", frame);
    const event: BridgeScratchEvent = { workbench: 1, event: "scratch", need: [A] };
    relay.receive({ source: frame.window, origin: LAB, data: event });
    expect(seen).toEqual([["lab", "shadow", event]]);
    expect(reports).toEqual([]);
  });
});

describe("createScratchModels", () => {
  test("gives each needed model with the facts of its record, and the reason of a missing one", async () => {
    const calls: [string, readonly unknown[]][] = [];
    const fetched: string[] = [];
    const handle = createScratchModels({
      endpoint: () => HOST,
      call: (call, args) => {
        calls.push([call, args]);
        return Promise.resolve(null);
      },
      fetch: ((input: string, init?: RequestInit) => {
        fetched.push(input.slice(HOST.origin.length));
        expect((init?.headers as Record<string, string>)["x-workbench-token"]).toBe(HOST.token);
        if (input.includes(B)) return Promise.resolve(Response.json({ ok: false }, { status: 404 }));
        if (input.endsWith("/record.json")) return Promise.resolve(Response.json(RECORD));
        return Promise.resolve(new Response(new Uint8Array([7, 7])));
      }) as unknown as typeof fetch,
    });
    await handle({ workbench: 1, event: "scratch", need: [A, B] });
    expect(fetched).toEqual([`/imports/${A}/record.json`, `/imports/${A}/preview.glb`, `/imports/${B}/record.json`]);
    expect(calls[0]?.[0]).toBe("scratchModel");
    expect(new Uint8Array(calls[0]?.[1][0] as ArrayBuffer)).toEqual(new Uint8Array([7, 7]));
    expect(calls[0]?.[1][1]).toEqual(scratchInfo(A, RECORD));
    expect(calls[1]?.[1]).toEqual([null, { import: B, error: `the import ${B} has no record (404)` }]);
  });

  test("reads the facts of a record for the card", () => {
    expect(scratchInfo(A, RECORD)).toEqual({
      import: A,
      name: "chair.glb",
      source: "made by me",
      licence: "CC0-1.0",
      rights: { allowed: false, reason: 'the source "made by me" is not in the licence register' },
      pass: true,
      triangles: 188,
      kb: 7,
      warnings: ["one"],
    });
    expect(scratchInfo(A, { name: "x.fbx", result: null })).toMatchObject({
      pass: null,
      source: "",
      kb: null,
      rights: null,
    });
    expect(scratchInfo(A, { ...RECORD, rights: { allowed: true, entry: "codeblue-own-work" } }).rights).toEqual({
      allowed: true,
      reason: null,
    });
  });
});

describe("the indexer frame of a job with scratch props", () => {
  test("carries the scratch URL parameter of the job", () => {
    const input: FrameKeyInput = {
      source: "take:greet",
      events: [],
      timeMs: 1000,
      view: "chest",
      tunes: {},
      renderer: { debug: [], assets: true, reduced: false, scratch: `${A}@0.5,0,1,15` },
      tier: "high",
      contentHash: "0".repeat(32),
    };
    const url = new URL(frameUrl("http://127.0.0.1:4900/?take=greet", specOf(input)));
    expect(url.searchParams.get("scratch")).toBe(`${A}@0.5,0,1,15`);
    const plain = { ...input, renderer: { debug: [], assets: true, reduced: false } };
    expect(new URL(frameUrl("http://127.0.0.1:4900/", specOf(plain))).searchParams.has("scratch")).toBe(false);
  });
});
