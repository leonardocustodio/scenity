// SPDX-License-Identifier: Apache-2.0
// The docs page of the built-in components.
import { describe, expect, test } from "bun:test";
import { builtinRegistry } from "../packages/scene/src/index";
import { componentAnchor, componentDocs, componentDocsCurrent } from "./component-docs";

describe("the docs of the built-in components", () => {
  test("the page is current: bun tools/component-docs.ts writes it", () => {
    expect(componentDocsCurrent()).toBe(true);
  });

  test("each built-in component has a section with its anchor", () => {
    const text = componentDocs();
    for (const definition of builtinRegistry().list()) {
      expect(text).toContain(`\n## ${definition.id}\n`);
      expect(componentAnchor(definition.id)).toMatch(/^[a-z0-9-]+$/);
    }
    expect(text).toContain("| `position` |");
  });
});
