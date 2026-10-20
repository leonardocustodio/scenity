// SPDX-License-Identifier: Apache-2.0
// The default sequence of the forms of the dock comes from the project, not from the page. It is the default of a
// host plugin, else the first sequence file of the project document, else none.
import { describe, expect, test } from "bun:test";
import type { HostPlugin } from "../src/plugin";
import { defaultProject, defaultSequence, projectInfo } from "../src/project";

const plugin = (given?: string): HostPlugin =>
  ({ id: "demo", ...(given === undefined ? {} : { defaultSequence: given }) }) as unknown as HostPlugin;

describe("the default sequence of a project", () => {
  test("the default of the first plugin that gives one wins over the sequences of the document", () => {
    expect(defaultSequence([plugin(), plugin("walk")], ["sequences/intro.sequence.json"])).toBe("walk");
  });

  test("a project with no plugin default takes its first sequence file, and a project with none has none", () => {
    expect(defaultSequence([plugin()], ["../seq/intro.sequence.json", "../seq/outro.sequence.json"])).toBe("intro");
    expect(defaultSequence([], [])).toBeNull();
    expect(defaultSequence([], undefined)).toBeNull();
  });

  test("host.hello gives the default of the built-in plugins of this checkout", () => {
    const project = defaultProject(process.cwd());
    expect(projectInfo(project).defaultSequence).toBe(project.defaultSequence ?? null);
    expect(project.defaultSequence).not.toBeUndefined();
  });
});
