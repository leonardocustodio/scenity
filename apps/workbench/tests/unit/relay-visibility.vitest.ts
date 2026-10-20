// SPDX-License-Identifier: Apache-2.0
/**
 * The hidden surface tabs. When the tab of a surface is behind another tab, the relay tells its visible frame to
 * pause (`visibility` "hidden"). The relay tells it again after an attach and after a `ready` of the frame (a reload).
 * It sends "visible" when the tab comes to the front. A shadow frame gets no call, and the answer of the frame goes
 * nowhere.
 */
import type { RequestParams } from "@scenity/workbench-host/protocol";
import { describe, expect, test } from "vitest";
import { createRelay, type FrameTarget } from "../../src/surfaces/relay";

const WEB = "http://127.0.0.1:5401";

class FakeFrame implements FrameTarget {
  readonly origin = WEB;
  readonly posted: Record<string, unknown>[] = [];
  readonly window = {
    postMessage: (message: unknown) => {
      this.posted.push(message as Record<string, unknown>);
    },
  };
}

function setup() {
  const answers: RequestParams<"surface.call">[] = [];
  const reports: RequestParams<"surface.report">[] = [];
  const relay = createRelay({ answer: (params) => answers.push(params), report: (params) => reports.push(params) });
  return { relay, answers, reports };
}

const calls = (frame: FakeFrame) => frame.posted.map((message) => [message.call, message.args]);

describe("relay visibility", () => {
  test("tells the visible frame of a hidden tab to pause and to draw again", () => {
    const { relay, answers } = setup();
    const frame = new FakeFrame();
    relay.attach("web", "visible", frame);
    relay.setHidden("web", true);
    relay.setHidden("web", true);
    relay.setHidden("web", false);
    expect(calls(frame)).toEqual([
      ["visibility", ["hidden"]],
      ["visibility", ["visible"]],
    ]);
    // The answer of the frame has no call of the host that waits.
    relay.receive({ source: frame.window, origin: WEB, data: { workbench: 1, id: 1, result: "hidden" } });
    expect(answers).toEqual([]);
  });

  test("tells a frame again after its attach and after its ready event; a shadow frame gets nothing", () => {
    const { relay, reports } = setup();
    relay.setHidden("web", true);
    const frame = new FakeFrame();
    const shadow = new FakeFrame();
    relay.attach("web", "visible", frame);
    relay.attach("web", "shadow", shadow);
    expect(calls(frame)).toEqual([["visibility", ["hidden"]]]);
    relay.receive({ source: frame.window, origin: WEB, data: { workbench: 1, event: "ready", url: `${WEB}/` } });
    expect(calls(frame)).toEqual([
      ["visibility", ["hidden"]],
      ["visibility", ["hidden"]],
    ]);
    expect(reports).toHaveLength(1);
    expect(shadow.posted).toEqual([]);
  });
});
