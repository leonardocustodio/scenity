// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the workbench protocol: the READY line, the envelopes of the WebSocket protocol and the messages of the
 * surface bridge.
 */
import { describe, expect, test } from "bun:test";
import {
  EVENT_TYPES,
  REQUEST_TYPES,
  answerError,
  answerOk,
  formatReadyLine,
  isAnswer,
  isBridgeAnswer,
  isBridgeCall,
  isBridgeEvent,
  isCapture,
  isEvent,
  isEventOf,
  isHostOrigin,
  isRequest,
  isRequestOf,
  isToken,
  parseReadyLine,
  readHostMessage,
  readRequest,
} from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "0123456789abcdef".repeat(4);
const ORIGIN = "http://127.0.0.1:52140";

describe("the READY line", () => {
  test("a formatted line parses back", () => {
    const line = formatReadyLine({ origin: ORIGIN, token: TOKEN });
    expect(line).toBe(`WORKBENCH_READY {"origin":"${ORIGIN}","token":"${TOKEN}"}`);
    expect(parseReadyLine(line)).toEqual({ origin: ORIGIN, token: TOKEN });
    expect(parseReadyLine(`${line}\r\n`)).toEqual({ origin: ORIGIN, token: TOKEN });
  });

  test("another line gives null", () => {
    expect(parseReadyLine("")).toBeNull();
    expect(parseReadyLine("vite ready in 300 ms")).toBeNull();
    expect(parseReadyLine(`WORKBENCH_READY{"origin":"${ORIGIN}","token":"${TOKEN}"}`)).toBeNull();
    expect(parseReadyLine("WORKBENCH_READY not json")).toBeNull();
    expect(parseReadyLine("WORKBENCH_READY [1]")).toBeNull();
  });

  test("a bad origin or token gives null", () => {
    const line = (origin: string, token: string) => `WORKBENCH_READY ${JSON.stringify({ origin, token })}`;
    expect(parseReadyLine(line("http://localhost:52140", TOKEN))).toBeNull();
    expect(parseReadyLine(line("http://0.0.0.0:52140", TOKEN))).toBeNull();
    expect(parseReadyLine(line("http://127.0.0.1:0", TOKEN))).toBeNull();
    expect(parseReadyLine(line("http://127.0.0.1:65536", TOKEN))).toBeNull();
    expect(parseReadyLine(line("https://127.0.0.1:52140", TOKEN))).toBeNull();
    expect(parseReadyLine(line(ORIGIN, TOKEN.toUpperCase()))).toBeNull();
    expect(parseReadyLine(line(ORIGIN, TOKEN.slice(1)))).toBeNull();
  });

  test("the token and origin guards", () => {
    expect(isToken(TOKEN)).toBe(true);
    expect(isToken(42)).toBe(false);
    expect(isHostOrigin("http://127.0.0.1:1")).toBe(true);
    expect(isHostOrigin("http://127.0.0.1:65535")).toBe(true);
    expect(isHostOrigin("http://127.0.0.1")).toBe(false);
  });
});

describe("the message types", () => {
  test("every message of the protocol has a type", () => {
    const appendixB = [
      "checkouts.list",
      "checkouts.create",
      "checkouts.open",
      "surface.state",
      "surface.call",
      "surface.request",
      "terminal.open",
      "terminal.input",
      "terminal.resize",
      "terminal.output",
      "terminal.exit",
      "agent.start",
      "agent.prompt",
      "agent.interrupt",
      "agent.answer",
      "agent.setMode",
      "agent.setModel",
      "agent.resume",
      "agent.message",
      "agent.ask",
      "agent.turn",
      "git.status",
      "git.diff",
      "git.undoTurn",
      "git.commit",
      "runs.start",
      "runs.cancel",
      "runs.output",
      "runs.done",
      "context.packet",
    ];
    const all: string[] = [...REQUEST_TYPES, ...EVENT_TYPES];
    expect(appendixB.filter((name) => !all.includes(name))).toEqual([]);
  });

  test("no name is both a request and an event", () => {
    expect(REQUEST_TYPES.filter((name) => (EVENT_TYPES as string[]).includes(name))).toEqual([]);
  });
});

