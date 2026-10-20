// SPDX-License-Identifier: Apache-2.0
// The usage log of a usability study. It is off by default. When it is on, it keeps a line for each command in the
// browser storage. It keeps the last 2,000 lines, and it never sends anything.
import { DEFAULT_EDITOR_SETTINGS } from "@scenity/editor-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageKeys } from "../../src/scene/settings/pageKeys";
import { clearUsage, recordUsage, USAGE_MAX, usageFile, usageLines } from "../../src/scene/usage/usageLog";

afterEach(() => {
  clearUsage();
  pageKeys().ran = null;
  vi.unstubAllGlobals();
});

describe("the usage log", () => {
  it("is off by default and keeps nothing then", () => {
    expect(DEFAULT_EDITOR_SETTINGS.usage.log).toBe(false);
    recordUsage(DEFAULT_EDITOR_SETTINGS.usage.log, { at: 1, command: "file.save", how: "key" });
    expect(usageLines()).toEqual([]);
  });

  it("keeps a line for each run of a command when it is on, the last lines only, and sends nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    pageKeys().ran = (id, how) => recordUsage(true, { at: 5, command: id, how });
    const stop = pageKeys().register([{ id: "test.usage", title: "Test", run: () => undefined }]);
    await pageKeys().execute("test.usage", {});
    pageKeys().run("test.usage");
    stop();
    expect(usageLines()).toEqual([
      { at: 5, command: "test.usage", how: "call" },
      { at: 5, command: "test.usage", how: "menu" },
    ]);
    expect(usageFile().split("\n")).toHaveLength(2);
    for (let index = 0; index < USAGE_MAX + 5; index += 1) recordUsage(true, { at: index, command: "x", how: "call" });
    expect(usageLines()).toHaveLength(USAGE_MAX);
    expect(usageLines().at(-1)?.at).toBe(USAGE_MAX + 4);
    expect(fetch).not.toHaveBeenCalled();
  });
});
