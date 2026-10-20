// SPDX-License-Identifier: Apache-2.0
// The text lint of the editor.
import { describe, expect, test } from "bun:test";
import { check, isProse, isSinkText, scanSource } from "./editor-texts";

const texts = (path: string, code: string): string[] => scanSource(path, code).texts.map((item) => item.text);

describe("isProse", () => {
  test("finds two words and one capital word", () => {
    expect(isProse("Click a point")).toBe(true);
    expect(isProse("not saved: a rule fails")).toBe(true);
    expect(isProse("Save")).toBe(true);
  });

  test("leaves out classes, IDs, paths and lower case single words", () => {
    expect(isProse("flex items-center gap-1")).toBe(false);
    expect(isProse("scene-bar")).toBe(false);
    expect(isProse("scenes/main.scene.json")).toBe(false);
    expect(isProse("saved")).toBe(false);
    expect(isProse("SE5-15")).toBe(false);
  });
});

describe("isSinkText", () => {
  test("finds a lower case word in a text sink, not an ID", () => {
    expect(isSinkText("saved")).toBe(true);
    expect(isSinkText("asset-tile")).toBe(false);
    expect(isSinkText("12 ms")).toBe(true);
    expect(isSinkText("42")).toBe(false);
  });
});

describe("scanSource", () => {
  test("finds the texts of a TypeScript file in sinks and prose", () => {
    const code = [
      'node.textContent = "saved";',
      'button.title = "Save the scene file";',
      'const label = { title: "Move" };',
      'node.setAttribute("aria-label", "Close the panel");',
      'node.append(" Grid");',
    ].join("\n");
    expect(texts("a.ts", code)).toEqual(["saved", "Save the scene file", "Move", "Close the panel", " Grid"]);
  });

  test("leaves out code strings", () => {
    const code = [
      'import { t } from "../texts";',
      'console.warn("The page has no tools.");',
      'throw new Error("A bad path was given.");',
      'if (event.key === "Escape") stop();',
      'node.dataset.testid = "scene-save";',
      'node.className = "Panel title";',
      'type Kind = "Open scene" | "Close";',
      'const text = t("scene-save");',
      'document.querySelector("Some selector text");',
    ].join("\n");
    expect(texts("a.ts", code)).toEqual([]);
  });

  test("finds the template texts and the text attributes of a Vue file", () => {
    const code = [
      "<template>",
      '  <div title="Hide the entity" :aria-label="open ? \'Close\' : \'Open\'" class="flex gap-1">',
      "    Assets {{ count }}",
      '    <span translate="no">armchair</span>',
      "    {{ $t(\"assets-title\") }} {{ busy ? 'busy' : name }}",
      "  </div>",
      "</template>",
      '<script setup lang="ts">',
      'const fallback = "Nothing to show";',
      "</script>",
    ].join("\n");
    expect(texts("a.vue", code).sort()).toEqual([
      "Assets",
      "Close",
      "Hide the entity",
      "Nothing to show",
      "Open",
      "busy",
    ]);
  });

  test("gives the literal message IDs", () => {
    const code = 'const a = t("scene-save");\nconst b = t(`scene-${kind}`);';
    expect(scanSource("a.ts", code).ids).toEqual([{ id: "scene-save", line: 1 }]);
  });
});

describe("the editor", () => {
  test("shows each text through Fluent, and each message ID has an en-US message", () => {
    const { problems } = check();
    expect(problems.map((problem) => `${problem.path}:${problem.message}`)).toEqual([]);
  });
});
