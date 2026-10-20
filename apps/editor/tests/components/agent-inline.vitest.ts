// SPDX-License-Identifier: Apache-2.0
// The inline prompt. ⌘I takes the context of the place of the focus: an inspector field, a hierarchy row, an asset tile
// or the selection of the view. Else it takes a point that the person clicks. The prompt field sends its text once and
// closes.
import { afterEach, describe, expect, it } from "vitest";
import { focusSubject, openInlinePrompt, type InlineSources } from "../../src/scene/agent/inlinePrompt";

afterEach(() => {
  document.body.innerHTML = "";
});

function sources(selection: string[]): InlineSources {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  return {
    selection: () => selection,
    name: (id) => ({ sun: "Key light", chair: "Chair" })[id] ?? id,
    fieldValue: (entity, component, field) =>
      entity === "sun" && component === "light" && field === "colour" ? "#fff" : undefined,
    pick: () => Promise.resolve(null),
    canvas,
  };
}

function element(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector<HTMLElement>("input, button") ?? host;
}

describe("the inline prompt", () => {
  it("takes the context of the place of the focus", () => {
    const field = element('<div data-component="light" data-field="colour"><input /></div>');
    const subject = focusSubject(sources(["sun"]), field);
    expect(subject !== "point" && subject.chips.map((chip) => chip.text)).toEqual([
      'entity:sun "Key light" component light field colour = "#fff"',
    ]);
    const row = element('<li data-testid="hierarchy-row-chair"><button>Chair</button></li>');
    expect(focusSubject(sources([]), row)).toMatchObject({ label: "Chair", chips: [{ key: "entity:chair" }] });
    const tile = element('<div data-testid="asset-tile-wood"><button>Oak wood</button></div>');
    expect(focusSubject(sources([]), tile)).toMatchObject({ label: "Oak wood", chips: [{ key: "asset:wood" }] });
    expect(focusSubject(sources(["chair", "sun"]), null)).toMatchObject({ label: "Chair" });
    expect(focusSubject(sources([]), null)).toBe("point");
  });

  it("sends the text once and closes; Escape closes with no prompt", async () => {
    const sent: string[] = [];
    const subject = { label: "Chair", chips: [], at: { x: 10, y: 10 } };
    const form = openInlinePrompt(subject, (text) => {
      sent.push(text);
      return Promise.resolve(true);
    });
    const field = form.querySelector("input");
    if (field === null) throw new Error("no field");
    expect(document.activeElement).toBe(field);
    field.value = "make it red";
    form.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(["make it red"]);
    expect(document.querySelector("#agent-inline")).toBeNull();
    const again = openInlinePrompt(subject, () => Promise.resolve(true));
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("#agent-inline")).toBeNull();
  });
});
