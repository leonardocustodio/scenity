// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the calls that occur during a page reload. Without this handling, the check and the inspect tools of the
 * plugin fail while the lab frame loads again after an edit. A call that the old page got goes to the new page after
 * its `ready`. A call that comes during the reload waits for the `ready` (at most 20 s). The first answer wins. The
 * page is a fake client that records the requests.
 */
import { describe, expect, test } from "bun:test";
import type { HostMessage } from "../src/protocol";
import type { PageClient } from "../src/server";
import { SurfaceCalls } from "../src/surfaceCalls";
import { rejectsWith } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

interface Sent {
  readonly request: number;
  readonly call: string;
}

function setup(reloadWaitMs = 1_000): { calls: SurfaceCalls; client: PageClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client: PageClient = {
    id: 7,
    origin: "http://127.0.0.1:5300",
    role: "admin",
    send: (message: HostMessage) => {
      if ("type" in message && message.type === "surface.request") sent.push(message);
    },
  };
  const calls = new SurfaceCalls({
    shown: (id) => (id === "lab" ? client : undefined),
    timeoutText: (id, call, ms) => `The surface ${id} did not answer "${call}" in ${String(ms)} ms.`,
    reloadWaitMs,
  });
  return { calls, client, sent };
}

describe("a call and a page reload", () => {
  test("a plain call gets its answer; an error answer fails it", async () => {
    const { calls, client, sent } = setup();
    const ok = calls.call("lab", "visible", "seek", [100], 1_000);
    await Bun.sleep(0);
    calls.answer(client, { request: sent[0]?.request ?? 0, result: 100 });
    expect(await ok).toBe(100);
    const bad = calls.call("lab", "visible", "camera", ["nope"], 1_000);
    await Bun.sleep(0);
    calls.answer(client, { request: sent[1]?.request ?? 0, error: "Unknown camera: nope" });
    await rejectsWith(bad, "Unknown camera");
    await rejectsWith(calls.call("other", "visible", "seek", [], 1_000), "No workbench page shows the surface other");
  });

  test("the reload event: the call goes to the new page after its ready, and gets that answer", async () => {
    const { calls, client, sent } = setup();
    const check = calls.call("lab", "visible", "check", [[9000]], 5_000);
    await Bun.sleep(0);
    expect(sent.map((item) => item.call)).toEqual(["check"]);
    calls.reloading("lab", "visible");
    // A call during the reload waits for the new page.
    const inspect = calls.call("lab", "visible", "inspect", [], 5_000);
    await Bun.sleep(20);
    expect(sent).toHaveLength(1);
    calls.ready("lab", "visible");
    await Bun.sleep(0);
    expect(sent.map((item) => item.call)).toEqual(["check", "check", "inspect"]);
    calls.answer(client, { request: sent[1]?.request ?? 0, result: { failures: [] } });
    calls.answer(client, { request: sent[2]?.request ?? 0, result: { members: [] } });
    expect(await check).toEqual({ failures: [] });
    expect(await inspect).toEqual({ members: [] });
    // The late error of the old page (the relay timeout) finds no open request.
    expect(() => calls.answer(client, { request: sent[0]?.request ?? 0, error: "late" })).toThrow("No open surface");
  });

  test("a ready without a reload event: a call that the old page got goes again once; the first answer wins", async () => {
    const { calls, client, sent } = setup();
    const frame = calls.call("lab", "visible", "frame", [], 5_000);
    await Bun.sleep(5);
    calls.ready("lab", "visible");
    calls.ready("lab", "visible");
    await Bun.sleep(0);
    expect(sent.map((item) => item.call)).toEqual(["frame", "frame"]);
    // The old page answered after all: its answer wins, and the host cancels the second try.
    calls.answer(client, { request: sent[0]?.request ?? 0, result: { simMs: 6350 } });
    expect(await frame).toEqual({ simMs: 6350 });
    expect(() => calls.answer(client, { request: sent[1]?.request ?? 0, result: {} })).toThrow("No open surface");
  });

  test("a frame that does not come back fails the call with the reload words", async () => {
    const { calls } = setup(50);
    calls.reloading("lab", "shadow");
    await rejectsWith(calls.call("lab", "shadow", "sheet", [], 5_000), "reloaded and was not ready in 50 ms");
  });

  test("a timeout and a closed page", async () => {
    const { calls, client } = setup();
    await rejectsWith(calls.call("lab", "visible", "slow", [], 30), 'did not answer "slow" in 30 ms');
    const open = calls.call("lab", "visible", "seek", [1], 5_000);
    await Bun.sleep(0);
    calls.dropClient(client, "The workbench page closed.");
    await rejectsWith(open, "The workbench page closed.");
  });
});
