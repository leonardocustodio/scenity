// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime plugin API: `defineRuntimePlugin` and the plugin host (the merged registries, the ID prefix checks, the
 * plugin input and the runner of the plugin systems). Also the light part `PluginSystems` and the core of a runner.
 */
import { describe, expect, test } from "bun:test";
import { Group } from "three";
import { builtinRegistry, defineComponent, readDocument, vec3Schema } from "@scenity/scene";
import { createEvaluator, defineSimulation } from "@scenity/scene/sequence";
import { defineRuntimePlugin, PluginHost, PluginHostError, PluginSystems, type RuntimePlugin } from "../src/plugins";
import type { Presenter } from "../src/scene/types";
import { defineSystem } from "../src/systems/index";

const panel = defineComponent({
  id: "doors.panel",
  schema: vec3Schema,
  defaults: [1, 2, 0.1],
  editor: { label: "Panel", fields: {} },
});

function presenter(id: string): Presenter {
  return { id, create: () => new Group(), update: () => true, dispose: () => undefined };
}

/** A plugin with a component, a presenter and a system with memory (a factory). */
function doors(overrides: Partial<Parameters<typeof defineRuntimePlugin<readonly number[]>>[0]> = {}) {
  return defineRuntimePlugin<readonly number[]>({
    id: "doors",
    components: [panel],
    presenters: { "doors.panel": presenter("doors.panel") },
    input: vec3Schema,
    systems: [
      () => {
        let opened = 0;
        return defineSystem<readonly number[], number>({
          id: "doors.swing",
          order: 5,
          reads: ["doors.panel", "transform"],
          update(ctx) {
            opened += ctx.input[0] ?? 0;
            ctx.out.setValue("door", "open", opened);
          },
          save: () => opened,
          restore: (memory) => {
            opened = memory;
          },
        });
      },
    ],
    ...overrides,
  });
}

const lamps = defineRuntimePlugin({ id: "lamps", components: [] });

function problemsOf(plugins: readonly RuntimePlugin[]): readonly string[] {
  try {
    new PluginHost(plugins);
  } catch (error) {
    if (error instanceof PluginHostError) return error.problems;
    throw error;
  }
  return [];
}

