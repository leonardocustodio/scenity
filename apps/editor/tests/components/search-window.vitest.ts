// SPDX-License-Identifier: Apache-2.0
// The Search window. The query words (`t:`, `c:`, `tag:`) and the comparisons of a field with a value give the entity
// table, with a column for each compared field. A cell edits its value. The other providers show as lists. The saved
// searches of the project stay in the storage.
import { flushPromises, mount } from "@vue/test-utils";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import SearchWindow from "../../src/scene/search/SearchWindow.vue";
import { entityTable, meets, parseTable } from "../../src/scene/search/searchTable";
import { listText, savedKey, SearchWindowState } from "../../src/scene/search/searchWindow";
import { WindowSearch } from "../../src/studio/shell/search";

afterEach(() => {
  document.body.innerHTML = "";
});

const light = (intensity: number, kind = "point") => ({ light: { kind, intensity, castShadow: false } });

const DOC = {
  entities: {
    room: { name: "Room", parent: null, tags: ["set"], components: { transform: {} } },
    lamp: { name: "Floor lamp", parent: "room", tags: ["lamps"], components: { ...light(2.5), transform: {} } },
    sun: { name: "Sun", parent: null, tags: [], components: light(4, "directional") },
    fill: { name: "Fill", parent: null, tags: ["lamps"], components: light(0.6) },
    chair: { name: "Chair", parent: "room", tags: [], components: { model: { asset: "asset:chair" } } },
  },
} as unknown as EntityDocument;

/** A storage of the page in a map. */
function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("the entity table of the Search window", () => {
  it("parses the words, the kind and the comparisons", () => {
    expect(parseTable("c:light intensity>2 t:light lamp")).toEqual({
      words: "c:light lamp",
      kind: "light",
      comparisons: [{ path: "intensity", op: ">", value: "2" }],
    });
    expect(parseTable("light.kind!=point castShadow=false").comparisons).toEqual([
      { path: "light.kind", op: "!=", value: "point" },
      { path: "castShadow", op: "=", value: "false" },
    ]);
    expect([meets(3, ">=", "3"), meets(3, "<", "3"), meets("Point", "=", "point"), meets("a", ">", "b")]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(listText("c:light intensity>2 lamp")).toBe("c:light lamp");
  });

  it("lists the lights over an intensity with an intensity column, in tree order", () => {
    const table = entityTable(DOC, "c:light intensity>2");
    expect(table.columns.map((column) => column.key)).toEqual(["intensity"]);
    expect(table.rows.map((row) => [row.id, row.cells.intensity?.value])).toEqual([
      ["lamp", 2.5],
      ["sun", 4],
    ]);
    expect(table.rows[0]?.cells.intensity).toMatchObject({ component: "light", field: "intensity" });
    expect(entityTable(DOC, "tag:lamps light.intensity<1").rows.map((row) => row.id)).toEqual(["fill"]);
    expect(entityTable(DOC, "t:model").rows.map((row) => row.id)).toEqual(["chair"]);
    // One exact component and no comparison: a column for each plain value of the component.
    expect(entityTable(DOC, "c:light").columns.map((column) => column.key)).toEqual([
      "light.kind",
      "light.intensity",
      "light.castShadow",
    ]);
  });
});

describe("the Search window", () => {
  it("edits a cell, lists the other providers and keeps the saved searches", async () => {
    const storage = memory();
    const state = new SearchWindowState("demo", () => storage);
    const search = new WindowSearch(memory);
    const ran: string[] = [];
    search.register({
      id: "commands",
      prefix: ">",
      title: "Commands",
      items: () => [{ id: "light.add", label: "Add a light", run: () => ran.push("light.add") }],
    });
    search.register({ id: "entities", prefix: "@", title: "Entities", items: () => [] });
    const edits: unknown[][] = [];
    const selected: string[][] = [];
    mount(SearchWindow, {
      props: {
        state,
        search,
        doc: shallowRef(DOC),
        select: (ids: readonly string[]) => selected.push([...ids]),
        setValue: (...args: unknown[]) => edits.push(args),
      },
      attachTo: document.body,
    });
    const input = document.querySelector<HTMLInputElement>('[data-testid="search-window-input"]');
    if (input === null) throw new Error("no input");
    input.value = "c:light intensity>2";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="search-table-row"]')];
    expect(rows.map((row) => row.dataset.entity)).toEqual(["lamp", "sun"]);
    const cell = rows[1]?.querySelector<HTMLInputElement>('[data-testid="search-cell"][data-column="intensity"]');
    expect(cell?.value).toBe("4");
    if (cell === null || cell === undefined) throw new Error("no cell");
    cell.value = "1.25";
    cell.dispatchEvent(new Event("change"));
    expect(edits).toEqual([["sun", "light", "intensity", 1.25]]);
    document.querySelector<HTMLButtonElement>('[data-testid="search-select-all"]')?.click();
    expect(selected).toEqual([["lamp", "sun"]]);

    document.querySelector<HTMLButtonElement>('[data-testid="search-window-save"]')?.click();
    expect(JSON.parse(storage.getItem(savedKey("demo")) ?? "[]")).toEqual(["c:light intensity>2"]);
    input.value = "add light";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-testid="search-result"][data-provider="commands"]')?.click();
    expect(ran).toEqual(["light.add"]);
    document.querySelector<HTMLButtonElement>('[data-testid="search-saved"]')?.click();
    await flushPromises();
    expect(input.value).toBe("c:light intensity>2");
    document.querySelector<HTMLButtonElement>('[data-testid="search-saved-remove"]')?.click();
    await flushPromises();
    expect(new SearchWindowState("demo", () => storage).saved.value).toEqual([]);
  });
});
