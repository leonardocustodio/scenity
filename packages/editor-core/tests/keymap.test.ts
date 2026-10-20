// SPDX-License-Identifier: Apache-2.0 The key map of the editor: the default keys of the command definitions, the key
// map of the user over them, the conflicts of two commands on one key in one context, and the chords.
import { describe, expect, it } from "bun:test";
import { readEditorDocument } from "@scenity/scene/schema/editor";
import {
  chordLabel,
  chordOfEvent,
  createCommandRegistry,
  createKeyMap,
  emptyKeymap,
  ENTITY_COMMANDS,
  keyClashes,
  normalChord,
  withKeys,
  type KeyCommand,
} from "../src/index";

const COMMANDS: readonly KeyCommand[] = [
  { id: "view.frame", keys: ["F"], keyContext: "scene" },
  { id: "file.save", keys: ["Mod+S"] },
  { id: "history.redo", keys: ["Mod+Shift+Z"] },
  { id: "entity.delete", keys: ["Delete", "Backspace"], keyContext: "scene" },
  { id: "sequencer.deleteKey", keys: ["Delete"], keyContext: "sequencer" },
  { id: "camera.editor", keys: ["0"], keyContext: "scene" },
  { id: "layout.measure", keyContext: "scene" },
];

/** A key event of the parts that the key map reads. */
function press(
  code: string,
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) {
  return {
    code,
    key,
    metaKey: mods.meta === true,
    ctrlKey: mods.ctrl === true,
    altKey: mods.alt === true,
    shiftKey: mods.shift === true,
  };
}

