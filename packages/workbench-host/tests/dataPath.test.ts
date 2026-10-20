// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the smaller costs of the data path: no packet build while the lab plays (30 s of play counted), and one
 * build on a pause and on a seek of a stopped clock. The output of a run goes in batches of 16 ms, and each broadcast
 * makes one JSON text.
 */
import { describe, expect, test } from "bun:test";
import { surfaceEvents, type PacketState } from "../src/agentLoop";
import { playTick } from "../src/context";
import type { BridgeEvent } from "../src/protocol";
import { OutputBatch } from "../src/runOutput";
import { messageText, startServer } from "../src/server";
import { until } from "./helpers";

const LAB = "http://127.0.0.1:5400/?take=greet&camera=chest&worker=1";

/** The URL event of the visible lab at a time, playing or paused. */
function urlEvent(t: number, paused = false, extra = ""): BridgeEvent {
  return { workbench: 1, event: "url", url: `${LAB}&t=${String(t)}${paused ? "&paused=1" : ""}${extra}` };
}

/** The event handler of the agent loop with a counter of the packet refreshes. */
function handler(): { send(event: BridgeEvent): void; refreshes(): number } {
  let count = 0;
  const state: PacketState = { building: false, quietUntil: 0, url: null, seen: null };
  const on = surfaceEvents({ onEvent: () => undefined }, { refresh: () => (count += 1) }, state, () => "lab");
  return {
    send: (event) => {
      on("lab", "visible", event);
      // The refresh builds at once in this count: the packet takes the URL of the event.
      if (event.event === "url" && count > 0) state.url = event.url;
    },
    refreshes: () => count,
  };
}

describe("the packet while the lab plays", () => {
  test("a running clock only moves t: no build; a pause, a seek, a camera change build", () => {
    expect(playTick(`${LAB}&t=1000`, `${LAB}&t=2000`)).toBe(true);
    expect(playTick(`${LAB}&t=1000`, `${LAB}&t=2000&paused=1`)).toBe(false);
    expect(playTick(`${LAB}&t=1000&paused=1`, `${LAB}&t=4000&paused=1`)).toBe(false);
    expect(playTick(`${LAB}&t=1000`, `${LAB.replace("chest", "top")}&t=2000`)).toBe(false);
    expect(playTick(null, `${LAB}&t=2000`)).toBe(false);
    expect(playTick("not a URL", `${LAB}&t=2000`)).toBe(false);
  });

  test("30 s of play give 0 packet builds; the pause gives 1 and a seek of the stopped clock 1 more", () => {
    const loop = handler();
    loop.send(urlEvent(0, true));
    const start = loop.refreshes();
    // The lab writes the time of a clock that runs into its URL once per second (useLabTake.ts).
    loop.send(urlEvent(0));
    const played = loop.refreshes();
    for (let second = 1; second <= 30; second += 1) loop.send(urlEvent(second * 1000));
    const during = loop.refreshes() - played;
    loop.send(urlEvent(30_000, true));
    const paused = loop.refreshes();
    loop.send(urlEvent(12_000, true));
    process.stderr.write(`packet builds during 30 s of play: ${String(during)}\n`);
    expect(start).toBe(1);
    expect(during).toBe(0);
    expect(paused - played).toBe(1);
    expect(loop.refreshes() - paused).toBe(1);
  });

  test("an edit (hmr) and an error still build while the clock plays", () => {
    const loop = handler();
    loop.send(urlEvent(1000));
    loop.send(urlEvent(2000));
    const before = loop.refreshes();
    loop.send({ workbench: 1, event: "hmr", files: ["/src/core/x.ts"] });
    loop.send({ workbench: 1, event: "console", level: "error", text: "boom" });
    loop.send({ workbench: 1, event: "console", level: "warn", text: "hm" });
    expect(loop.refreshes() - before).toBe(2);
  });
});

describe("the output of a run", () => {
  test("the chunks of one stream go as one event per batch, in order, and the end sends the rest", async () => {
    const sent: string[] = [];
    const batch = new OutputBatch((stream, data) => sent.push(`${stream}:${data}`), 16);
    for (let index = 0; index < 100; index += 1) batch.push("stdout", String(index % 10));
    batch.push("stderr", "E");
    batch.push("stdout", "z");
    expect(sent).toEqual([`stdout:${"0123456789".repeat(10)}`, "stderr:E"]);
    await until(() => sent.length === 3, 1000, "the timed batch");
    expect(sent[2]).toBe("stdout:z");
    batch.push("stdout", "end");
    batch.flush();
    expect(sent.at(-1)).toBe("stdout:end");
    batch.flush();
    expect(sent).toHaveLength(4);
  });

  test("a wait of 0 sends each chunk at once", () => {
    const sent: string[] = [];
    const batch = new OutputBatch((_stream, data) => sent.push(data), 0);
    batch.push("stdout", "a");
    batch.push("stdout", "b");
    expect(sent).toEqual(["a", "b"]);
  });
});

describe("the broadcast", () => {
  test("one JSON text goes to every page", async () => {
    const server = startServer({ port: 0, token: "cd".repeat(32), onMessage: () => Promise.resolve(null) });
    const sockets = [0, 1, 2].map(
      () => new WebSocket(`${server.origin.replace("http", "ws")}/ws?token=${"cd".repeat(32)}`),
    );
    const texts: string[][] = sockets.map(() => []);
    sockets.forEach((socket, index) =>
      socket.addEventListener("message", (message) => texts[index]?.push(String(message.data))),
    );
    try {
      await until(() => server.clients().length === 3, 3000, "three pages");
      const event = { type: "runs.output", run: "r1", stream: "stdout", data: "line\n" } as const;
      server.broadcast(event);
      await until(() => texts.every((list) => list.length === 1), 3000, "the broadcast");
      expect(texts.map((list) => list[0])).toEqual([0, 1, 2].map(() => messageText(event)));
    } finally {
      for (const socket of sockets) socket.close();
      await server.stop();
    }
  });
});
