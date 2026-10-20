// SPDX-License-Identifier: Apache-2.0
/**
 * The page half of the import by drop (the browser path). The relay keeps the `import` event of a frame in the page,
 * so the host never gets the file as a report. The page uploads the dropped file with its drop point to
 * `POST /imports`, waits for the run, and gives the optimized model to the frame.
 */
import type { BridgeImportEvent, EventPayload, RequestParams } from "@scenity/workbench-host/protocol";
import { describe, expect, test } from "vitest";
import { createImportDrop, doneText } from "../../src/imports/importDrop";
import { createRelay, type FrameTarget } from "../../src/surfaces/relay";

const LAB = "http://127.0.0.1:5400";
const HOST = { origin: "http://127.0.0.1:4800", token: "ab".repeat(32) };

function drop(file = new Blob([new Uint8Array([1, 2, 3])])): BridgeImportEvent {
  return {
    workbench: 1,
    event: "import",
    drop: "drop-1",
    file,
    name: "chair.glb",
    point: [0.5, 0, 1.25],
    source: "made by me",
    licence: "CC0-1.0",
  };
}

describe("the relay and an import event", () => {
  test("goes to onImport with the surface, not to the host", () => {
    const reports: RequestParams<"surface.report">[] = [];
    const imports: [string, BridgeImportEvent][] = [];
    const relay = createRelay({
      answer: () => undefined,
      report: (params) => reports.push(params),
      onImport: (surface, event) => imports.push([surface, event]),
    });
    const frame: FrameTarget = { origin: LAB, window: { postMessage: () => undefined } };
    relay.attach("lab", "visible", frame);
    const event = drop();
    relay.receive({ source: frame.window, origin: LAB, data: event });
    expect(imports).toEqual([["lab", event]]);
    expect(reports).toEqual([]);
  });
});

interface Fetched {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeHost(record: unknown) {
  const fetched: Fetched[] = [];
  const calls: [string, readonly unknown[]][] = [];
  let listener: ((payload: EventPayload<"runs.done">) => void) | null = null;
  const fetchHost = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    fetched.push({ url, init });
    if (url.includes("/imports?")) {
      // The run ends after the answer of the start.
      setTimeout(() => listener?.({ run: "r1", code: 0, summary: "", outDir: null, images: [] }), 5);
      return Promise.resolve(
        Response.json({ id: "abc-0011aabb", run: "r1", name: "chair.glb", point: [0.5, 0, 1.25], drop: "drop-1" }),
      );
    }
    if (url.endsWith("/record.json")) {
      return Promise.resolve(record === null ? Response.json({ ok: false }, { status: 404 }) : Response.json(record));
    }
    return Promise.resolve(new Response(new Uint8Array([9, 9])));
  };
  const handle = createImportDrop({
    endpoint: () => HOST,
    onRunDone: (next) => {
      listener = next;
      return () => (listener = null);
    },
    call: (call, args) => {
      calls.push([call, args]);
      return Promise.resolve(null);
    },
    fetch: fetchHost as typeof fetch,
  });
  return { fetched, calls, handle };
}

const RECORD = {
  name: "chair.glb",
  source: "made by me",
  licence: "CC0-1.0",
  // The answer of the licence register that the import job writes.
  rights: { allowed: false, entry: null, reason: 'the source "made by me" is not in the licence register' },
  error: null,
  result: {
    pass: true,
    tiers: { high: { triangles: 188, bytes: 20_480 }, low: { triangles: 94, bytes: 10_240 } },
    warnings: [],
  },
};

describe("createImportDrop", () => {
  test("uploads the bytes with the token, the drop point and the answers, then gives the model to the frame", async () => {
    const { fetched, calls, handle } = fakeHost(RECORD);
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    await handle(drop(file));
    const upload = fetched[0];
    const url = new URL(upload?.url ?? "");
    expect(url.origin + url.pathname).toBe(`${HOST.origin}/imports`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: "chair.glb",
      point: "0.5,0,1.25",
      source: "made by me",
      licence: "CC0-1.0",
      drop: "drop-1",
    });
    expect(upload?.init?.method).toBe("POST");
    expect(upload?.init?.body).toBe(file);
    expect((upload?.init?.headers as Record<string, string>)["x-workbench-token"]).toBe(HOST.token);
    expect(fetched.map((item) => item.url.slice(HOST.origin.length))).toEqual([
      expect.stringMatching(/^\/imports\?/),
      "/imports/abc-0011aabb/record.json",
      "/imports/abc-0011aabb/preview.glb",
    ]);
    // The model becomes a scratch prop of the drop, with the facts of the record for its card.
    const added = calls.find(([call]) => call === "scratchAdd");
    expect(added?.[1][1]).toEqual({
      import: "abc-0011aabb",
      name: "chair.glb",
      source: "made by me",
      licence: "CC0-1.0",
      rights: { allowed: false, reason: 'the source "made by me" is not in the licence register' },
      pass: true,
      triangles: 188,
      kb: 20,
      warnings: [],
      point: [0.5, 0, 1.25],
      drop: "drop-1",
    });
    expect(new Uint8Array(added?.[1][0] as ArrayBuffer)).toEqual(new Uint8Array([9, 9]));
    const last = calls.at(-1)?.[1][0] as { state: string; text: string };
    expect(last.state).toBe("done");
    expect(last.text).toContain("188 triangles");
  });

  test("tells the frame the reason of a refusal", async () => {
    const calls: [string, readonly unknown[]][] = [];
    const handle = createImportDrop({
      endpoint: () => HOST,
      onRunDone: () => () => undefined,
      call: (call, args) => {
        calls.push([call, args]);
        return Promise.resolve(null);
      },
      fetch: (() =>
        Promise.resolve(
          Response.json({ ok: false, error: "The file is larger than 200 MB." }, { status: 413 }),
        )) as unknown as typeof fetch,
    });
    await handle(drop());
    const last = calls.at(-1)?.[1][0] as { state: string; text: string };
    expect(last).toMatchObject({ state: "failed" });
    expect(last.text).toContain("larger than 200 MB");
  });

  test("a job that ends without a record (cancelled) fails without a preview", async () => {
    const { fetched, calls, handle } = fakeHost(null);
    await handle(drop());
    expect(fetched.some((item) => item.url.endsWith("/preview.glb"))).toBe(false);
    expect(calls.some(([call]) => call === "scratchAdd")).toBe(false);
    const last = calls.at(-1)?.[1][0] as { state: string; text: string };
    expect(last).toMatchObject({ state: "failed" });
    expect(last.text).toContain("ended with code 0 and no record");
  });

  test("a failed job has a line without a preview", () => {
    expect(doneText("x.fbx", { error: "Blender failed", result: null })).toBe("Import of x.fbx failed: Blender failed");
  });
});
