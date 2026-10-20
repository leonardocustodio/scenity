// SPDX-License-Identifier: Apache-2.0
/**
 * The module of the pictures of the content browser (scripts/labsStills.ts). The dev server gives the URL of each
 * picture in one module, with no module per picture. The build imports each picture with `?url`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildModule, devModule, labsStills, STILLS_MODULE } from "../../scripts/labsStills";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the module of the stills", () => {
  it("gives the path under the base and the modification time of each picture on the dev server", () => {
    const code = devModule(
      "/w/apps/editor/src/stills",
      ["a.webp", "b.webp"],
      { root: "/w/apps/editor", base: "/" },
      () => 12.4,
    );
    expect(code).toBe('export default {"a":"/src/stills/a.webp?t=12","b":"/src/stills/b.webp?t=12"};\n');
    expect(code).not.toContain("import");
  });

  it("serves a picture outside the root through /@fs/", () => {
    const code = devModule("/w/art/stills", ["a.webp"], { root: "/w/apps/editor", base: "/" }, () => 1);
    expect(code).toContain('"a":"/@fs/w/art/stills/a.webp?t=1"');
  });

  it("imports each picture with ?url in the build", () => {
    const code = buildModule("/w/stills", ["a.webp", "b.webp"]);
    expect(code).toContain('import p0 from "/w/stills/a.webp?url";');
    expect(code).toContain('import p1 from "/w/stills/b.webp?url";');
    expect(code).toContain('"b": p1,');
  });

  it("reads only the pictures of its folder", () => {
    const folder = mkdtempSync(join(tmpdir(), "labs-stills-"));
    folders.push(folder);
    writeFileSync(join(folder, "clip_x.webp"), "x");
    writeFileSync(join(folder, "index.json"), "{}");
    const plugin = labsStills(folder);
    const resolved = (plugin.resolveId as (id: string) => string | null)(STILLS_MODULE);
    expect(resolved).not.toBeNull();
    const code = (plugin.load as (id: string) => string | null)(resolved ?? "");
    expect(code).toMatch(/"clip_x":"[^"]*clip_x\.webp\?t=\d+"/);
    expect(code).not.toContain("index");
  });
});
