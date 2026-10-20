// SPDX-License-Identifier: Apache-2.0
// The page bridge of the studio: the hub sends a call to the newest window of a project and gives its answer. An error
// of the window, no window, a window that closes and a window that does not answer are errors.
import { describe, expect, test } from "bun:test";
import { BridgeHub, type BridgeSocket } from "../src/bridgeHub";

/** The error text of a promise that must fail. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the promise did not fail");
}

/** A fake window: the calls that the hub sent to it. The versions of the scene are not calls. */
function windowOf(): BridgeSocket & { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    send: (text) => {
      const message = JSON.parse(text) as Record<string, unknown>;
      if (message.type !== "doc.version") sent.push(message);
    },
  };
}

describe("the page bridge of the studio", () => {
  test("sends a call to the newest window of the project and gives its answer", async () => {
    const hub = new BridgeHub();
    const [showroom, spin] = [windowOf(), windowOf()];
    hub.attach(showroom);
    hub.attach(spin);
    hub.message(showroom, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
    hub.message(spin, JSON.stringify({ type: "hello", project: "spin", scene: "scenes/main.scene.json" }));
    const answer = hub.call("studio.state", [], { project: "showroom" });
    const [request] = showroom.sent;
    expect(request).toMatchObject({ workbench: 1, call: "studio.state", args: [] });
    expect(spin.sent).toEqual([]);
    hub.message(showroom, JSON.stringify({ workbench: 1, id: request?.id, result: { project: "showroom" } }));
    expect(await answer).toEqual({ project: "showroom" });
    expect(
      hub
        .pages()
        .map((page) => page.project)
        .sort(),
    ).toEqual(["showroom", "spin"]);
  });

  test("a call waits for a window that reloads", async () => {
    const hub = new BridgeHub();
    const old = windowOf();
    hub.attach(old);
    hub.message(old, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
    hub.detach(old);
    // The window closed a moment ago: the call waits for the window that opens again.
    const answer = hub.call("studio.state", [], { project: "showroom" });
    const again = windowOf();
    hub.attach(again);
    hub.message(again, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
    await Promise.resolve();
    const [request] = again.sent;
    expect(request).toMatchObject({ call: "studio.state" });
    hub.message(again, JSON.stringify({ workbench: 1, id: request?.id, result: { ok: true } }));
    expect(await answer).toEqual({ ok: true });
    // A project that never had a window fails at once.
    expect(await failure(hub.call("url", [], { project: "spin" }))).toContain("no editor window of the project spin");
  });

  test("gives the error of a window, and fails with no window, a closed window or no answer in time", async () => {
    const hub = new BridgeHub();
    expect(await failure(hub.call("url", []))).toContain("no editor window is open in the studio");
    const page = windowOf();
    hub.attach(page);
    const failed = hub.call("command", ["entity.fly"]);
    hub.message(page, JSON.stringify({ workbench: 1, id: page.sent[0]?.id, error: 'No command "entity.fly".' }));
    expect(await failure(failed)).toContain('No command "entity.fly".');
    const closed = hub.call("url", []);
    hub.detach(page);
    expect(await failure(closed)).toContain("the editor window closed");
    const late = windowOf();
    hub.attach(late);
    expect(await failure(hub.call("url", [], { timeoutMs: 20 }))).toContain("did not answer url in time");
  });
});
