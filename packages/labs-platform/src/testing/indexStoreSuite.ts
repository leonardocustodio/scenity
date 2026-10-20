// SPDX-License-Identifier: Apache-2.0
/**
 * The shared test suite of the frame index stores. The host store (files, `bun test`) and the store of the lab page
 * alone (OPFS or IndexedDB, Vitest with fakes) run these same tests. The caller gives the functions of its test
 * runner, so the module imports no runner.
 */
import { frameKey, type FrameKeyInput } from "../frameKey";
import type { FrameIndexStore, IndexStoreOptions } from "../indexStore";

/** The matchers that the suite uses (Bun and Vitest both have them). */
export type SuiteExpect = (value: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeLessThanOrEqual(expected: number): void;
  toMatch(expected: RegExp): void;
};

/** The parts of a test runner that the suite uses. */
export interface SuiteRunner {
  readonly describe: (name: string, body: () => void) => void;
  readonly test: (name: string, body: () => Promise<void>) => void;
  readonly expect: SuiteExpect;
}

/** A store under test: `reopen` gives a new store on the same files (a restart). */
export interface StoreUnderTest {
  readonly store: FrameIndexStore;
  reopen(): FrameIndexStore;
}

const HASH_A = "a".repeat(32);
const HASH_B = "b".repeat(32);
const HASH_C = "c".repeat(32);

/** The input of a frame of the take `greet` at a time, with changes. */
export function sampleInput(timeMs: number, change: Partial<FrameKeyInput> = {}): FrameKeyInput {
  return {
    source: "take:greet",
    events: [],
    timeMs,
    view: "chest",
    tunes: {},
    renderer: { debug: [], assets: true },
    tier: "high",
    contentHash: HASH_A,
    ...change,
  };
}

function bytesOf(length: number, fill = 7): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

/** A clock that counts up, so each use is newer than the last. */
function counter(): () => number {
  let now = 0;
  return () => (now += 1);
}

function basics(runner: SuiteRunner, make: (options: IndexStoreOptions) => Promise<StoreUnderTest>): void {
  const { test, expect } = runner;
  test("a put frame comes back by its key, with its bytes, type and metrics", async () => {
    const { store } = await make({ now: counter() });
    const input = sampleInput(3000);
    const frame = await store.put({
      input,
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(40),
      metrics: { "ik.reachError": 0.01 },
    });
    expect(frame.key).toBe(frameKey(input));
    expect(frame.file).toMatch(/^index\/a{32}\/[0-9a-f]{16}\/1000\/3000-chest-160\.webp$/);
    const hit = await store.get(frame.key, 160);
    expect(hit?.bytes.length).toBe(40);
    expect(hit?.frame.mime).toBe("image/webp");
    expect(hit?.frame.metrics).toEqual({ "ik.reachError": 0.01 });
  });

  test("a size picks its frame; no size gives the smallest; a missing key or size gives null", async () => {
    const { store } = await make({ now: counter() });
    const input = sampleInput(3100);
    await store.put({ input, size: 640, mime: "image/jpeg", bytes: bytesOf(64) });
    await store.put({ input, size: 160, mime: "image/jpeg", bytes: bytesOf(16) });
    expect((await store.get(frameKey(input)))?.frame.size).toBe(160);
    expect((await store.get(frameKey(input), 640))?.bytes.length).toBe(64);
    expect(await store.get(frameKey(input), 1280)).toBeNull();
    expect(await store.get(frameKey(sampleInput(3200)))).toBeNull();
    expect(await store.has(frameKey(sampleInput(3100, { contentHash: HASH_B })))).toBe(false);
  });

  test("a put with the same key and size replaces the frame", async () => {
    const { store } = await make({ now: counter() });
    const input = sampleInput(500);
    await store.put({ input, size: 160, mime: "image/webp", bytes: bytesOf(30) });
    await store.put({ input, size: 160, mime: "image/webp", bytes: bytesOf(50, 9) });
    expect(await store.usage()).toBe(50);
    expect((await store.get(frameKey(input), 160))?.bytes[0]).toBe(9);
    expect((await store.manifest(input))?.frames.length).toBe(1);
  });

  test("the manifest keeps the frames, the metrics and the lanes over a restart", async () => {
    const made = await make({ now: counter() });
    const input = sampleInput(1000);
    await made.store.put({
      input,
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(10),
      metrics: { "feet.belowFloor": 0 },
    });
    await made.store.put({ input: sampleInput(1100), size: 160, mime: "image/webp", bytes: bytesOf(10) });
    await made.store.setLanes(input, { ada: [{ clip: "wave", from: 0, to: 1000 }] });
    await made.store.flush();
    const again = made.reopen();
    const manifest = await again.manifest(sampleInput(0));
    expect(manifest?.frames.map((frame) => frame.timeMs).sort()).toEqual([1000, 1100]);
    expect(manifest?.lanes).toEqual({ ada: [{ clip: "wave", from: 0, to: 1000 }] });
    expect(manifest?.source).toBe("take:greet");
    expect((await again.get(frameKey(input), 160))?.frame.metrics).toEqual({ "feet.belowFloor": 0 });
    expect(await again.usage()).toBe(20);
  });
}

