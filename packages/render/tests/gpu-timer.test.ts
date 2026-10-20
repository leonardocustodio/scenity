// SPDX-License-Identifier: Apache-2.0
// The GPU timer of the 3D scene on a fake WebGL 2 context. The timer opens one query per frame. It gives the results
// in frame order when the GPU has them, and no result after a disjoint event. It gives no timer without the extension.
import { describe, expect, it } from "bun:test";
import { GpuTimer, type TimerContext } from "../src/gpuTimer";

const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;

interface FakeQuery {
  readonly id: number;
  available: boolean;
  nanoseconds: number;
}

/** A context that records the calls and gives the results that the test sets. */
function fakeContext(options: { readonly extension?: boolean } = {}) {
  const queries: FakeQuery[] = [];
  const deleted: number[] = [];
  const state = { disjoint: false, active: null as FakeQuery | null };
  const gl: TimerContext = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    getExtension: (name) =>
      options.extension === false || name !== "EXT_disjoint_timer_query_webgl2"
        ? null
        : { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: GPU_DISJOINT },
    getParameter: (name) => {
      if (name !== GPU_DISJOINT) return null;
      const value = state.disjoint;
      state.disjoint = false;
      return value;
    },
    createQuery: () => {
      const query: FakeQuery = { id: queries.length, available: false, nanoseconds: 0 };
      queries.push(query);
      return query;
    },
    deleteQuery: (query) => {
      if (query !== null) deleted.push((query as unknown as FakeQuery).id);
    },
    beginQuery: (target, query) => {
      expect(target).toBe(TIME_ELAPSED);
      expect(state.active).toBeNull();
      state.active = query as unknown as FakeQuery;
    },
    endQuery: (target) => {
      expect(target).toBe(TIME_ELAPSED);
      state.active = null;
    },
    getQueryParameter: (query, name) => {
      const fake = query as unknown as FakeQuery;
      return name === 0x8867 ? fake.available : fake.nanoseconds;
    },
  };
  return { gl, queries, deleted, state };
}

/** Measure `count` frames. */
function frames(timer: GpuTimer, count: number): void {
  for (let index = 0; index < count; index += 1) {
    timer.begin();
    timer.end();
  }
}

describe("GpuTimer", () => {
  it("gives no timer without the extension", () => {
    expect(GpuTimer.create(fakeContext({ extension: false }).gl)).toBeNull();
  });

  it("reads the results in frame order when the GPU has them", () => {
    const fake = fakeContext();
    const timer = GpuTimer.create(fake.gl);
    expect(timer).not.toBeNull();
    if (timer === null) return;
    frames(timer, 3);
    const samples: number[] = [];
    timer.poll((ms) => samples.push(ms));
    expect(samples).toEqual([]);
    // The second result is in, the first is not: the timer keeps the order and waits.
    const [first, second, third] = fake.queries;
    if (first === undefined || second === undefined || third === undefined) throw new Error("three queries");
    second.available = true;
    second.nanoseconds = 2_000_000;
    timer.poll((ms) => samples.push(ms));
    expect(samples).toEqual([]);
    first.available = true;
    first.nanoseconds = 1_500_000;
    third.available = true;
    third.nanoseconds = 500_000;
    timer.poll((ms) => samples.push(ms));
    expect(samples).toEqual([1.5, 2, 0.5]);
    expect(fake.deleted).toEqual([0, 1, 2]);
  });

  it("drops the open results after a disjoint event", () => {
    const fake = fakeContext();
    const timer = GpuTimer.create(fake.gl);
    if (timer === null) throw new Error("a timer");
    frames(timer, 2);
    for (const query of fake.queries) {
      query.available = true;
      query.nanoseconds = 1_000_000;
    }
    fake.state.disjoint = true;
    const samples: number[] = [];
    timer.poll((ms) => samples.push(ms));
    expect(samples).toEqual([]);
    expect(fake.deleted).toEqual([0, 1]);
  });

  it("opens no new query while the GPU is eight frames behind", () => {
    const fake = fakeContext();
    const timer = GpuTimer.create(fake.gl);
    if (timer === null) throw new Error("a timer");
    frames(timer, 12);
    expect(fake.queries).toHaveLength(8);
  });
});
