// SPDX-License-Identifier: Apache-2.0
// The new plugin wizard: the files of a new folder plugin with the parts of the person. The code of the files runs: the
// runtime face gives its component and its system, and the dev face gives its metric.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pluginFiles, requestProblem, type PluginRequest } from "../../scripts/pluginScaffold";

// Under the node_modules of the editor, so the files find the engine packages.
const ROOT = join(__dirname, "../../node_modules/.cache/scenity-plugin-scaffold");
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const request: PluginRequest = {
  id: "bounce",
  component: "bob",
  fields: [
    { name: "height", kind: "number" },
    { name: "active", kind: "boolean" },
    { name: "label", kind: "text" },
  ],
  parts: ["system", "metric", "studio"],
};

describe("the files of a new plugin", () => {
  it("has the faces of the parts that the person picks", () => {
    expect(Object.keys(pluginFiles(request)).sort()).toEqual([
      "package.json",
      "src/Panel.vue",
      "src/component.ts",
      "src/dev.ts",
      "src/i18n/en-US/bounce.ftl",
      "src/runtime.ts",
      "src/studio.ts",
      "src/systems/bob.ts",
    ]);
    const pack = JSON.parse(pluginFiles(request)["package.json"] ?? "{}") as { scenity: Record<string, string> };
    expect(pack.scenity).toEqual({ runtime: "src/runtime.ts", dev: "src/dev.ts", studio: "src/studio.ts" });
    expect(Object.keys(pluginFiles({ ...request, parts: [] })).sort()).toEqual([
      "package.json",
      "src/component.ts",
      "src/runtime.ts",
    ]);
  });

  it("refuses an ID, a name or a field that is not a word", () => {
    expect(requestProblem(request)).toBeNull();
    expect(requestProblem({ ...request, id: "Bad id" })).toContain("plugin ID");
    expect(requestProblem({ ...request, component: "9x" })).toContain("component name");
    expect(
      requestProblem({
        ...request,
        fields: [
          { name: "a", kind: "number" },
          { name: "a", kind: "text" },
        ],
      }),
    ).toContain("same name");
  });

  it("gives code that runs: the component, its system and the metric", async () => {
    const folder = join(ROOT, request.id);
    for (const [path, text] of Object.entries(pluginFiles(request))) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), text);
    }
    const runtime = (await import(/* @vite-ignore */ join(folder, "src/runtime.ts"))) as {
      default: {
        id: string;
        components: { id: string; schema: { parse(value: unknown): unknown } }[];
        systems: (() => { id: string })[];
      };
    };
    expect(runtime.default.id).toBe("bounce");
    const [component] = runtime.default.components;
    expect(component?.id).toBe("bounce.bob");
    expect(component?.schema.parse({ height: 1, active: true, label: "a" })).toEqual({
      height: 1,
      active: true,
      label: "a",
    });
    expect(runtime.default.systems.map((make) => make().id)).toEqual(["bounce.bob"]);
    const dev = (await import(/* @vite-ignore */ join(folder, "src/dev.ts"))) as {
      default: { id: string; library: { id: string }[] };
    };
    expect(dev.default.library.map((metric) => metric.id)).toEqual(["bounce.bobCount"]);
  });

  it("gives a presenter and a simulation that run", async () => {
    const parts = { ...request, id: "hover", parts: ["presenter", "simulation"] as const };
    const files = pluginFiles({ ...parts, parts: [...parts.parts] });
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["src/presenter.ts", "src/sim/simulation.ts"]));
    const folder = join(ROOT, parts.id);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), text);
    }
    const runtime = (await import(/* @vite-ignore */ join(folder, "src/runtime.ts"))) as {
      default: {
        presenters: Record<string, { id: string; create(value: unknown): { geometry: { dispose(): void } } }>;
        simulation: {
          id: string;
          initial(): unknown;
          reduce(state: unknown, key: { action: string }): unknown;
          project(state: unknown): unknown;
        };
      };
    };
    const presenter = runtime.default.presenters["hover.bob"];
    expect(presenter?.id).toBe("hover.bob");
    expect(presenter?.create({})).toBeDefined();
    const { simulation } = runtime.default;
    expect(simulation.id).toBe("hover");
    const after = simulation.reduce(simulation.initial(), { action: "hover.step" });
    expect(simulation.project(after)).toEqual({ steps: 1 });
  });
});
