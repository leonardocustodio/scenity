// SPDX-License-Identifier: Apache-2.0
// The Plugins window: the plugins of a project with their faces, and the error of an entry that does not resolve. Also
// the plugins of the checkout that the project does not list, and add and remove.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changePlugins, checkoutPlugins, pluginRows, pluginsAnswer } from "../../scripts/pluginsApi";

let dir = "";
const projectFile = () => JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { plugins: string[] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scenity-plugins-"));
  writeFileSync(
    join(dir, "scenity.project.json"),
    canonicalJson({ format: "scenity.project/1", id: "demo", name: "Demo", scenes: [], plugins: ["./missing"] }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the Plugins window", () => {
  it("lists the plugins with their faces, the error of a missing one, and the plugins of the checkout", () => {
    const [missing] = pluginRows(dir, ["./missing"]);
    expect(missing?.error).not.toBeNull();
    const available = checkoutPlugins(dir);
    const physics = available.find((item) => item.name === "@scenity/physics-runtime");
    expect(physics?.entry).toMatch(/plugins\/physics\/runtime$/);
    const answer = pluginsAnswer(dir) as { plugins: { entry: string }[]; available: { name: string }[] };
    expect(answer.plugins.map((row) => row.entry)).toEqual(["./missing"]);
    expect(answer.available.map((item) => item.name)).toContain("@scenity/physics-runtime");
  });

  it("adds the physics plugin of the checkout, refuses a second add and a bad entry, and removes it", () => {
    const physics = checkoutPlugins(dir).find((item) => item.name === "@scenity/physics-runtime");
    if (physics === undefined) throw new Error("no physics plugin in the checkout");
    expect(changePlugins(dir, "add", physics.entry)).toBeNull();
    expect(projectFile().plugins).toEqual(["./missing", physics.entry]);
    expect(readFileSync(join(dir, "scenity.project.json"), "utf8")).toBe(canonicalJson(projectFile()));
    const row = pluginRows(dir, [physics.entry])[0];
    expect(row).toMatchObject({ name: "@scenity/physics-runtime", error: null, faces: ["runtime"] });
    expect(changePlugins(dir, "add", physics.entry)).toContain("already");
    expect(changePlugins(dir, "add", "./nowhere")).not.toBeNull();
    expect(changePlugins(dir, "add", "")).toContain("package name");
    // The available list does not show the plugins of the project.
    const after = pluginsAnswer(dir) as { available: { name: string }[] };
    expect(after.available.map((item) => item.name)).not.toContain("@scenity/physics-runtime");
    expect(changePlugins(dir, "remove", physics.entry)).toBeNull();
    expect(projectFile().plugins).toEqual(["./missing"]);
    expect(changePlugins(dir, "remove", physics.entry)).toContain("no such plugin");
  });
});