describe("the WebSocket envelopes", () => {
  test("a request has an id and a known type", () => {
    expect(isRequest({ id: 1, type: "checkouts.list" })).toBe(true);
    expect(isRequest({ id: 0, type: "terminal.input", terminal: "t1", data: "x" })).toBe(true);
    expect(isRequest({ id: -1, type: "checkouts.list" })).toBe(false);
    expect(isRequest({ id: 1.5, type: "checkouts.list" })).toBe(false);
    expect(isRequest({ id: "1", type: "checkouts.list" })).toBe(false);
    expect(isRequest({ id: 1, type: "checkouts.delete" })).toBe(false);
    expect(isRequest({ id: 1, type: "toString" })).toBe(false);
    expect(isRequest([1, "checkouts.list"])).toBe(false);
    expect(isRequestOf({ id: 2, type: "runs.start", command: "motion", args: [] }, "runs.start")).toBe(true);
    expect(isRequestOf({ id: 2, type: "runs.start" }, "runs.cancel")).toBe(false);
  });

  test("an answer has ok with a result or an error", () => {
    expect(isAnswer(answerOk(3, null))).toBe(true);
    expect(isAnswer(answerOk(3, [1, 2]))).toBe(true);
    expect(isAnswer(answerError(3, "no such checkout"))).toBe(true);
    expect(isAnswer({ id: 3, ok: true })).toBe(false);
    expect(isAnswer({ id: 3, ok: false })).toBe(false);
    expect(isAnswer({ ok: true, result: 1 })).toBe(false);
  });

  test("an event has a known type and no id", () => {
    expect(isEvent({ type: "terminal.output", terminal: "t1", data: "hi" })).toBe(true);
    expect(isEvent({ id: 1, type: "terminal.output" })).toBe(false);
    expect(isEvent({ type: "terminal.input" })).toBe(false);
    expect(isEventOf({ type: "runs.done", run: "r1" }, "runs.done")).toBe(true);
    expect(isEventOf({ type: "runs.done", run: "r1" }, "runs.output")).toBe(false);
  });

  test("the readers take JSON text", () => {
    expect(readHostMessage('{"id":4,"ok":true,"result":{"run":"r1"}}')).toEqual({
      id: 4,
      ok: true,
      result: { run: "r1" },
    });
    const packet = { surface: "lab", made: "2026-10-12T15:04:00Z", checkout: "/c", url: null, text: "Workbench" };
    expect(readHostMessage(JSON.stringify({ type: "context.packet", packet }))).toEqual({
      type: "context.packet",
      packet,
    });
    expect(readHostMessage('{"id":4,"type":"checkouts.list"}')).toBeNull();
    expect(readHostMessage("{")).toBeNull();
    expect(readRequest('{"id":5,"type":"git.status"}')).toEqual({ id: 5, type: "git.status" });
    expect(readRequest('{"type":"git.status"}')).toBeNull();
    expect(readRequest("null")).toBeNull();
  });
});

describe("the surface bridge", () => {
  test("a call has workbench 1, an id, a call name and an args array", () => {
    expect(isBridgeCall({ workbench: 1, id: 1, call: "seek", args: [6350] })).toBe(true);
    expect(isBridgeCall({ workbench: 1, id: 1, call: "capture", args: [] })).toBe(true);
    expect(isBridgeCall({ workbench: 2, id: 1, call: "seek", args: [] })).toBe(false);
    expect(isBridgeCall({ workbench: 1, id: 1, call: "", args: [] })).toBe(false);
    expect(isBridgeCall({ workbench: 1, id: 1, call: "seek", args: 6350 })).toBe(false);
  });

  test("an answer has a result or an error", () => {
    expect(isBridgeAnswer({ workbench: 1, id: 1, result: null })).toBe(true);
    expect(isBridgeAnswer({ workbench: 1, id: 1, error: "unknown camera" })).toBe(true);
    expect(isBridgeAnswer({ workbench: 1, id: 1 })).toBe(false);
    expect(isBridgeAnswer({ workbench: 1, id: 1, call: "seek", args: [], error: 1 })).toBe(false);
    expect(isBridgeAnswer({ id: 1, result: null })).toBe(false);
  });

  test("an event has a known name and its payload", () => {
    expect(isBridgeEvent({ workbench: 1, event: "ready", url: "http://127.0.0.1:5199/?take=greet" })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "hmr", files: ["/src/core/lab.ts"] })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "console", level: "warn", text: "slow frame" })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "console", level: "info", text: "x" })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "hmr", files: [1] })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "url" })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "focus", url: "x" })).toBe(false);
    // The workbench chords that a lab frame forwards. Other keys are not events.
    expect(isBridgeEvent({ workbench: 1, event: "key", key: "\\" })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "key", key: "k" })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "key", key: " " })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "key" })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, id: 2, event: "ready", url: "x" })).toBe(false);
  });

  test("a capture is a WebP (or a JPEG of WebKit, or a PNG) with its bytes", () => {
    const capture = { simMs: 6350, width: 640, height: 400, mime: "image/webp", bytes: new Uint8Array([82, 73]) };
    expect(isCapture(capture)).toBe(true);
    expect(isCapture({ ...capture, bytes: "UklGRg==" })).toBe(false);
    expect(isCapture({ ...capture, simMs: null })).toBe(true);
    expect(isCapture({ ...capture, mime: "image/png" })).toBe(true);
    expect(isCapture({ ...capture, mime: "image/jpeg" })).toBe(true);
    expect(isCapture({ ...capture, mime: "image/gif" })).toBe(false);
  });
});
