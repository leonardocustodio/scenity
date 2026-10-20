// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the before and after of a turn with a fake lab surface: the before picture at
 * the prompt, the wait for the update of an edited lab file, the frame restored to the URL state of the turn start
 * after a reload that lost it, the `agent.turn` event within three seconds, and the edits of files that are not lab
 * files. No lab source changes: the files are in a temporary folder that the fake surface reports.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HmrRecord, HmrTarget } from "../src/hmr";
import { PictureStore } from "../src/pictures";
import type { Capture, HostEvent, PictureRef, SurfaceState } from "../src/protocol";
import type { Surface } from "../src/surfaces";
import { restoreUrlState, TurnCapture, underRoots } from "../src/turnCapture";
import { cleanup, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const checkout = tempDir("turn-capture");
const roots = [join(checkout, "apps/editor/src")];
const START = "http://127.0.0.1:5400/?take=greet&t=6350&paused=1&camera=side";

const store = new PictureStore(join(checkout, ".state"));

function picture(simMs: number): Capture {
  return { simMs, width: 640, height: 400, mime: "image/webp", bytes: new TextEncoder().encode(`pic${String(simMs)}`) };
}

/** The text of the bytes of a picture of the store (the event gives the ID only). */
function label(ref: PictureRef | null | undefined): string | null {
  const stored = ref === null || ref === undefined ? null : store.read(ref.id);
  return stored === null ? null : new TextDecoder().decode(stored.bytes);
}

/** A fake visible lab frame: its URL state moves with the calls; `hmr` resolves the waits for files. */
function fakeSurface(options: { reload?: boolean; noUpdate?: boolean } = {}) {
  let url = START;
  let clock = 6350;
  const calls: string[] = [];
  const waits: string[] = [];
  const surface: Surface = {
    id: "lab",
    get state(): SurfaceState {
      return {
        id: "lab",
        kind: "scene",
        label: "Lab",
        capabilities: ["scene"],
        checkout,
        url: `${url}&workbench=http%3A%2F%2F127.0.0.1%3A5300`,
        server: { status: "ready", port: 5400, error: null },
        lastEdit: null,
      };
    },
    lastHmr: null,
    consoleErrors: [],
    call: (call: string, args: readonly unknown[] = []) => {
      calls.push(`${call}${args.length === 0 ? "" : ` ${JSON.stringify(args)}`}`);
      if (call === "seek") clock = Number(args[0]);
      return Promise.resolve(null);
    },
    url: () => Promise.resolve(url),
    capture: () => Promise.resolve(picture(clock)),
    waitForHmr: (target: HmrTarget): Promise<HmrRecord> => {
      waits.push(typeof target === "string" ? target : String(target.since));
      if (options.noUpdate === true) return Promise.reject(new Error("no update"));
      if (options.reload === true) {
        // The reload lost the clock (the frame starts at the take start).
        url = "http://127.0.0.1:5400/?take=greet";
        clock = 0;
      }
      return Promise.resolve({ files: [], at: Date.now(), reloaded: options.reload === true });
    },
    clearConsole: () => undefined,
  };
  return { surface, calls, waits };
}

function capture(surface: Surface, events: HostEvent[]) {
  return new TurnCapture({
    surface: () => surface,
    checkout: () => checkout,
    emit: (event) => events.push(event),
    roots: () => roots,
    settleMs: 20,
    store,
  });
}

afterAll(() => cleanup(checkout));

describe("the before and after of a turn", () => {
  test("an edit of a lab file gives the agent.turn event with both pictures within three seconds", async () => {
    const fake = fakeSurface();
    const events: HostEvent[] = [];
    const turns = capture(fake.surface, events);
    turns.begin("s1", 1);
    const started = Date.now();
    turns.edit("s1", 1, join(roots[0] ?? "", "core/tunable.ts"));
    await until(() => events.length === 1, 3000, "the agent.turn event");
    expect(Date.now() - started).toBeLessThan(3000);
    const event = events[0];
    if (event?.type !== "agent.turn") throw new Error("no agent.turn");
    expect(label(event.before)).toBe("pic6350");
    expect(label(event.after)).toBe("pic6350");
    expect(event.files).toEqual(["apps/editor/src/core/tunable.ts"]);
    expect(event.url).toBe(START);
    expect(event.reloaded).toBe(false);
    expect(fake.waits).toEqual([join(roots[0] ?? "", "core/tunable.ts")]);
    expect(fake.calls).toEqual(["frame"]);
  });

  test("a reload that lost the clock: the frame goes back to the URL state of the turn start", async () => {
    const fake = fakeSurface({ reload: true });
    const events: HostEvent[] = [];
    const turns = capture(fake.surface, events);
    turns.begin("s1", 3);
    // Before an edit, the after is the current frame, with no files.
    expect((await turns.after("s1"))?.files).toEqual([]);
    expect(await turns.after("nobody")).toBeNull();
    fake.calls.length = 0;
    turns.edit("s1", 3, join(roots[0] ?? "", "workbench/worker.ts"));
    const after = await turns.after();
    expect(after?.reloaded).toBe(true);
    expect(after?.after?.simMs).toBe(6350);
    expect(fake.calls).toEqual(['camera ["side"]', "pause", "seek [6350]", "frame"]);
    expect(events).toHaveLength(2);
  });

  test("many quick edits give one capture; a file that is not a lab file does not wait for an update", async () => {
    const fake = fakeSurface();
    const events: HostEvent[] = [];
    const turns = capture(fake.surface, events);
    turns.begin("s2", 1);
    turns.edit("s2", 1, join(checkout, "docs/notes.md"));
    turns.edit("s2", 1, "docs/other.md");
    await until(() => events.length === 1, 3000, "the agent.turn event");
    await Bun.sleep(60);
    expect(events).toHaveLength(1);
    expect(fake.waits).toEqual([]);
    const event = events[0];
    expect(event?.type === "agent.turn" ? event.files : []).toEqual(["docs/notes.md", "docs/other.md"]);
  });

  test("no update in time still captures, with applied false", async () => {
    const fake = fakeSurface({ noUpdate: true });
    const turns = capture(fake.surface, []);
    turns.begin("s3", 1);
    turns.edit("s3", 1, join(roots[0] ?? "", "x.ts"));
    const after = await turns.after("s3");
    expect(after).toMatchObject({ applied: false, reloaded: false, error: null });
    expect(new TextDecoder().decode(after?.after?.bytes)).toBe("pic6350");
  });
});

describe("the helpers", () => {
  test("underRoots", () => {
    expect(underRoots("/a/b/c.ts", ["/a/b"])).toBe(true);
    expect(underRoots("/a/bc.ts", ["/a/b"])).toBe(false);
    expect(underRoots("/a/b", ["/a/b"])).toBe(false);
  });

  test("restoreUrlState does nothing at the same state", async () => {
    const fake = fakeSurface();
    expect(await restoreUrlState(fake.surface, START, START)).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});
