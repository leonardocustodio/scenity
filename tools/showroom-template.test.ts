// SPDX-License-Identifier: Apache-2.0
// The showroom template of `scenity create`.
import { expect, test } from "bun:test";
import { readSources } from "../packages/cli/src/create/showroom";
import { SAMPLE_DIR, TEMPLATE_DIR, templateDifferences, templateFromSample } from "./showroom-template";

test("the showroom template of the CLI is current with samples/showroom (bun tools/showroom-template.ts)", () => {
  const { files, problems } = templateFromSample(SAMPLE_DIR, readSources(TEMPLATE_DIR));
  expect(problems).toEqual([]);
  expect(templateDifferences(files, TEMPLATE_DIR)).toEqual([]);
});

test("the template holds no build output and no source file; each source has a CC0 rights record", () => {
  const { files } = templateFromSample(SAMPLE_DIR, readSources(TEMPLATE_DIR));
  const paths = [...files.keys()];
  expect(paths.filter((path) => /^(build|dist|\.scenity)\//.test(path))).toEqual([]);
  expect(paths.filter((path) => path.startsWith("assets/") && !path.endsWith(".meta.json"))).toEqual([]);
  const sources = readSources(TEMPLATE_DIR);
  expect(paths).toContain(sources.rights);
  expect(new TextDecoder().decode(files.get(sources.rights))).toContain("spdx: CC0-1.0");
  expect(sources.files.length).toBeGreaterThan(0);
});
