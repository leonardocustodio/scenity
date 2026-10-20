// SPDX-License-Identifier: Apache-2.0
// The en-US messages of the labels of the built-in components match the schemas.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPONENT_TEXTS, componentTexts } from "./component-texts";

test("components.ftl is the same as the labels of the schemas (bun tools/component-texts.ts writes it)", () => {
  expect(readFileSync(COMPONENT_TEXTS, "utf8")).toBe(componentTexts());
});
