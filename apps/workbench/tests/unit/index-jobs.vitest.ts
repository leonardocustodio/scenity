// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index in the workbench page. One job of the host queue runs in a lab frame: the binary index frame comes
 * before `index.done`, and a refused job gives `index.fail`. The index reads of a lab frame go through the page. Only a
 * known lab frame gets an answer, and the bytes move.
 */
import { describe, expect, it } from "vitest";
import type { IndexJobWire } from "@scenity/workbench-host/protocol";
import { runJob, takeJob, type JobDeps } from "../../src/index/indexJobs";
import { answerRead, readOf, readUrl, startIndexReads } from "../../src/index/indexReads";
import { createRelay } from "../../src/surfaces/relay";

const JOB: IndexJobWire = {
  job: 7,
  key: "a".repeat(32),
  size: 160,
  input: {
    source: "take:greet",
    events: [],
    timeMs: 900,
    view: "chest",
    tunes: {},
    renderer: {},
    tier: "high",
    contentHash: "b".repeat(32),
  },
};

function deps(frame: (call: string, args: readonly unknown[]) => Promise<unknown>, jobs: IndexJobWire[] = [JOB]) {
  const log: string[] = [];
  const value: JobDeps = {
    renderer: "shadow",
    request: (type: string, params: Record<string, unknown>) => {
      log.push(`${type} ${JSON.stringify(params)}`);
      if (type === "index.next") return Promise.resolve({ jobs: jobs.splice(0, 1) });
      return Promise.resolve(type === "index.done" ? { stored: true } : null);
    },
    sendIndexFrame: (job, mime, bytes) => log.push(`frame ${String(job)} ${mime} ${String(bytes.byteLength)}`),
    callFrame: frame,
  };
  return { value, log };
}

describe("one index job in a lab frame", () => {
  it("sends the binary frame, then index.done with the byte count and the metrics", async () => {
    const calls: unknown[] = [];
    const { value, log } = deps((call, args) => {
      calls.push([call, ...args]);
      return Promise.resolve({ mime: "image/webp", bytes: new ArrayBuffer(12), metrics: { "a|b|m": 1 } });
    });
    expect(await takeJob(value)).toBe("done");
    expect(calls).toEqual([["indexJob", JOB.input, 160]]);
    expect(log).toEqual([
      'index.next {"renderer":"shadow","max":1}',
      "frame 7 image/webp 12",
      'index.done {"job":7,"bytes":12,"mime":"image/webp","metrics":{"a|b|m":1}}',
    ]);
    expect(await takeJob(value)).toBe("none");
  });

  it("sends the reads of the frame with index.done; a list that is not of strings is unknown", async () => {
    const answer = (reads: unknown) =>
      deps(() => Promise.resolve({ mime: "image/webp", bytes: new ArrayBuffer(2), metrics: null, reads }));
    const known = answer(["wave", "idle"]);
    expect(await runJob(known.value, JOB)).toBe("done");
    expect(known.log[1]).toBe(
      'index.done {"job":7,"bytes":2,"mime":"image/webp","metrics":null,"reads":["wave","idle"]}',
    );
    const odd = answer(["wave", 3]);
    expect(await runJob(odd.value, JOB)).toBe("done");
    expect(odd.log[1]).toBe('index.done {"job":7,"bytes":2,"mime":"image/webp","metrics":null}');
  });

  it("gives a job back when the frame refuses it or gives no picture", async () => {
    const refused = deps(() => Promise.reject(new Error("The job has other scene options than the page.")));
    expect(await runJob(refused.value, JOB)).toBe("failed");
    expect(refused.log).toEqual(['index.fail {"job":7,"error":"The job has other scene options than the page."}']);
    const empty = deps(() => Promise.resolve({ mime: "image/webp" }));
    expect(await runJob(empty.value, JOB)).toBe("failed");
    expect(empty.log[0]).toContain("indexJob gave no picture");
  });
});

describe("the index reads of a lab frame", () => {
  it("reads only valid reads", () => {
    expect(
      readOf({ workbenchIndex: 1, id: 1, op: "take", contentHash: "a".repeat(32), take: "b".repeat(16) }),
    ).not.toBeNull();
    expect(readOf({ workbenchIndex: 1, id: 1, op: "take", contentHash: "../x", take: "b".repeat(16) })).toBeNull();
    expect(readOf({ workbenchIndex: 1, id: 1, op: "frame", key: "a".repeat(32), size: -1 })).toBeNull();
    expect(readOf({ workbench: 1, id: 1, call: "url" })).toBeNull();
    expect(readUrl("http://host", { id: 1, op: "frame", key: "a".repeat(32), size: 160 })).toBe(
      `http://host/index/${"a".repeat(32)}?size=160`,
    );
  });

  it("answers a known lab frame with the bytes of the host and moves them", async () => {
    const seen: string[] = [];
    const get = ((url: string, init: RequestInit) => {
      seen.push(`${url} ${String((init.headers as Record<string, string>)["x-workbench-token"])}`);
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }));
    }) as unknown as typeof fetch;
    const answer = await answerRead(
      { origin: "http://host", token: "t" },
      { id: 4, op: "frame", key: "a".repeat(32), size: 160 },
      get,
    );
    expect(seen).toEqual([`http://host/index/${"a".repeat(32)}?size=160 t`]);
    expect(answer.transfer).toHaveLength(1);

    const surfaces = [{ id: "lab", capabilities: ["scene", "index"] }];
    const relay = createRelay({ answer: () => undefined, report: () => undefined, surfaces: () => surfaces });
    const posted: unknown[][] = [];
    const frameWindow = { postMessage: (...args: unknown[]) => posted.push(args) };
    relay.attach("lab", "visible", { window: frameWindow, origin: "http://lab" });
    let listener: ((event: MessageEvent) => void) | null = null;
    const stop = startIndexReads(
      relay,
      () => ({ origin: "http://host", token: "t" }),
      {
        addEventListener: (_type, given) => (listener = given),
        removeEventListener: () => (listener = null),
      },
      get,
    );
    const read = { workbenchIndex: 1, id: 9, op: "frame", key: "a".repeat(32), size: 160 };
    listener!({ data: read, origin: "http://evil", source: frameWindow } as unknown as MessageEvent);
    listener!({ data: read, origin: "http://lab", source: frameWindow } as unknown as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.[0]).toMatchObject({ workbenchIndex: 1, id: 9, result: { mime: "image/webp" } });
    expect(posted[0]?.[1]).toBe("http://lab");
    stop();
    expect(listener).toBeNull();
  });
});
