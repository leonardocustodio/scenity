// SPDX-License-Identifier: Apache-2.0
// The core panels use the API of the plugins. The components of the hierarchy, the inspector, the Project window, the
// Console, Problems, the Timeline and the agent panel get the services of the shell only from the public module
// `@scenity/editor/studio`. The test fails when one of them imports a part of the shell from another module. It also
// fails when one of them imports a hook that the API does not give.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as api from "../../src/studio/extensions/api";

const SCENE = join(import.meta.dirname, "..", "..", "src", "scene");
/** The folder of each core panel. */
const CORE_PANELS: Readonly<Record<string, string>> = {
  hierarchy: "hierarchy",
  inspector: "inspector",
  project: "projectWindow",
  console: "console",
  problems: "problems",
  timeline: "sequencer",
  agent: "agent",
};
const API = "../../studio/extensions/api";
/** The modules that give hooks to any component: Vue, the texts and the UI kit. */
const HOOK_MODULES = new Set(["vue", "@scenity/i18n", "@scenity/ui", API]);

/** The problems of the imports of one component of a core panel. */
function importProblems(source: string): string[] {
  const problems: string[] = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)";/gm)) {
    const [, onlyTypes, names = "", from = ""] = match;
    if (onlyTypes !== undefined) continue;
    if (from.includes("/studio/shell/")) problems.push(`a part of the shell from ${from}`);
    for (const hook of names.match(/\buse[A-Z]\w*/g) ?? []) {
      if (!HOOK_MODULES.has(from) && !from.startsWith("./")) problems.push(`the hook ${hook} from ${from}`);
      if (from === API && !(hook in api)) problems.push(`the hook ${hook} that the API does not give`);
    }
  }
  return problems;
}

describe("the core panels use the API of the plugins", () => {
  it("finds a part of the shell, a foreign hook and a hook that the API does not give", () => {
    expect(importProblems('import { usePanelState } from "../../studio/shell/panelState";')).toEqual([
      "a part of the shell from ../../studio/shell/panelState",
      "the hook usePanelState from ../../studio/shell/panelState",
    ]);
    expect(importProblems(`import { useMagic } from "${API}";`)).toEqual([
      "the hook useMagic that the API does not give",
    ]);
    expect(importProblems('import { useSequencer } from "./useSequencer";')).toEqual([]);
    expect(importProblems('import type { StudioShell } from "../../studio/shell/shell";')).toEqual([]);
  });

  it.each(Object.entries(CORE_PANELS))("the components of the panel %s import no part of the shell", (_panel, dir) => {
    const files = readdirSync(join(SCENE, dir)).filter((file) => file.endsWith(".vue"));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((file) =>
      importProblems(readFileSync(join(SCENE, dir, file), "utf8")).map((problem) => `${dir}/${file}: ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it("gives the hooks of the shell to the panels of the plugins too", () => {
    for (const hook of ["usePanelState", "usePanelVisible", "useAgentAsk", "EmptyState"])
      expect(hook in api).toBe(true);
  });
});
