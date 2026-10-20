// SPDX-License-Identifier: Apache-2.0
// The inspector edits as commands. `component.set`, `component.reset`, `component.add` and `component.remove` give the
// ops of the inspector and a title that names the component and the field. The target `scene` gives the scene values,
// and no target gives the selected entities. A bad argument gives a clear reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "bun:test";
import {
  COMPONENT_COMMANDS,
  createCommandRegistry,
  type CommandHost,
  type ComponentCommandState,
  type SceneEditOp,
} from "../src/index";

const registry = builtinRegistry();

function showroom(): SceneDocument {
  const text = readFileSync(join(import.meta.dir, "../../../samples/showroom/scenes/main.scene.json"), "utf8");
  const result = readDocument(text, "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

const commands = createCommandRegistry<ComponentCommandState, CommandHost, SceneEditOp>();
commands.register(COMPONENT_COMMANDS);

/** Run a command on a document. The result is the title and the document after its ops. */
function run(doc: SceneDocument, id: string, args: Record<string, unknown>, selected: readonly string[] = []) {
  const items = selected.map((item) => ({ kind: "entity", id: item }));
  const state: ComponentCommandState = { doc, registry, selection: items[0] ?? null, selected: items };
  const outcome = commands.prepare(id, args, state);
  if (outcome.kind !== "edit") throw new Error("not an edit");
  const applied = applyOps(
    doc,
    outcome.ops.map((op) => op.op),
    registry,
  );
  if (!applied.ok) throw new Error(applied.reason);
  return { title: outcome.title, doc: applied.doc };
}

const light = (doc: SceneDocument, id: string): Record<string, unknown> =>
  doc.entities[id]?.components.light as Record<string, unknown>;

describe("the inspector edits as commands", () => {
  it("sets a field of a component; the title names the component and the field", () => {
    const { title, doc } = run(showroom(), "component.set", {
      entity: "sun",
      component: "light",
      field: "intensity",
      value: "3.5",
    });
    expect(title).toBe("Light: intensity");
    expect(light(doc, "sun").intensity).toBe(3.5);
  });

  it("sets one part of a vector, and the whole value with no field", () => {
    const moved = run(showroom(), "component.set", {
      entity: "armchair",
      component: "transform",
      field: "position.1",
      value: "0.25",
    });
    const position = (moved.doc.entities.armchair?.components.transform as { position: number[] }).position;
    expect(position[1]).toBe(0.25);
    const whole = run(showroom(), "component.set", { entity: "sun", component: "light", value: '{"type":"point"}' });
    expect(whole.title).toBe("Light");
    expect(light(whole.doc, "sun")).toEqual({ type: "point" });
  });

  it("puts a field back to its default, and edits each selected entity with no target", () => {
    const { title, doc } = run(showroom(), "component.reset", { component: "light", field: "intensity" }, [
      "sun",
      "fill",
    ]);
    expect(title).toBe("Reset Light: intensity");
    expect(light(doc, "sun").intensity).toBeUndefined();
    expect(light(doc, "fill").intensity).toBeUndefined();
  });

  it("adds and removes a component", () => {
    const added = run(showroom(), "component.add", { entity: "floor", component: "light" });
    expect(added.title).toBe("Add Light");
    expect(added.doc.entities.floor?.components.light).toBeDefined();
    const removed = run(added.doc, "component.remove", { entity: "floor", component: "light" });
    expect(removed.title).toBe("Remove Light");
    expect(removed.doc.entities.floor?.components.light).toBeUndefined();
  });

  it("sets a scene value with the target `scene`", () => {
    const { doc } = run(showroom(), "component.set", {
      entity: "scene",
      component: "environment",
      field: "exposure",
      value: "0.7",
    });
    expect((doc as unknown as { environment: { exposure: number } }).environment.exposure).toBe(0.7);
  });

  it("gives a clear reason for a bad argument and for no change", () => {
    const doc = showroom();
    expect(() => run(doc, "component.set", { entity: "sun", component: "lamp", value: "1" })).toThrow(
      'No component "lamp"',
    );
    expect(() =>
      run(doc, "component.set", { entity: "sun", component: "light", field: "intensity", value: "x" }),
    ).toThrow("no JSON value");
    expect(() => run(doc, "component.set", { entity: "nobody", component: "light", value: "{}" })).toThrow(
      'No entity "nobody"',
    );
    expect(() =>
      run(doc, "component.set", { entity: "sun", component: "light", field: "intensity", value: "2.2" }),
    ).toThrow("The value is the same");
  });
});