describe("the chords of the key map", () => {
  it("puts a typed chord in the fixed form", () => {
    expect(normalChord("ctrl+shift+z")).toBe("Mod+Shift+Z");
    expect(normalChord("Shift+Cmd+z")).toBe("Mod+Shift+Z");
    expect(normalChord("⌘S")).toBeNull();
    expect(normalChord("⌘+s")).toBe("Mod+S");
    expect(normalChord("f2")).toBe("F2");
    expect(normalChord("esc")).toBe("Escape");
    expect(normalChord("Shift+,")).toBe("Shift+,");
    expect(normalChord("Mod+Mod+S")).toBeNull();
    expect(normalChord("Hyper+S")).toBeNull();
    expect(normalChord("")).toBeNull();
  });

  it("gives the chord of a key event from its code, so Shift and the layout do not change the key", () => {
    expect(chordOfEvent(press("KeyF", "f"))).toBe("F");
    expect(chordOfEvent(press("KeyZ", "Z", { meta: true, shift: true }))).toBe("Mod+Shift+Z");
    expect(chordOfEvent(press("KeyS", "s", { ctrl: true }))).toBe("Mod+S");
    expect(chordOfEvent(press("Comma", "<", { shift: true }))).toBe("Shift+,");
    expect(chordOfEvent(press("Digit3", "#", { shift: true }))).toBe("Shift+3");
    expect(chordOfEvent(press("Space", " "))).toBe("Space");
    expect(chordOfEvent(press("F2", "F2"))).toBe("F2");
    expect(chordOfEvent(press("Delete", "Delete"))).toBe("Delete");
    expect(chordOfEvent(press("ShiftLeft", "Shift", { shift: true }))).toBeNull();
  });

  it("labels a chord for macOS and for other systems", () => {
    expect(chordLabel("Mod+Shift+Z", true)).toBe("⇧⌘Z");
    expect(chordLabel("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(chordLabel("Alt+G", true)).toBe("⌥G");
    expect(chordLabel("F", false)).toBe("F");
  });
});

describe("the key map", () => {
  it("takes the default keys from the command definitions", () => {
    const map = createKeyMap(COMMANDS);
    expect(map.keysOf("view.frame")).toEqual(["F"]);
    expect(map.keysOf("entity.delete")).toEqual(["Delete", "Backspace"]);
    expect(map.keysOf("layout.measure")).toEqual([]);
    expect(map.commandsFor("F", ["scene", "global"])).toEqual(["view.frame"]);
    expect(map.commandsFor("Mod+S", ["scene", "global"])).toEqual(["file.save"]);
    expect(map.bindings.every((binding) => binding.source === "default")).toBe(true);
    expect(map.conflicts()).toEqual([]);
  });

  it("takes the keys of the editor-core commands from their definitions", () => {
    const registry = createCommandRegistry();
    registry.register(ENTITY_COMMANDS);
    const map = createKeyMap(registry.list());
    expect(map.keysOf("entity.duplicate")).toEqual(["Mod+D"]);
    expect(map.keysOf("entity.paste")).toEqual(["Mod+V"]);
    expect(map.commandsFor("Backspace", ["scene", "global"])).toEqual(["entity.delete"]);
  });

  it("lets the key map of the user replace the keys of a command, and a reload of the document gives the same map", () => {
    const user = withKeys(emptyKeymap(), "view.frame", ["g"], ["F"]);
    expect(user).toEqual({ format: "scenity.keymap/1", keys: { "view.frame": ["G"] } });
    const read = readEditorDocument(JSON.stringify(user), "keymap");
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    const map = createKeyMap(COMMANDS, read.doc);
    expect(map.keysOf("view.frame")).toEqual(["G"]);
    expect(map.commandsFor("G", ["scene", "global"])).toEqual(["view.frame"]);
    expect(map.commandsFor("F", ["scene", "global"])).toEqual([]);
    expect(map.bindings.find((binding) => binding.command === "view.frame")?.source).toBe("user");
    expect(map.defaultsOf("view.frame")).toEqual(["F"]);
  });

  it("keeps only the changes: the default keys or a reset take the entry out; an empty list removes the keys", () => {
    const changed = withKeys(emptyKeymap(), "view.frame", ["G"], ["F"]);
    expect(withKeys(changed, "view.frame", ["F"], ["F"]).keys).toEqual({});
    expect(withKeys(changed, "view.frame", null).keys).toEqual({});
    const none = withKeys(emptyKeymap(), "file.save", [], ["Mod+S"]);
    expect(none.keys).toEqual({ "file.save": [] });
    expect(createKeyMap(COMMANDS, none).keysOf("file.save")).toEqual([]);
  });

  it("finds two commands on one key in the same context, and in a context and the global context", () => {
    const user = withKeys(withKeys(emptyKeymap(), "camera.editor", ["F"]), "history.redo", ["Delete"]);
    const map = createKeyMap(COMMANDS, user);
    expect(map.conflicts()).toEqual([
      {
        chord: "Delete",
        commands: ["entity.delete", "history.redo", "sequencer.deleteKey"],
        contexts: ["global", "scene", "sequencer"],
      },
      { chord: "F", commands: ["camera.editor", "view.frame"], contexts: ["scene"] },
    ]);
    expect(keyClashes(createKeyMap(COMMANDS), COMMANDS, "camera.editor", "F")).toEqual(["view.frame"]);
  });

  it("gives no conflict for one key in two contexts that do not overlap", () => {
    const map = createKeyMap(COMMANDS);
    expect(map.commandsFor("Delete", ["sequencer", "global"])).toEqual(["sequencer.deleteKey"]);
    expect(map.commandsFor("Delete", ["scene", "global"])).toEqual(["entity.delete"]);
    expect(keyClashes(map, COMMANDS, "sequencer.deleteKey", "Backspace")).toEqual([]);
  });

  it("keeps the commands of the user document that the registry does not have, and leaves out a bad chord", () => {
    const map = createKeyMap(COMMANDS, { format: "scenity.keymap/1", keys: { "plugin.tool": ["T"] } });
    expect(map.unknown).toEqual(["plugin.tool"]);
    expect(createKeyMap([{ id: "a.b", keys: ["Hyper+Q", "Q"] }]).keysOf("a.b")).toEqual(["Q"]);
  });

  it("refuses a key map document with a chord out of the fixed form", () => {
    const bad = { format: "scenity.keymap/1", keys: { "view.frame": ["shift+g"] } };
    expect(readEditorDocument(JSON.stringify(bad), "keymap").ok).toBe(false);
  });
});