function limits(runner: SuiteRunner, make: (options: IndexStoreOptions) => Promise<StoreUnderTest>): void {
  const { test, expect } = runner;
  test("above the limit the oldest content hash goes first", async () => {
    const { store } = await make({ now: counter(), limitBytes: 300 });
    await store.put({
      input: sampleInput(0, { contentHash: HASH_A }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    await store.put({
      input: sampleInput(100, { contentHash: HASH_A }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(50),
    });
    await store.put({
      input: sampleInput(0, { contentHash: HASH_B }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    await store.put({
      input: sampleInput(0, { contentHash: HASH_C }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    expect((await store.contents()).map((use) => use.contentHash)).toEqual([HASH_C, HASH_B]);
    expect(await store.usage()).toBe(200);
    expect(await store.has(frameKey(sampleInput(0, { contentHash: HASH_A })))).toBe(false);
  });

  test("a read makes its content hash new, so another hash goes first", async () => {
    const { store } = await make({ now: counter(), limitBytes: 250 });
    await store.put({
      input: sampleInput(0, { contentHash: HASH_A }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    await store.put({
      input: sampleInput(0, { contentHash: HASH_B }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    await store.get(frameKey(sampleInput(0, { contentHash: HASH_A })));
    await store.put({
      input: sampleInput(0, { contentHash: HASH_C }),
      size: 160,
      mime: "image/webp",
      bytes: bytesOf(100),
    });
    expect((await store.contents()).map((use) => use.contentHash).sort()).toEqual([HASH_A, HASH_C]);
  });

  test("with one content hash above the limit the frames used longest ago go", async () => {
    const { store } = await make({ now: counter(), limitBytes: 200 });
    for (const time of [0, 100, 200]) {
      await store.put({ input: sampleInput(time), size: 160, mime: "image/webp", bytes: bytesOf(100) });
    }
    expect(await store.usage()).toBeLessThanOrEqual(200);
    expect(await store.has(frameKey(sampleInput(0)))).toBe(false);
    expect(await store.has(frameKey(sampleInput(200)))).toBe(true);
  });

  test("clear removes every frame, also after a restart", async () => {
    const made = await make({ now: counter() });
    await made.store.put({ input: sampleInput(0), size: 160, mime: "image/webp", bytes: bytesOf(10) });
    await made.store.flush();
    await made.store.clear();
    expect(await made.store.usage()).toBe(0);
    expect(await made.reopen().usage()).toBe(0);
  });
}

/** The tests of a store. `make` gives a new, empty store with the options of the test. */
export function indexStoreSuite(
  name: string,
  runner: SuiteRunner,
  make: (options: IndexStoreOptions) => Promise<StoreUnderTest>,
): void {
  runner.describe(`frame index store: ${name}`, () => {
    basics(runner, make);
    limits(runner, make);
  });
}
