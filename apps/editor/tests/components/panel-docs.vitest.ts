// SPDX-License-Identifier: Apache-2.0
// Help in context: each panel of the editor window and each built-in component has a docs link, and each link names a
// heading of its page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry } from "@scenity/scene";
import { describe, expect, it } from "vitest";
import { componentAnchor, componentDocsUrl, PANEL_DOCS, panelDocsUrl } from "../../src/scene/panelDocs";
import { CORE_PANELS } from "../../src/studio/shell/panels";

const DOCS = join(__dirname, "../../../../docs");

/** The GitHub anchors of the headings of a Markdown page. */
function anchors(file: string): Set<string> {
  const headings = readFileSync(join(DOCS, file), "utf8")
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.replace(/^#+ /, ""));
  return new Set(
    headings.map((text) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/ /g, "-"),
    ),
  );
}

describe("help in context", () => {
  it("gives each panel a section of the editor docs", () => {
    const editor = anchors("editor.md");
    for (const panel of CORE_PANELS) {
      const anchor = PANEL_DOCS[panel.id];
      expect(anchor, panel.id).toBeDefined();
      expect(editor.has(anchor ?? ""), `${panel.id}: #${anchor ?? ""}`).toBe(true);
      expect(panelDocsUrl(panel.id)).toMatch(new RegExp(`editor\\.md#${anchor ?? ""}$`));
    }
  });

  it("gives each built-in component a section of the components page", () => {
    const components = anchors("components.md");
    for (const definition of builtinRegistry().list()) {
      expect(components.has(componentAnchor(definition.id)), definition.id).toBe(true);
      expect(componentDocsUrl(definition.id)).toContain(`components.md#${componentAnchor(definition.id)}`);
    }
  });
});
