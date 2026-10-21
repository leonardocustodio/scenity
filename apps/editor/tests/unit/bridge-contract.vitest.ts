// SPDX-License-Identifier: Apache-2.0
// The bridge contract on the frame side: the shared case table of @scenity/bridge runs against the bridge of the lab
// page. The workbench page and the host run the same cases on the caller side
// (apps/workbench bridge-contract.vitest.ts, packages/workbench-host bridgeContract.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callMessage, isBridgeEvent, readCall } from "@scenity/bridge";
import { BASE_CALL_CASES, bodyOf, CALL_MESSAGE_CASES, EVENT_CASES, type CallCase } from "@scenity/bridge/cases";
import { startWorkbenchBridge } from "../../src/core/bridge/workbenchBridge";
import type { Room3DLabApi } from "../../src/core/useLabApi";
import type { ViewHandle } from "../../src/core/useLabStats";

/** The call cases of the typed calls of each editor face of a plugin (`PLUGIN_CALL_CASES`). */
const PLUGIN_CASES = Object.values(
  import.meta.glob<readonly CallCase[]>("../../../../plugins/*/editor/tests/bridgeCases.ts", {
    eager: true,
    import: "PLUGIN_CALL_CASES",
  }),
).flat();

const ORIGIN = "http://127.0.0.1:4800";
const SEARCH = `?take=greet&workbench=${encodeURIComponent(ORIGIN)}`;

/** A fake window of the lab page in a frame of the workbench page. */
function fakeHost() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const posted: Record<string, unknown>[] = [];
  const parent = {
    postMessage(message: unknown) {
      posted.push(message as Record<string, unknown>);
    },
  };
  const host = {
    parent,
    location: { href: `http://127.0.0.1:5175/${SEARCH}`, search: SEARCH },
    console: { error: vi.fn(), warn: vi.fn() },
    history: { replaceState: vi.fn(), pushState: vi.fn() },
    document: { querySelector: () => null },
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    send(data: unknown) {
      for (const listener of listeners.get("message") ?? []) {
        listener({ source: parent, origin: ORIGIN, data } as unknown as Event);
      }
    },
    posted,
  };
  return host;
}

/** The view of the page: its capture gives no picture, so a capture with valid arguments ends at the view. */
const captured: unknown[][] = [];
const view = {
  capture: (...args: unknown[]) => {
    captured.push(args);
    return Promise.resolve({ simMs: 0, bitmap: null });
  },
} as unknown as ViewHandle;

/** The plugin methods of the lab API: each keeps its arguments. */
const pluginCalls: { call: string; args: unknown[] }[] = [];
function fakeApi(): Room3DLabApi {
  const spy =
    (call: string) =>
    (...args: unknown[]) => {
      pluginCalls.push({ call, args });
      return { ok: true };
    };
  return { check: spy("check"), place: spy("place"), layoutCheck: spy("layoutCheck") } as unknown as Room3DLabApi;
}

let host: ReturnType<typeof fakeHost>;
let stop: (() => void) | null = null;
let nextId = 1;

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.__room3dLab = fakeApi();
  host = fakeHost();
  stop = startWorkbenchBridge({
    view: () => view,
    host,
    visibility: { set: () => "visible", during: (run) => run(), state: () => "visible", stop: () => undefined },
  });
  captured.length = 0;
  pluginCalls.length = 0;
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  globalThis.__room3dLab = undefined;
});

/** Send one call into the page and give its answer. */
async function answerOf(call: string, args: readonly unknown[]): Promise<Record<string, unknown> | undefined> {
  const id = nextId++;
  host.send(callMessage(id, call, args));
  await vi.advanceTimersByTimeAsync(0);
  return host.posted.find((message) => message.id === id);
}

/** Run one call case: an invalid case gives the error of the contract, a valid one reaches the page. */
async function runCase(
  item: CallCase,
  reached: (answer: Record<string, unknown> | undefined) => readonly unknown[] | undefined,
): Promise<void> {
  const answer = await answerOf(item.def.name, item.args);
  if (item.error !== undefined) {
    expect(answer).toEqual({ workbench: 1, id: answer?.id, error: item.error });
    expect(reached(answer)).toBeUndefined();
    return;
  }
  expect(answer?.workbench).toBe(1);
  expect(reached(answer)).toEqual(item.wire);
}

describe("the base calls on the frame side", () => {
  for (const item of BASE_CALL_CASES) {
    it(`${item.def.name}: ${item.name}`, async () => {
      await runCase(item, (answer) => {
        // `url` and `console` take no arguments: a result shows that the call reached the page.
        if (item.def.name !== "capture") return answer !== undefined && "result" in answer ? [] : undefined;
        // The view gets the width, the height (none for 0) and the target; the quality goes to the encoder.
        const [first] = captured;
        if (first === undefined) return undefined;
        const [width, height, where] = first as [number, number | undefined, object];
        return [width, item.wire?.[1] ?? null, height ?? 0, Object.keys(where).length === 0 ? null : where];
      });
    });
  }
});

describe("the typed calls of the plugin on the frame side", () => {
  // No plugin of this workspace has an editor face. A plugin outside the checkout runs its cases with a copy of
  // this test.
  it("finds the cases of the plugins of the workspace", () => {
    expect(Array.isArray(PLUGIN_CASES)).toBe(true);
  });
  for (const item of PLUGIN_CASES) {
    it(`${item.def.name}: ${item.name}`, async () => {
      await runCase(item, () => pluginCalls.find((entry) => entry.call === item.def.name)?.args);
    });
  }
});

describe("the call messages on the frame side", () => {
  for (const item of CALL_MESSAGE_CASES) {
    it(`${item.read === null ? "does not answer" : "answers"} ${item.name}`, async () => {
      host.send(item.data);
      await vi.advanceTimersByTimeAsync(0);
      const answers = host.posted.filter((message) => "id" in message);
      expect(answers.length).toBe(item.read === null ? 0 : 1);
      if (item.read !== null) expect(answers[0]?.id).toBe(readCall(item.data)?.id);
    });
  }
});

describe("the events on the frame side", () => {
  for (const item of EVENT_CASES.filter((entry) => entry.ok)) {
    it(`sends ${item.name} as the contract says`, () => {
      globalThis.__workbench?.emit(bodyOf(item));
      const sent = host.posted.at(-1);
      expect(sent).toEqual(item.message);
      expect(isBridgeEvent(sent)).toBe(true);
    });
  }
});
