// SPDX-License-Identifier: Apache-2.0
// The caller side of the bridge contract in the host: the shared call cases of @scenity/bridge through `callTyped`
// of the tool kit. The host tests and the tests of a host plugin use it.
import { expect, test } from "bun:test";
import type { CallCase } from "@scenity/bridge/cases";
import type { SurfacePort } from "../src/tools/context";
import { callTyped } from "../src/tools/kit";

/** A port that keeps each call and gives null. */
export function recordingPort(): { port: SurfacePort; calls: { call: string; args: readonly unknown[] }[] } {
  const calls: { call: string; args: readonly unknown[] }[] = [];
  const port = {
    call: (call: string, args: readonly unknown[]) => {
      calls.push({ call, args });
      return Promise.resolve(null);
    },
  } as unknown as SurfacePort;
  return { port, calls };
}

/** Run the call cases through `callTyped`: an invalid case throws before the send, a valid one sends the wire form. */
export function runCallerCases(cases: readonly CallCase[]): void {
  for (const item of cases) {
    test(`${item.def.name}: ${item.name}`, async () => {
      const { port, calls } = recordingPort();
      const sent = callTyped(port, item.def, item.args);
      if (item.error !== undefined) {
        const error = await sent.then(
          () => null,
          (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
        );
        expect(error).toBe(item.error);
        expect(calls).toEqual([]);
        return;
      }
      await sent.catch(() => null);
      expect(calls).toEqual([{ call: item.def.name, args: item.wire ?? [] }]);
    });
  }
}
