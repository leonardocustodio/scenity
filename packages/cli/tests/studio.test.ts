// SPDX-License-Identifier: Apache-2.0
// `scenity studio`: the entry of the studio host. The entry is the source in a checkout, the installed package, or
// the package at the version of the command through `bun x`. The folder arguments become absolute.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkoutRoot } from "../src/workspace";
import { STUDIO_HOST, studioArgs, studioCommand, studioEntry } from "../src/studio/command";

describe("scenity studio", () => {
  test("runs the studio host source of the checkout", () => {
    const checkout = checkoutRoot();
    expect(checkout).not.toBeNull();
    expect(studioEntry(checkout, () => "/installed/main.ts")).toBe(
      join(checkout ?? "", "packages", "studio-host", "src", "main.ts"),
    );
  });

  test("runs the installed package with no checkout, else the package at the version of the command", () => {
    expect(studioEntry(null, () => "/project/node_modules/@scenity/studio-host/src/main.ts")).toBe(
      "/project/node_modules/@scenity/studio-host/src/main.ts",
    );
    expect(studioEntry(null, () => null)).toBeNull();
    expect(studioCommand("/a/main.ts", "0.1.0")).toEqual([process.execPath, "/a/main.ts"]);
    expect(studioCommand(null, "0.1.0")).toEqual([process.execPath, "x", `${STUDIO_HOST}@0.1.0`]);
  });

  test("makes the project and root folders absolute", () => {
    expect(studioArgs(["--project", "demo", "--root=work", "--root", "/abs", "--no-open"], "/home/me")).toEqual([
      "--project",
      "/home/me/demo",
      "--root=/home/me/work",
      "--root",
      "/abs",
      "--no-open",
    ]);
  });
});
