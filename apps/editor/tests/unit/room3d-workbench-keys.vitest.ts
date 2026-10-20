// SPDX-License-Identifier: Apache-2.0
// The ⌘ chords of the workbench in the lab frame. While the frame has the focus, the page gets no keys, so the bridge
// sends the workbench chords to the page. The keys of the lab never match.
import { describe, expect, it, vi } from "vitest";
import { chordKey, forwardChords, type ChordEvent, type KeyHost } from "../../src/core/bridge/workbenchEvents";

const chord = (code: string, parts: Partial<ChordEvent> = {}): ChordEvent => ({
  code,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...parts,
});

describe("the workbench chords of the lab frame", () => {
  it("names the workbench chords with ⌘ or Ctrl", () => {
    expect(chordKey(chord("Backslash"))).toBe("\\");
    expect(chordKey(chord("Digit1"))).toBe("1");
    expect(chordKey(chord("Digit2"))).toBe("2");
    expect(chordKey(chord("Digit3", { metaKey: false, ctrlKey: true }))).toBe("3");
    // ⌘1 to ⌘9 put the surface tabs of the workbench in front.
    expect(chordKey(chord("Digit9"))).toBe("9");
    expect(chordKey(chord("KeyK"))).toBe("k");
  });

  it("refuses the lab keys, other chords and chords with Alt or Shift", () => {
    for (const code of ["Space", "KeyB", "Slash", "Comma", "Period", "BracketLeft", "BracketRight", "ArrowLeft"]) {
      expect(chordKey(chord(code, { metaKey: false }))).toBeNull();
    }
    expect(chordKey(chord("Backslash", { metaKey: false }))).toBeNull();
    expect(chordKey(chord("KeyR"))).toBeNull();
    expect(chordKey(chord("Digit0"))).toBeNull();
    expect(chordKey(chord("KeyK", { altKey: true }))).toBeNull();
    expect(chordKey(chord("Digit1", { shiftKey: true }))).toBeNull();
    expect(chordKey(chord("toString"))).toBeNull();
  });

  it("sends a chord as the key event, stops its default and removes its listener at the stop", () => {
    let listener: ((event: Event) => void) | null = null;
    const host: KeyHost = {
      addEventListener: (_type, next) => (listener = next),
      removeEventListener: () => (listener = null),
    };
    const sent: unknown[] = [];
    const stop = forwardChords(host, (body) => sent.push(body));
    const press = (code: string, metaKey = true) => {
      const preventDefault = vi.fn();
      listener?.({ ...chord(code, { metaKey }), preventDefault } as unknown as Event);
      return preventDefault;
    };
    expect(press("Digit2")).toHaveBeenCalledOnce();
    expect(press("Space", false)).not.toHaveBeenCalled();
    expect(sent).toEqual([{ event: "key", key: "2" }]);
    stop();
    expect(listener).toBeNull();
  });
});
