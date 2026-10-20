// SPDX-License-Identifier: Apache-2.0
/**
 * The systems API: the run order, the random streams, the presenter outputs and the save and restore of the system
 * memory. The main test: a seek then play gives the frames of a play from 0.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, readDocument } from "@scenity/scene";
import { createEvaluator, type Evaluator } from "@scenity/scene/sequence";
import {
  defineSystem,
  RandomStream,
  SystemRunner,
  streamSeed,
  type RunnerMemory,
  type SystemDefinition,
} from "../src/systems/index";

const FIXTURES = join(import.meta.dir, "../../scene/tests/fixtures");

function fixture<K extends "scene" | "sequence">(name: string, kind: K) {
  const result = readDocument(readFileSync(join(FIXTURES, name), "utf8"), kind);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

function tourEvaluator(): Evaluator {
  const scene = fixture("main.scene.json", "scene");
  const sequence = fixture("tour.sequence.json", "sequence");
  return createEvaluator({ scene, sequence, registry: builtinRegistry() });
}

interface Memory {
  sum: number;
  steps: number;
  trail: number[];
}

/** A system with memory: an accumulator of `dt` with a random weight, and the camera field of view of the frame. */
function accumulator(): SystemDefinition<{ gain: number }, Memory> {
  let memory: Memory = { sum: 0, steps: 0, trail: [] };
  return defineSystem<{ gain: number }, Memory>({
    id: "test.accumulator",
    order: 10,
    reads: ["camera"],
    update(ctx) {
      const weight = ctx.random("weight").next();
      memory.sum += ctx.dt * weight * ctx.input.gain;
      memory.steps += 1;
      memory.trail = [...memory.trail.slice(-3), ctx.random("trail").int(0, 100)];
      const fov = (ctx.frame.scene.entities.front?.components.camera as { fov?: number } | undefined)?.fov ?? 0;
      ctx.out.setTransform("robot", { position: [memory.sum / 1000, fov, 0] });
      ctx.out.setVisible("robot", memory.steps % 3 !== 0);
      ctx.out.setValue("robot", "trail", memory.trail);
      ctx.out.setValue("robot", "steps", memory.steps);
    },
    save: () => structuredClone(memory),
    restore: (saved) => {
      memory = structuredClone(saved);
    },
  });
}

/** A system with no memory that runs after the accumulator and reads its output. */
const follower = defineSystem<{ gain: number }>({
  id: "test.follower",
  order: 20,
  update(ctx) {
    const position = ctx.out.get("robot")?.transform?.position;
    ctx.out.setValue("box", "x", position?.[0] ?? -1);
  },
});

/** The frame times: steps of 16 or 17 ms from 0 to 3 s. */
const TIMES = Array.from({ length: 181 }, (_, index) => Math.round(index * 16.67));

function runFrames(runner: SystemRunner<{ gain: number }>, evaluator: Evaluator, times: readonly number[]) {
  return times.map((t) => runner.step({ frame: evaluator.at(t), input: { gain: 2 } }).snapshot());
}

function newRunner() {
  return new SystemRunner([follower, accumulator()], { documentId: "main", seed: 7 });
}

describe("seek then play equals play from 0", () => {
  const evaluator = tourEvaluator();
  const reference = runFrames(newRunner(), evaluator, TIMES);
  const split = 90;
  const t1 = TIMES[split]!;

  test("the reference changes over time", () => {
    expect(reference[0]?.robot?.transform?.position?.[0]).toBe(0);
    expect(reference.at(-1)?.robot?.transform?.position?.[0]).toBeGreaterThan(0);
    expect(reference.at(-1)?.box?.values.x).toBe(reference.at(-1)?.robot?.transform?.position?.[0] ?? null);
  });

  test("a save in the middle of a play changes no frame", () => {
    const runner = newRunner();
    const first = runFrames(runner, evaluator, TIMES.slice(0, split + 1));
    const checkpoint = runner.save();
    expect(checkpoint.t).toBe(t1);
    const rest = runFrames(runner, evaluator, TIMES.slice(split + 1));
    expect([...first, ...rest]).toEqual(reference);
  });

  test("a restore of a checkpoint in a new runner continues the play", () => {
    const source = newRunner();
    runFrames(source, evaluator, TIMES.slice(0, split + 1));
    const checkpoint = JSON.parse(JSON.stringify(source.save())) as RunnerMemory;
    const runner = newRunner();
    runner.restore(checkpoint);
    expect(runFrames(runner, evaluator, TIMES.slice(split + 1))).toEqual(reference.slice(split + 1));
  });

  test("a seek back to a checkpoint after the end gives the same frames again", () => {
    const runner = newRunner();
    runFrames(runner, evaluator, TIMES.slice(0, split + 1));
    const checkpoint = runner.save();
    runFrames(runner, evaluator, TIMES.slice(split + 1));
    runner.restore(checkpoint);
    expect(runFrames(runner, evaluator, TIMES.slice(split + 1))).toEqual(reference.slice(split + 1));
    runner.reset();
    expect(runFrames(runner, evaluator, TIMES)).toEqual(reference);
  });

  test("the memory is plain JSON", () => {
    const runner = newRunner();
    runFrames(runner, evaluator, TIMES.slice(0, 10));
    const memory = runner.save();
    expect(JSON.parse(JSON.stringify(memory))).toEqual(memory);
    expect(Object.keys(memory.random)).toEqual(["test.accumulator/trail", "test.accumulator/weight"]);
  });
});

