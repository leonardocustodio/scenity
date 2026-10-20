// SPDX-License-Identifier: Apache-2.0
// Undo and redo in the toolbar, and the conflict dialog with the semantic diff.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { builtinRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { diffLines, diskDetails, DIFF_LINES_MAX } from "../../src/scene/sceneDiff";
import DialogHost from "../../src/studio/shell/DialogHost.vue";
import HistoryButtons from "../../src/studio/shell/HistoryButtons.vue";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";

afterEach(() => {
  document.body.innerHTML = "";
});

const doc = (entities: Record<string, unknown>): SceneDocument =>
  ({ format: "scenity.scene/1", id: "room", entities }) as unknown as SceneDocument;
const LAMP = { name: "Lamp", parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } };

describe("the semantic diff", () => {
  it("gives a line for each change in the words of the editor", () => {
    const registry = builtinRegistry();
    const from = doc({ lamp: LAMP, sofa: { name: "Sofa", parent: null, index: 1, components: {} } });
    const to = doc({
      lamp: { ...LAMP, name: "Desk lamp", parent: "table", components: { transform: { position: [1, 0, 0] } } },
      table: { name: "Table", parent: null, index: 0, components: {} },
    });
    const lines = diffLines(from, to, registry);
    expect(lines).toContain("Table: new entity");
    expect(lines).toContain("Sofa: removed");
    expect(lines).toContain("Desk lamp: moved under Table");
    expect(lines).toContain("Desk lamp: name Lamp → Desk lamp");
    expect(lines).toContain("Desk lamp: transform.position (0, 0, 0) → (1, 0, 0)");
    expect(diffLines(from, from, registry)).toEqual([]);
  });

  it("cuts a long diff and reads the text of a file", () => {
    const registry = builtinRegistry();
    const many = Object.fromEntries(
      Array.from({ length: 50 }, (_, at) => [
        `e${String(at)}`,
        { name: `E${String(at)}`, parent: null, index: at, components: {} },
      ]),
    );
    const lines = diffLines(doc({}), doc(many), registry);
    expect(lines).toHaveLength(DIFF_LINES_MAX + 1);
    expect(lines.at(-1)).toBe("10 more changes");
    const text = JSON.stringify(doc({ lamp: { ...LAMP, name: "Desk lamp" } }));
    const details = diskDetails("See the diff", text, "scenes/main.scene.json", doc({ lamp: LAMP }), registry);
    expect(details?.lines).toEqual(["Desk lamp: name Lamp → Desk lamp"]);
    // The dialog shows the semantic diff view of the same change.
    expect(details?.view?.props).toHaveProperty("diff");
    expect(diskDetails("x", "{", "scenes/main.scene.json", doc({ lamp: LAMP }), registry)).toBeNull();
  });

  it("shows in the dialog under See the diff", async () => {
    const notices = new WindowNotices();
    mount(DialogHost, { props: { notices }, attachTo: document.body });
    void notices.ask({
      spec: "confirm.fileChanged",
      title: "The file changed",
      text: "Another tool changed the file.",
      details: { label: "See the diff", lines: ["Lamp: name Lamp → Desk lamp"] },
      actions: [{ id: "first", label: "Reload" }],
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="dialog-details"] summary')?.textContent).toBe("See the diff");
    expect(document.querySelector('[data-testid="dialog-detail"]')?.textContent).toBe("Lamp: name Lamp → Desk lamp");
  });
});

describe("Undo and Redo in the toolbar", () => {
  it("name their steps, run their commands, and show nothing with no history", async () => {
    const status = new WindowStatus();
    const ran: string[] = [];
    const port = {
      menuCommands: () => [],
      run: (id: string) => (ran.push(id), null),
      listen: () => () => undefined,
      keyRows: () => [],
    };
    mount(HistoryButtons, { props: { status, port }, attachTo: document.body });
    expect(document.querySelector('[data-testid="toolbar-history"]')).toBeNull();
    status.set("history", { undo: "Move Lamp", redo: null });
    await flushPromises();
    const undo = document.querySelector<HTMLButtonElement>('[data-testid="toolbar-undo"]');
    const redo = document.querySelector<HTMLButtonElement>('[data-testid="toolbar-redo"]');
    expect(undo?.getAttribute("aria-label")).toBe("Undo Move Lamp");
    expect(redo?.disabled).toBe(true);
    expect(redo?.getAttribute("aria-label")).toBe("Nothing to redo");
    undo?.click();
    expect(ran).toEqual(["history.undo"]);
  });
});
