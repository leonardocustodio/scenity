// SPDX-License-Identifier: Apache-2.0 The editor settings: the defaults, the project file and the user document with
// their scopes, the change of one value, the documents of the user in the storage and the page layout of a project.
import { describe, expect, it } from "bun:test";
import { writeDocument } from "@scenity/scene";
import { readEditorDocument } from "@scenity/scene/schema/editor";
import {
  DEFAULT_EDITOR_SETTINGS,
  emptySettings,
  pageLayoutKey,
  readPageLayout,
  readUserKeymap,
  readUserSettings,
  resolveSettings,
  settingProblem,
  settingSource,
  SETTING_FIELDS,
  withKeys,
  emptyKeymap,
  withSetting,
  writePageLayout,
  writeUserKeymap,
  writeUserSettings,
} from "../src/index";

/** A storage in the memory, as the browser storage. */
function memoryStorage(): Storage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
}

describe("the editor settings", () => {
  it("gives the defaults with no document", () => {
    expect(resolveSettings(null, null)).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(DEFAULT_EDITOR_SETTINGS.snaps).toEqual({ grid: 0.01, angleDegrees: 15, scale: 0.1 });
  });

  it("lets the project file win for the snaps and the user win for the personal settings", () => {
    const project = withSetting(withSetting(emptySettings(), "snaps.grid", 0.05), "view.mode", "unlit");
    const user = withSetting(withSetting(emptySettings(), "snaps.grid", 0.25), "view.mode", "wireframe");
    const settings = resolveSettings(project, user);
    expect(settings.snaps.grid).toBe(0.05);
    expect(settings.view.mode).toBe("wireframe");
    expect(settingSource("snaps.grid", project, user)).toBe("project");
    expect(settingSource("view.mode", project, user)).toBe("user");
    // A value that only the other document gives still counts.
    expect(resolveSettings(null, user).snaps.grid).toBe(0.25);
    expect(resolveSettings(project, null).view.mode).toBe("unlit");
    expect(settingSource("camera.flySpeed", project, user)).toBe("default");
  });

  it("keeps only the changes in a document, and the file reads and writes to the same bytes", () => {
    const doc = withSetting(emptySettings(), "snaps.grid", 0.05);
    expect(doc).toEqual({ format: "scenity.editor/1", snaps: { grid: 0.05 } });
    expect(withSetting(doc, "snaps.grid", undefined)).toEqual(emptySettings());
    const text = writeDocument(doc);
    const read = readEditorDocument(text, "editor");
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(writeDocument(read.doc)).toBe(text);
  });

  it("checks a value against the limits of its field, and each field has a scope", () => {
    expect(settingProblem("snaps.grid", 0.05)).toBeNull();
    expect(settingProblem("snaps.grid", -1)).toContain("from");
    expect(settingProblem("recent.count", 2.5)).toContain("whole");
    expect(settingProblem("view.mode", "toon")).toContain("one of");
    expect(settingProblem("dock.tab", "Bad Tab")).toContain("an ID");
    expect(settingProblem("layout.workspace", "animate")).toBeNull();
    expect(settingProblem("autosave.seconds", 2)).toContain("from");
    expect(SETTING_FIELDS.filter((field) => field.scope === "project").map((field) => field.path)).toEqual([
      "snaps.grid",
      "snaps.angleDegrees",
      "snaps.scale",
      "layout.workspace",
      "autosave.enabled",
      "autosave.seconds",
    ]);
  });

  it("refuses a settings file with an unknown field or a bad value", () => {
    const bad = { format: "scenity.editor/1", snaps: { grid: -1 }, extra: 1 };
    expect(readEditorDocument(JSON.stringify(bad), "editor").ok).toBe(false);
  });
});

describe("the documents of a user in the storage", () => {
  it("writes and reads the settings and the key map of the user, and a bad value gives null", () => {
    const storage = memoryStorage();
    expect(readUserSettings(storage)).toBeNull();
    writeUserSettings(storage, withSetting(emptySettings(), "camera.flySpeed", 3));
    expect(readUserSettings(storage)?.camera?.flySpeed).toBe(3);
    writeUserKeymap(storage, withKeys(emptyKeymap(), "view.frame", ["G"]));
    expect(readUserKeymap(storage)?.keys).toEqual({ "view.frame": ["G"] });
    storage.setItem("scenity.keymap.user", "{");
    expect(readUserKeymap(storage)).toBeNull();
    expect(readUserSettings(null)).toBeNull();
  });

  it("keeps the page layout per project and leaves out the fields of a bad type", () => {
    const storage = memoryStorage();
    writePageLayout(storage, "showroom", { dockTab: "sequence", dockHeight: 20, leftOpen: false });
    expect(readPageLayout(storage, "showroom")).toEqual({ dockTab: "sequence", dockHeight: 20, leftOpen: false });
    expect(readPageLayout(storage, "characters")).toEqual({});
    storage.setItem(pageLayoutKey("x"), JSON.stringify({ dockHeight: "tall", rightWidth: 300 }));
    expect(readPageLayout(storage, "x")).toEqual({ rightWidth: 300 });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPageLayout(throwing, "x")).toEqual({});
    expect(writePageLayout(throwing, "x", {})).toBe(false);
  });
});
