// SPDX-License-Identifier: Apache-2.0
// The recorded state stream and the external sources: the reader and the writer of `*.stream.jsonl`, the
// JSON Schema of a line, the recorded source (seek equals play, step and linear fields), the live source and the
// evaluator with a source in place of a simulation plugin.
import { describe, expect, test } from "bun:test";
import {
  createEvaluator,
  liveSource,
  parseStream,
  readStream,
  recordedSource,
  streamJsonSchema,
  streamSequence,
  writeStream,
  type StreamDocument,
} from "../src/index";
import { deepFreeze, registry, seeded } from "./helpers";
import { validate } from "./jsonSchemaSubset";
import { testScene } from "./sequenceKit";

const STREAM: StreamDocument = deepFreeze({
  format: "scenity.stream/1",
  id: "walk",
  plugin: "doors",
  duration: 4000,
  fields: { x: "linear", path: "linear" },
  markers: { open: 1500 },
  meta: { source: "a test" },
  samples: [
    { t: 0, set: { x: 0, door: "shut" } },
    { t: 1000, set: { x: 10, path: [0, 0] } },
    { t: 1000, set: { door: "open" } },
    { t: 3000, set: { x: 30, path: [2, 4], door: { by: "robot" } } },
  ],
});

/** A random stream of `count` samples: step fields of any JSON value and one linear field. */
function randomStream(random: () => number, count: number, duration: number): StreamDocument {
  const times = Array.from({ length: count }, () => Math.floor(random() * duration)).sort((a, b) => a - b);
  const names = ["a", "b", "c", "d"];
  const samples = times.map((t) => {
    const set: Record<string, string | number | number[]> = {};
    for (const name of names) if (random() < 0.4) set[name] = random() < 0.5 ? `v${String(t)}` : [t, -t];
    if (random() < 0.3) set.speed = Math.round(random() * 100);
    return { t, set };
  });
  return { format: "scenity.stream/1", id: "random", plugin: "doors", duration, fields: { speed: "linear" }, samples };
}

describe("the stream file", () => {
  test("write gives one line for the header and one for each sample; read then write gives the same bytes", () => {
    const text = writeStream(STREAM);
    expect(text.split("\n")).toHaveLength(STREAM.samples.length + 2);
    expect(text.split("\n")[0]).toStartWith('{"duration":4000,"fields":');
    expect(writeStream(parseStream(text))).toBe(text);
  });

  test("the JSON Schema of a line accepts each line and refuses a bad sample", () => {
    const schema = streamJsonSchema();
    for (const line of writeStream(STREAM).trim().split("\n")) expect(validate(schema, JSON.parse(line))).toEqual([]);
    expect(validate(schema, { t: -1, set: {} }).length).toBeGreaterThan(0);
    expect(validate(schema, { t: 1, set: {}, extra: 1 }).length).toBeGreaterThan(0);
  });

  test("the reader refuses a missing header, a sample out of order and a sample after the duration", () => {
    expect(readStream('{"t":0,"set":{}}\n')).toMatchObject({ ok: false, errors: [{ path: "/0/format" }] });
    const lines = writeStream(STREAM).trim().split("\n");
    const swapped = [lines[0], lines[4], lines[1]].join("\n");
    expect(readStream(swapped)).toMatchObject({ ok: false, errors: [{ path: "/2/t" }] });
    const late = writeStream({ ...STREAM, samples: [{ t: 5000, set: {} }] });
    expect(readStream(late)).toMatchObject({ ok: false, errors: [{ path: "/1/t" }] });
    expect(readStream(`${lines[0] ?? ""}\nnot json`)).toMatchObject({ ok: false, errors: [{ path: "/1" }] });
  });
});

