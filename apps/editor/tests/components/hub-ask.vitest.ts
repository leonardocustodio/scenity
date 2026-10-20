// SPDX-License-Identifier: Apache-2.0
// The Hub prompt box. 10 test questions each get a section of the docs in the first three answers. Each link resolves:
// its file is a doc, and its anchor is the GitHub anchor of a heading of that file. A question of a tutorial also gets
// the tutorial.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOC_FILES,
  DOCS_URL,
  docSections,
  docsIndex,
  excerptOf,
  headingAnchor,
  searchDocs,
  searchTutorials,
} from "../../src/hub/docsSearch";
import { TUTORIALS } from "../../src/scene/tutorials/tutorials";
import { messageIdOf, t } from "../../src/texts";

const DOCS = join(import.meta.dirname, "..", "..", "..", "..", "docs");
const files = Object.fromEntries(DOC_FILES.map((file) => [file, readFileSync(join(DOCS, file), "utf8")]));
const index = docsIndex(files);

/** The question and a section that must be in the first three answers. */
const QUESTIONS: readonly (readonly [string, string])[] = [
  ["How do I add a light to my scene?", "editor.md#lighting"],
  ["How do I make a prefab?", "editor.md#prefabs"],
  ["How do I animate an entity with a sequence?", "editor.md#the-sequencer"],
  ["How do I publish my project?", "cli.md#scenity-publish"],
  ["How do I write a plugin?", "plugins.md#a-plugin-from-zero"],
  ["How do I import a model?", "quickstart.md#4-add-a-model"],
  ["How do I connect Claude Code as an external agent?", "studio.md#agents"],
  ["What is the format of a scene file?", "formats.md#the-scene"],
  ["How do I change a keyboard shortcut?", "editor.md#shortcuts-panel"],
  ["What is restricted mode?", "studio.md#trust-and-restricted-mode"],
];

describe("the Hub prompt box", () => {
  it("gives the anchors of GitHub", () => {
    expect(headingAnchor("`scenity publish`")).toBe("scenity-publish");
    expect(headingAnchor("10. Record the rights and publish")).toBe("10-record-the-rights-and-publish");
    expect(headingAnchor("The dev face: debug layers and metrics")).toBe("the-dev-face-debug-layers-and-metrics");
    expect(headingAnchor("Jobs, version control and plugins")).toBe("jobs-version-control-and-plugins");
    const twice = docSections("a.md", "# A\n\n## Use it\n\ntext\n\n```md\n## Code\n```\n\n## Use it\n\nmore");
    expect(twice.map((section) => section.anchor)).toEqual(["a", "use-it", "use-it-1"]);
    expect(twice[1]?.text).toContain("## Code");
    expect(excerptOf("A [link](x.md) and `code`.\n\n```sh\nrun\n```")).toBe("A link and code.");
  });

  it.each(QUESTIONS)("answers %s with a link that resolves", (question, expected) => {
    const answers = searchDocs(index, question);
    expect(answers.map((answer) => `${answer.section.file}#${answer.section.anchor}`)).toContain(expected);
    for (const answer of answers) {
      const [file, anchor] = answer.url.slice(DOCS_URL.length).split("#");
      expect(DOC_FILES).toContain(file);
      const anchors = docSections(file ?? "", files[file ?? ""] ?? "").map((section) => section.anchor);
      expect(anchors).toContain(anchor);
      expect(answer.excerpt.length).toBeGreaterThan(0);
    }
  });

  it("answers a question of a tutorial with the tutorial", () => {
    const tutorials = TUTORIALS.map((tutorial) => ({
      id: tutorial.id,
      title: t(`${messageIdOf("tutorial", tutorial.id)}-title`),
      steps: tutorial.steps.map((step) => t(`${messageIdOf("tutorial", tutorial.id)}-${step.id}`)),
    }));
    expect(searchTutorials(index, "How do I make a prefab?", tutorials)).toEqual(["prefab"]);
    expect(searchTutorials(index, "How do I animate an entity with a sequence?", tutorials)).toEqual(["sequence"]);
    expect(searchTutorials(index, "How do I add a light to my scene?", tutorials)).toEqual(["firstScene"]);
    expect(searchTutorials(index, "What is restricted mode?", tutorials)).toEqual([]);
  });
});