describe("SystemRunner", () => {
  const frame = tourEvaluator().at(0);

  test("runs the systems by order, then by ID", () => {
    const calls: string[] = [];
    const make = (id: string, order: number) => defineSystem({ id, order, update: () => calls.push(id) });
    const runner = new SystemRunner([make("b.two", 1), make("a.three", 2), make("a.one", 1)]);
    expect(runner.systems.map((system) => system.id)).toEqual(["a.one", "b.two", "a.three"]);
    runner.step({ frame, input: undefined });
    expect(calls).toEqual(["a.one", "b.two", "a.three"]);
  });

  test("gives dt from the last step, and refuses a step back in time", () => {
    const seen: number[] = [];
    const runner = new SystemRunner([defineSystem({ id: "a.dt", order: 0, update: (ctx) => seen.push(ctx.dt) })]);
    runner.step({ frame, input: null, t: 100 });
    runner.step({ frame, input: null, t: 150 });
    expect(seen).toEqual([0, 50]);
    expect(() => runner.step({ frame, input: null, t: 120 })).toThrow(/restore a checkpoint/);
  });

  test("refuses a system ID two times", () => {
    const system = defineSystem({ id: "a.one", order: 0, update: () => undefined });
    expect(() => new SystemRunner([system, system])).toThrow(/two times/);
  });

  test("starts each frame with empty outputs", () => {
    let first = true;
    const system = defineSystem({
      id: "a.once",
      order: 0,
      update: (ctx) => {
        if (first) ctx.out.setVisible("x", false);
        first = false;
      },
    });
    const runner = new SystemRunner([system]);
    expect(runner.step({ frame, input: null, t: 0 }).size).toBe(1);
    expect(runner.step({ frame, input: null, t: 1 }).size).toBe(0);
  });
});

describe("defineSystem", () => {
  test("checks the ID, the order and the memory functions", () => {
    expect(() => defineSystem({ id: "Bad ID", order: 0, update: () => undefined })).toThrow(/system ID/);
    expect(() => defineSystem({ id: "a.b", order: Number.NaN, update: () => undefined })).toThrow(/order/);
    expect(() => defineSystem({ id: "a.b", order: 0, update: () => undefined, save: () => 1 })).toThrow(/both/);
    expect(defineSystem({ id: "a.b", order: 0, update: () => undefined }).reads).toEqual([]);
  });
});

describe("random streams", () => {
  test("the same seed gives the same values; another document or name gives others", () => {
    const values = (seed: number) => {
      const stream = new RandomStream(seed);
      return Array.from({ length: 5 }, () => stream.next());
    };
    expect(values(streamSeed("main", "a/walk", 1))).toEqual(values(streamSeed("main", "a/walk", 1)));
    expect(values(streamSeed("main", "a/walk", 1))).not.toEqual(values(streamSeed("other", "a/walk", 1)));
    expect(values(streamSeed("main", "a/walk", 1))).not.toEqual(values(streamSeed("main", "a/run", 1)));
    for (const value of values(streamSeed("main", "a/walk", 2))) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("a stream state continues the stream", () => {
    const stream = new RandomStream(42);
    stream.next();
    const copy = new RandomStream(stream.state);
    expect(copy.next()).toBe(stream.next());
    expect(stream.int(3, 7)).toBeGreaterThanOrEqual(3);
    expect(stream.pick(["a"])).toBe("a");
  });
});
