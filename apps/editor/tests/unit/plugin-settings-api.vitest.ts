// SPDX-License-Identifier: Apache-2.0
// The project settings of the plugins: `.scenity/plugin-settings.json` of a project keeps the values of each plugin. A
// write changes the values of one plugin and refuses a bad plugin ID or bad values.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_SETTINGS_FILE, readPluginSettings, writePluginSettings } from "../../scripts/pluginSettingsApi";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the project settings of the plugins", () => {
  it("writes the values of each plugin into the file of the project", () => {
    const dir = mkdtempSync(join(tmpdir(), "scenity-plugin-settings-"));
    dirs.push(dir);
    expect(readPluginSettings(dir)).toEqual({});
    expect(writePluginSettings(dir, "demo", { fast: 10 })).toBeNull();
    expect(writePluginSettings(dir, "traffic", { speed: 5 })).toBeNull();
    expect(readPluginSettings(dir)).toEqual({ demo: { fast: 10 }, traffic: { speed: 5 } });
    expect(JSON.parse(readFileSync(join(dir, PLUGIN_SETTINGS_FILE), "utf8"))).toHaveProperty("demo.fast", 10);
    expect(writePluginSettings(dir, "Bad ID", {})).toContain("plugin ID");
    expect(writePluginSettings(dir, "demo", [1])).toContain("object");
  });
});
