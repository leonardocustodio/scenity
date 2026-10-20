// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the lifecycle messages in the protocol: the capture at 16:10, the JPEG capture of WebKit, the requests
 * `surface.front` and `host.restart` and the event `host.restarting`.
 */
import { describe, expect, test } from "bun:test";
import { captureArgs, isCapture, isEventType, isRequestType, RESTART_EXIT_CODE, type Capture } from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

describe("the host lifecycle messages", () => {
  test("the requests and the event are part of the protocol", () => {
    expect(isRequestType("surface.front")).toBe(true);
    expect(isRequestType("host.restart")).toBe(true);
    expect(isEventType("host.restarting")).toBe(true);
    expect(RESTART_EXIT_CODE).toBe(75);
  });

  test("a capture is asked at 16:10", () => {
    expect(captureArgs(1280)).toEqual([1280, null, 800]);
    expect(captureArgs(640)).toEqual([640, null, 400]);
  });

  test("a capture may be WebP, JPEG (WebKit) or PNG", () => {
    const shot: Capture = { simMs: 1, width: 2, height: 1, mime: "image/jpeg", bytes: new Uint8Array([0]) };
    expect(isCapture(shot)).toBe(true);
    expect(isCapture({ ...shot, mime: "image/webp" })).toBe(true);
    expect(isCapture({ ...shot, mime: "image/png" })).toBe(true);
    expect(isCapture({ ...shot, mime: "image/gif" })).toBe(false);
  });
});
