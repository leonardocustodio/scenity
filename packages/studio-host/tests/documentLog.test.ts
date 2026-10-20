// SPDX-License-Identifier: Apache-2.0
// The order of the changes of the open documents (src/documentLog.ts, src/bridgeHub.ts): two windows of a scene change
// the same value at once. The host gives the changes one order, answers each window with the version of its change
// (`ack`), and gives the change to the other windows in that order.
import { describe, expect, test } from "bun:test";
import { BridgeHub } from "../src/bridgeHub";
import { DOCUMENT_STEPS, DocumentLog } from "../src/documentLog";

/** A fake window socket: it keeps the messages that it gets. */
function socket() {
  const got: Record<string, unknown>[] = [];
  return { got, send: (text: string) => got.push(JSON.parse(text) as Record<string, unknown>) };
}

const hello = JSON.stringify({ type: "hello", project: "room", scene: "scenes/main.scene.json" });
const change = (value: number) =>
  JSON.stringify({
    type: "doc.ops",
    project: "room",
    path: "scenes/main.scene.json",
    ops: [{ op: "set", path: "/entities/lamp/components/light/intensity", value }],
  });

describe("the order of the changes of a scene", () => {
  test("each change gets the next version; the window that made it gets the version, the other windows the change", () => {
    const hub = new BridgeHub();
    const a = socket();
    const b = socket();
    hub.attach(a);
    hub.attach(b);
    hub.message(a, hello);
    hub.message(b, hello);
    // Both windows change the intensity before they hear of the other change: the host takes A first.
    hub.message(a, change(2));
    hub.message(b, change(5));
    const types = (got: Record<string, unknown>[]) =>
      got.map((message) => [message.type, message.version, message.ack ?? false]);
    expect(types(a.got)).toEqual([
      ["doc.version", 0, false],
      ["doc.version", 1, true],
      ["doc.ops", 2, false],
    ]);
    // B gets the change of A before the answer to its own change: B puts its change again after it (documentSync.ts).
    expect(types(b.got)).toEqual([
      ["doc.version", 0, false],
      ["doc.ops", 1, false],
      ["doc.version", 2, true],
    ]);
    const steps = hub.log.steps("room", "scenes/main.scene.json");
    expect(steps.map((step) => [step.version, step.actor])).toEqual([
      [1, "window"],
      [2, "window"],
    ]);
    expect(hub.log.steps("room", "scenes/main.scene.json", 1).map((step) => step.version)).toEqual([2]);
  });

  test("a change of the host (an agent with no window) gets a version and goes to the windows", () => {
    const hub = new BridgeHub();
    const a = socket();
    hub.attach(a);
    hub.message(a, hello);
    hub.relay(null, { type: "doc.ops", project: "room", path: "scenes/main.scene.json", ops: [], actor: "agent-1" });
    hub.message(a, change(3));
    expect(a.got.map((message) => [message.type, message.version, message.ack ?? false])).toEqual([
      ["doc.version", 0, false],
      ["doc.ops", 1, false],
      ["doc.version", 2, true],
    ]);
    expect(hub.log.steps("room", "scenes/main.scene.json").map((step) => step.actor)).toEqual(["agent-1", "window"]);
  });

  test("keeps the last steps only", () => {
    const log = new DocumentLog(() => 0);
    for (let index = 0; index < DOCUMENT_STEPS + 5; index += 1)
      log.record("room", "a.scene.json", { title: null, actor: "window", ops: [] });
    expect(log.version("room", "a.scene.json")).toBe(DOCUMENT_STEPS + 5);
    expect(log.steps("room", "a.scene.json")).toHaveLength(DOCUMENT_STEPS);
    expect(log.steps("room", "b.scene.json")).toEqual([]);
  });
});