describe("the recorded source", () => {
  test("a step field holds the last value; a field is absent before its first sample", () => {
    const source = recordedSource(STREAM);
    expect(source.stateAt(0)).toEqual({ x: 0, door: "shut" });
    expect(source.stateAt(999).door).toBe("shut");
    expect(source.stateAt(1000).door).toBe("open");
    expect(source.stateAt(2999).door).toBe("open");
    expect(source.stateAt(3000).door).toEqual({ by: "robot" });
    expect(source.stateAt(-5)).toEqual({});
    expect(source.sampleAt(1000)).toBe(2);
  });

  test("a linear field interpolates numbers and number arrays and holds its last value after its last sample", () => {
    const source = recordedSource(STREAM);
    expect(source.stateAt(500).x).toBe(5);
    expect(source.stateAt(2000)).toMatchObject({ x: 20, path: [1, 2] });
    expect(source.stateAt(2500.5).x).toBeCloseTo(25.005, 9);
    expect(source.stateAt(4000)).toMatchObject({ x: 30, path: [2, 4] });
    expect(source.stateAt(999).path).toBeUndefined();
  });

  test("seek equals play at 1,000 random times; a step-only stream shares the state of one sample", () => {
    const random = seeded(605);
    const stream = deepFreeze(randomStream(random, 400, 60000));
    const times = Array.from({ length: 1000 }, () => Math.floor(random() * 60001));
    const play = recordedSource(stream);
    const played = new Map([...times].sort((a, b) => a - b).map((t) => [t, play.stateAt(t)]));
    const seek = recordedSource(stream);
    for (const t of times) expect(seek.stateAt(t)).toEqual(played.get(t)!);
    for (const t of times) expect(recordedSource(stream).stateAt(t)).toEqual(played.get(t)!);
    const steps = recordedSource({ ...stream, fields: {} });
    const t = stream.samples[10]?.t ?? 0;
    expect(steps.stateAt(t)).toBe(steps.stateAt(t));
  });

  test("inputAt gives the project output; the source ID is the plugin of the stream", () => {
    const source = recordedSource(STREAM, { project: (state, t) => ({ door: state.door, t }) });
    expect(source.id).toBe("doors");
    expect(source.duration).toBe(4000);
    expect(source.inputAt(1200)).toEqual({ door: "open", t: 1200 });
    expect(recordedSource(STREAM).inputAt(0)).toEqual({ x: 0, door: "shut" });
  });
});

describe("the live source", () => {
  test("the last state at or before a time in the buffer; nothing before the first push", () => {
    const source = liveSource<{ n: number }>({ id: "doors", bufferMs: 1000 });
    expect(source.stateAt(0)).toBeUndefined();
    expect(source.inputAt(0)).toBeUndefined();
    const seen: number[] = [];
    const stop = source.subscribe((t) => seen.push(t));
    source.push(100, { n: 1 });
    source.push(600.5, { n: 2 });
    source.push(2000, { n: 3 });
    expect(source.latest()).toEqual({ t: 2000, state: { n: 3 } });
    expect(source.stateAt(1500)).toEqual({ n: 2 });
    // The buffer starts at 1000: the state at 100 is not in it.
    expect(source.stateAt(300)).toBeUndefined();
    stop();
    source.push(2000, { n: 4 });
    expect(seen).toEqual([100, 600.5, 2000]);
    expect(() => source.push(1999, { n: 5 })).toThrow(RangeError);
    expect(source.duration).toBeUndefined();
  });

  test("with no buffer it keeps the last state only", () => {
    const source = liveSource<number, string>({ id: "doors", project: (state) => `n${String(state)}` });
    source.push(1, 1);
    source.push(2, 2);
    expect(source.stateAt(1.5)).toBeUndefined();
    expect(source.inputAt(10)).toBe("n2");
  });
});

describe("the evaluator with a source", () => {
  const scene = deepFreeze(testScene(2));

  test("a recorded stream plays like a sequence: the frame keeps its state and input under the plugin ID", () => {
    const source = recordedSource(STREAM, { project: (state) => state.door ?? null });
    const sequence = streamSequence(STREAM, scene.id);
    expect(sequence).toMatchObject({ duration: 4000, markers: { open: 1500 }, tracks: [] });
    const evaluator = createEvaluator({ scene, sequence, registry, sources: [source] });
    expect(evaluator.warnings).toEqual([]);
    expect(evaluator.at(2000).simulations.doors).toEqual(source.stateAt(2000));
    expect(evaluator.at(2000).projections.doors).toBe("open");
    expect(evaluator.at(9000).t).toBe(4000);
    expect(evaluator.simulationsAt(500)).toEqual({ doors: { x: 5, door: "shut" } });
  });

  test("a source and a plugin with the same ID are an error", () => {
    const sequence = streamSequence(STREAM, scene.id);
    const plugin = { id: "doors", initial: () => 0, reduce: (s: number) => s, settle: (s: number) => s };
    expect(() =>
      createEvaluator({ scene, sequence, registry, simulations: [plugin], sources: [recordedSource(STREAM)] }),
    ).toThrow(/doors/);
  });
});