describe("PluginHost", () => {
  test("merges the components and the presenters over the built-in ones", () => {
    const host = new PluginHost([doors(), lamps]);
    expect(host.components.has("transform")).toBe(true);
    expect(host.components.has("doors.panel")).toBe(true);
    expect(host.components.fill("doors.panel", undefined)).toEqual([1, 2, 0.1]);
    expect(host.presenters.has("model")).toBe(true);
    expect(host.presenters.get("doors.panel")?.id).toBe("doors.panel");
  });

  test("an empty list gives the built-in registries and a runner with no system", () => {
    const host = new PluginHost([]);
    expect(host.components.list().map((item) => item.id)).toEqual(
      builtinRegistry()
        .list()
        .map((item) => item.id),
    );
    expect(host.createRunner().systems).toEqual([]);
  });

  test("refuses a plugin ID two times and a bad plugin ID", () => {
    expect(problemsOf([lamps, lamps])).toEqual(['the plugin "lamps" is in the list two times']);
    expect(problemsOf([{ ...lamps, id: "Bad.id" }])).toEqual(['"Bad.id" is not a plugin ID']);
    expect(() => defineRuntimePlugin({ id: "a.b" })).toThrow(/plugin ID/);
  });

  test("refuses a part ID with no plugin prefix", () => {
    const wrong = defineComponent({ id: "lamps.shade", schema: vec3Schema, editor: { label: "Shade", fields: {} } });
    const problems = problemsOf([
      doors({
        components: [panel, wrong],
        systems: [defineSystem({ id: "swing", order: 0, update: () => undefined })],
      }),
    ]);
    expect(problems).toEqual([
      'doors: the component ID "lamps.shade" does not start with "doors."',
      'doors: the system ID "swing" does not start with "doors."',
    ]);
  });

  test("refuses a presenter with no component, a key that is not its ID, and an unknown read", () => {
    const presenters = { "doors.frame": presenter("doors.frame"), "doors.panel": presenter("doors.other") };
    expect(problemsOf([doors({ presenters })])).toEqual([
      'doors: the presenter of "doors.panel" has the ID "doors.other"',
    ]);
    expect(problemsOf([doors({ presenters: { "doors.frame": presenter("doors.frame") } })])).toEqual([
      'doors: no component "doors.frame" for a presenter',
    ]);
    const reader = defineSystem({ id: "doors.read", order: 0, reads: ["doors.knob"], update: () => undefined });
    expect(problemsOf([doors({ systems: [reader] })])).toEqual([
      'the system "doors.read" reads the unknown component "doors.knob"',
    ]);
  });

  test("checks the plugin input with the schema of each plugin", () => {
    const host = new PluginHost([doors(), lamps]);
    expect(host.parseInput({ doors: [1, 0, 0], lamps: { on: true } })).toEqual({
      ok: true,
      input: { doors: [1, 0, 0], lamps: { on: true } },
    });
    const bad = host.parseInput({ doors: [1, "x", 0], fans: 1 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems.map((problem) => [problem.plugin, problem.path])).toEqual([
      ["fans", ""],
      ["doors", "/1"],
    ]);
  });

  test("each runner gets new systems of a factory, with the input of its plugin", () => {
    const host = new PluginHost([doors(), lamps]);
    const scene = readDocument(JSON.stringify({ format: "scenity.scene/1", id: "s", entities: {} }), "scene");
    if (!scene.ok) throw new Error(JSON.stringify(scene.errors));
    const sequence = { format: "scenity.sequence/1", id: "q", scene: "s", duration: 1000, tracks: [] };
    const read = readDocument(JSON.stringify(sequence), "sequence");
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    const evaluator = createEvaluator({ scene: scene.doc, sequence: read.doc, registry: host.components });
    const first = host.createRunner({ documentId: "s" });
    const second = host.createRunner({ documentId: "s" });
    const input = { doors: [2, 0, 0] };
    first.step({ frame: evaluator.at(0), input });
    const out = first.step({ frame: evaluator.at(10), input });
    expect(out.get("door")?.values.open).toBe(4);
    expect(first.save().systems).toEqual({ "doors.swing": 4 });
    expect(second.step({ frame: evaluator.at(0), input }).get("door")?.values.open).toBe(2);
  });
});

describe("the simulation face of a runtime plugin", () => {
  const counter = defineSimulation<number, { readonly count: number }>({
    id: "doors",
    stateSchema: {
      safeParse: (value) =>
        typeof value === "number"
          ? { success: true, data: value }
          : { success: false, error: { issues: [{ path: [], message: "not a number" }] } },
    },
    initial: () => 0,
    reduce: (state, key) => (key.action === "doors.open" ? state + 1 : state),
    settle: (state) => state,
    project: (state) => ({ count: state }),
  });

  test("the plugin host gives the simulations of the plugins in the order of the list", () => {
    const plugin = doors({ simulation: counter });
    expect(plugin.simulation).toBe(counter);
    expect(lamps.simulation).toBeUndefined();
    expect(new PluginHost([lamps, plugin]).simulations).toEqual([counter]);
  });

  test("refuses a simulation whose ID is not the plugin ID", () => {
    expect(problemsOf([defineRuntimePlugin({ id: "lamps", simulation: counter })])).toEqual([
      'lamps: the simulation has the ID "doors"',
    ]);
  });
});

describe("PluginSystems", () => {
  const empty = createEvaluator({
    scene: { format: "scenity.scene/1", id: "s", entities: {} },
    sequence: { format: "scenity.sequence/1", id: "q", scene: "s", duration: 1000, tracks: [] },
    registry: builtinRegistry(),
  });

  test("gives each system factory the core of the runner, and the plugin host checks with no core", () => {
    const cores: unknown[] = [];
    const steps: [unknown, number][] = [];
    const coarse = defineRuntimePlugin<string>({
      id: "room",
      systems: [
        (core) => {
          cores.push(core);
          return defineSystem<string>({
            id: "room.draw",
            order: 0,
            update(ctx) {
              steps.push([core, ctx.t]);
            },
          });
        },
      ],
    });
    expect(new PluginHost([coarse]).plugins).toEqual([coarse]);
    const target = { name: "core" };
    const runner = new PluginSystems([coarse]).createRunner({ core: target });
    expect(cores).toEqual([undefined, target]);
    runner.step({ frame: empty.at(0), input: { room: "x" }, t: 40 });
    expect(steps).toEqual([[target, 40]]);
  });

  test("makes the runner of the plugin systems with no check and no registry", () => {
    const light = new PluginSystems([doors(), lamps]);
    expect("components" in light).toBe(false);
    const runner = light.createRunner();
    expect(runner.systems.map((system) => system.id)).toEqual(["doors.swing"]);
    expect(runner.step({ frame: empty.at(0), input: { doors: [3, 0, 0] } }).get("door")?.values.open).toBe(3);
  });
});
