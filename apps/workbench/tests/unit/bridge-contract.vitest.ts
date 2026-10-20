// SPDX-License-Identifier: Apache-2.0
/**
 * The bridge contract on the caller side: the shared case table of @scenity/bridge runs against the relay of the
 * workbench page. The lab page runs the same cases on the frame side (apps/editor bridge-contract.vitest.ts). The host
 * runs the typed calls (packages/workbench-host bridgeContract.test.ts).
 */
import { callMessage, sendBridgeCall } from "@scenity/bridge";
import { ANSWER_CASES, BASE_CALL_CASES, EVENT_CASES } from "@scenity/bridge/cases";
import type { RequestParams } from "@scenity/workbench-host/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRelay, type FrameTarget } from "../../src/surfaces/relay";

const LAB = "http://127.0.0.1:5400";

class FakeFrame implements FrameTarget {
  readonly origin = LAB;
  readonly posted: unknown[] = [];
  readonly window = {
    postMessage: (message: unknown) => {
      this.posted.push(message);
    },
  };
}

function setup() {
  const answers: RequestParams<"surface.call">[] = [];
  const delivered: unknown[] = [];
  const relay = createRelay({
    answer: (params) => answers.push(params),
    report: (params) => delivered.push(params.event),
    onKey: (key) => delivered.push({ workbench: 1, event: "key", key }),
    onImport: (_surface, event) => delivered.push(event),
    onScratch: (_surface, _where, event) => delivered.push(event),
    onLink: (_surface, _where, event) => delivered.push(event),
    onDetach: (_surface, _where, event) => delivered.push(event),
    timeoutMs: 500,
  });
  const frame = new FakeFrame();
  relay.attach("lab", "visible", frame);
  const receive = (data: unknown) => {
    relay.receive({ source: frame.window, origin: LAB, data });
  };
  return { relay, frame, answers, delivered, receive };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the base calls on the caller side", () => {
  for (const item of BASE_CALL_CASES) {
    test(`${item.def.name}: ${item.name}`, async () => {
      const { relay, frame, receive } = setup();
      const sent = sendBridgeCall(item.def, (call, args) => relay.call("lab", "visible", call, args), ...item.args);
      if (item.error !== undefined) {
        await expect(sent).rejects.toThrow(item.error);
        expect(frame.posted).toEqual([]);
        return;
      }
      expect(frame.posted).toEqual([callMessage(1, item.def.name, item.wire)]);
      receive({ workbench: 1, id: 1, error: "stop" });
      await expect(sent).rejects.toThrow("stop");
    });
  }
});

describe("the answers on the caller side", () => {
  for (const item of ANSWER_CASES) {
    test(`${item.outcome === null ? "ignores" : "reads"} ${item.name}`, () => {
      const { relay, answers, receive } = setup();
      relay.request({ request: 7, surface: "lab", where: "visible", call: "url", args: [] });
      // The first call of the relay has the ID 1, as the answers of the cases.
      receive(item.data);
      expect(answers).toEqual(item.outcome === null ? [] : [{ request: 7, ...item.outcome }]);
      expect(relay.waiting()).toBe(item.outcome === null ? 1 : 0);
    });
  }
});

describe("the events on the caller side", () => {
  for (const item of EVENT_CASES) {
    test(`${item.ok ? "takes" : "drops"} ${item.name}`, () => {
      const { delivered, receive } = setup();
      receive(item.message);
      expect(delivered).toEqual(item.ok ? [item.message] : []);
    });
  }
});
