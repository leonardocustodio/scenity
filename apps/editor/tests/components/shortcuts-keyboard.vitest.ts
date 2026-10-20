// SPDX-License-Identifier: Apache-2.0
// The keyboard picture of the Shortcuts window: the keys, and the commands on a key for the modifiers and a context.
// Also the import and the export of the key map.
import { KEY_CHORD } from "@scenity/scene/schema/editor";
import { describe, expect, it } from "vitest";
import {
  chordOf,
  contextsOf,
  KEYBOARD,
  keyBindings,
  keymapFile,
  partsOf,
  readKeymapFile,
} from "../../src/scene/shortcuts/keyboard";

const commands = [
  { id: "file.save", title: "Save", context: "global", keys: ["Mod+S"] },
  { id: "gizmo.scale", title: "Scale", context: "scene", keys: ["R", "Shift+R"] },
  { id: "timeline.rec", title: "Record", context: "timeline", keys: ["R"] },
];
const none = { mod: false, alt: false, shift: false };

describe("the keyboard picture", () => {
  it("has each key as a key of a chord, once", () => {
    const keys = KEYBOARD.flat()
      .map((cap) => cap.key)
      .filter((key) => key !== "");
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(KEY_CHORD.test(key), key).toBe(true);
    expect(keys).toEqual(expect.arrayContaining(["A", "Z", "0", "F12", "Space", "ArrowUp", "Delete", ","]));
  });

  it("gives the commands on each key for the modifiers and the context", () => {
    expect(
      keyBindings(commands, none, null)
        .get("R")
        ?.map((command) => command.id),
    ).toEqual(["gizmo.scale", "timeline.rec"]);
    expect(
      keyBindings(commands, none, "scene")
        .get("R")
        ?.map((command) => command.id),
    ).toEqual(["gizmo.scale"]);
    expect(
      keyBindings(commands, { ...none, shift: true }, null)
        .get("R")
        ?.map((command) => command.id),
    ).toEqual(["gizmo.scale"]);
    expect(keyBindings(commands, { ...none, mod: true }, null).get("S")?.[0]?.id).toBe("file.save");
    expect(keyBindings(commands, none, null).has("S")).toBe(false);
    expect(contextsOf(commands)).toEqual(["global", "scene", "timeline"]);
    expect(chordOf("Z", { mod: true, alt: false, shift: true })).toBe("Mod+Shift+Z");
    expect(partsOf("Mod+Alt+K")).toEqual({ key: "K", modifiers: { mod: true, alt: true, shift: false } });
  });

  it("exports the key map sorted and reads it again, with the unknown commands", () => {
    const text = keymapFile({ format: "scenity.keymap/1", keys: { "z.last": ["Z"], "a.first": ["A"] } });
    expect(text).toBe(
      '{\n  "format": "scenity.keymap/1",\n  "keys": {\n    "a.first": [\n      "A"\n    ],\n    "z.last": [\n      "Z"\n    ]\n  }\n}\n',
    );
    expect(readKeymapFile(text, new Set(["a.first"]))).toEqual({
      ok: true,
      doc: { format: "scenity.keymap/1", keys: { "a.first": ["A"], "z.last": ["Z"] } },
      unknown: ["z.last"],
    });
    const bad = readKeymapFile('{"format":"scenity.keymap/1","keys":{"a.first":["Ctrl+Q"]}}', new Set());
    expect(bad.ok).toBe(false);
    expect(readKeymapFile("not json", new Set()).ok).toBe(false);
    expect(keymapFile(null)).toBe('{\n  "format": "scenity.keymap/1",\n  "keys": {}\n}\n');
  });
});
