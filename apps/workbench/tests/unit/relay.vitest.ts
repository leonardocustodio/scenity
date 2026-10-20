// SPDX-License-Identifier: Apache-2.0
/**
 * The relay of the page (the page half). A `surface.request` of the host goes into the frame with `postMessage`
 * (target = the frame origin). The answer of the frame returns with `surface.call`. Each bridge event goes to the host
 * with `surface.report`. Messages of another window or another origin do nothing.
 */
import type { RequestParams } from "@scenity/workbench-host/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRelay, type FrameTarget } from "../../src/surfaces/relay";
import { frameSrc, nextFrameSrc } from "../../src/surfaces/useSurface";

const LAB = "http://127.0.0.1:5400";

class FakeFrame implements FrameTarget {
  readonly origin = LAB;
  readonly posted: { message: Record<string, unknown>; target: string }[] = [];
  readonly window = {
    postMessage: (message: unknown, target: string) => {
      this.posted.push({ message: message as Record<string, unknown>, target });
    },
  };
}

function setup() {
  const answers: RequestParams<"surface.call">[] = [];
  const reports: RequestParams<"surface.report">[] = [];
  const relay = createRelay({
    answer: (params) => answers.push(params),
    report: (params) => reports.push(params),
    timeoutMs: 500,
  });
  const frame = new FakeFrame();
  const detach = relay.attach("lab", "visible", frame);
  return { relay, frame, answers, reports, detach };
}

const REQUEST = { request: 41, surface: "lab", where: "visible" as const, call: "seek", args: [6350] };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("relay", () => {
  test("posts a host request into the frame and sends the answer back", () => {
    const { relay, frame, answers } = setup();
    relay.request(REQUEST);
    expect(frame.posted).toEqual([{ message: { workbench: 1, id: 1, call: "seek", args: [6350] }, target: LAB }]);
    relay.receive({ source: frame.window, origin: LAB, data: { workbench: 1, id: 1, result: { t: 6350 } } });
    expect(answers).toEqual([{ request: 41, result: { t: 6350 } }]);
    expect(relay.waiting()).toBe(0);
  });

  test("sends a frame error back as an error", () => {
    const { relay, answers } = setup();
    const frame = new FakeFrame();
    relay.attach("lab", "shadow", frame);
    relay.request({ ...REQUEST, where: "shadow" });
    relay.receive({ source: frame.window, origin: LAB, data: { workbench: 1, id: 1, error: "Unknown camera." } });
    expect(answers).toEqual([{ request: 41, error: "Unknown camera." }]);
  });

  test("ignores an answer from another window, another origin or another frame", () => {
    const { relay, frame, answers } = setup();
    const other = new FakeFrame();
    relay.attach("lab", "shadow", other);
    relay.request(REQUEST);
    const answer = { workbench: 1, id: 1, result: "forged" };
    relay.receive({ source: {}, origin: LAB, data: answer });
    relay.receive({ source: frame.window, origin: "http://127.0.0.1:9999", data: answer });
    relay.receive({ source: other.window, origin: LAB, data: answer });
    expect(answers).toEqual([]);
    expect(relay.waiting()).toBe(1);
  });

  test("answers with an error when no frame exists or the frame does not answer in time", () => {
    const { relay, answers } = setup();
    relay.request({ ...REQUEST, where: "shadow" });
    expect(answers).toEqual([{ request: 41, error: "No shadow frame of surface lab." }]);
    relay.request({ ...REQUEST, request: 42 });
    vi.advanceTimersByTime(500);
    expect(answers[1]).toEqual({ request: 42, error: "The frame did not answer seek in 500 ms." });
  });

  test("fails the waiting calls of a frame that closes", () => {
    const { relay, answers, detach } = setup();
    relay.request(REQUEST);
    detach();
    expect(answers).toEqual([{ request: 41, error: "The frame of the surface closed." }]);
  });

  test("forwards each bridge event of the frame with surface.report", () => {
    const { relay, frame, reports } = setup();
    const events = [
      { workbench: 1, event: "ready", url: `${LAB}/?take=greet` },
      { workbench: 1, event: "url", url: `${LAB}/?take=greet&t=6350` },
      { workbench: 1, event: "hmr", files: ["/src/families/hand_wave.ts"] },
      { workbench: 1, event: "reload", url: `${LAB}/?take=greet&t=6350` },
      { workbench: 1, event: "console", level: "error", text: "boom" },
    ];
    for (const data of events) relay.receive({ source: frame.window, origin: LAB, data });
    relay.receive({ source: frame.window, origin: LAB, data: { workbench: 1, event: "other" } });
    relay.receive({ source: {}, origin: LAB, data: events[0] });
    expect(reports).toEqual(events.map((event) => ({ surface: "lab", where: "visible", event })));
  });
});

describe("frame src", () => {
  const PAGE = "http://127.0.0.1:5300";
  test("adds the workbench origin to the surface URL", () => {
    expect(frameSrc(`${LAB}/?take=greet&t=10`, PAGE)).toBe(
      `${LAB}/?take=greet&t=10&workbench=${encodeURIComponent(PAGE)}`,
    );
    expect(frameSrc(`${LAB}/?workbench=old`, "tauri://localhost")).toBe(`${LAB}/?workbench=tauri%3A%2F%2Flocalhost`);
  });

  test("keeps the src while the origin stays, so a URL change in the frame does not load it again", () => {
    const first = nextFrameSrc(null, `${LAB}/?t=1`, PAGE);
    expect(first).toBe(`${LAB}/?t=1&workbench=${encodeURIComponent(PAGE)}`);
    expect(nextFrameSrc(first, `${LAB}/?t=2`, PAGE)).toBe(first);
    expect(nextFrameSrc(first, "http://127.0.0.1:5401/?t=2", PAGE)).toBe(
      `http://127.0.0.1:5401/?t=2&workbench=${encodeURIComponent(PAGE)}`,
    );
    expect(nextFrameSrc(first, null, PAGE)).toBeNull();
    expect(nextFrameSrc(null, "not a url", PAGE)).toBeNull();
  });
});
