// SPDX-License-Identifier: Apache-2.0
// Search and ask: 30 queries of the box find their target in the first three results. The
// providers read the real command definitions, the page commands with their texts, the showroom scene, the scene files,
// the assets, the editor settings and the headings of the docs of the repository. The parse of the query words, the
// sentence test of "Ask the agent" and the recent items have their own tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  argsJsonSchema,
  commandMeta,
  ENTITY_COMMANDS,
  HIERARCHY_COMMANDS,
  MATERIAL_COMMANDS,
  PREFAB_COMMANDS,
  SEQUENCE_COMMANDS,
  SETTING_FIELDS,
  TRANSFORM_COMMANDS,
  type ArgSpec,
} from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import type { AssetListEntry } from "../../src/assetBrowser/assetTypes";
import {
  assetItems,
  commandItems,
  docHeadings,
  docItems,
  entityItems,
  headingAnchor,
  settingItems,
} from "../../src/scene/searchProviders";
import type { WindowCommand } from "../../src/scene/settings/pageKeys";
import {
  parseQuery,
  readsAsSentence,
  searchAll,
  WindowSearch,
  type SearchProvider,
} from "../../src/studio/shell/search";
import { t } from "../../src/texts";

// The tests of the editor run in apps/editor.
const ROOT = join(process.cwd(), "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** A command of the window as the registry lists it. */
function command(
  id: string,
  title: string,
  kind: "edit" | "view" = "view",
  args: Readonly<Record<string, ArgSpec>> = {},
  keys: readonly string[] = [],
): WindowCommand {
  const meta = commandMeta({ id, title, kind });
  return {
    ...{ id, title, key: null, kind, ...meta, keys, args, schema: argsJsonSchema(args), selection: "no selection" },
    ...{ owner: false, available: true, reason: null, source: "page" },
  };
}

const CORE = [
  ...ENTITY_COMMANDS,
  ...HIERARCHY_COMMANDS,
  ...TRANSFORM_COMMANDS,
  ...PREFAB_COMMANDS,
  ...MATERIAL_COMMANDS,
  ...SEQUENCE_COMMANDS,
].map((item) => command(item.id, item.title, item.kind, item.args, item.keys ?? []));

const PAGE = [
  command("file.save", t("settings-command-save"), "view", {}, ["Mod+S"]),
  command("history.undo", t("settings-command-undo"), "view", {}, ["Mod+Z"]),
  command("history.redo", t("settings-command-redo"), "view", {}, ["Mod+Shift+Z"]),
  command("view.frame", t("viewport-command-frame"), "view", {}, ["F"]),
  command("play.start", t("play-start-title")),
  command("theme.light", t("theme-use", { name: t("settings-theme-light") })),
  command("theme.navy", t("theme-use", { name: t("settings-theme-navy") })),
  command("panel.maximize", t("window-maximize"), "view", {}, ["Shift+Space"]),
  command("panel.next", t("window-next"), "view", {}, ["F6"]),
  command("layout.reset", t("window-reset")),
  command("panel.open.preferences", t("panel-open", { title: t("panel-preferences") })),
];

const SCENE = JSON.parse(read("samples/showroom/scenes/main.scene.json")) as SceneDocument;
const FILES = ["scenes/main.scene.json", "scenes/crowd.scene.json", "scenes/night.scene.json"];
const ASSETS: AssetListEntry[] = [
  ...[
    {
      id: "chair-01",
      kind: "model",
      name: "armchair_01",
      tags: ["furniture"],
      source: "assets/sources/armchair_01.glb",
    },
    { id: "lamp-01", kind: "model", name: "lamp_01", tags: ["light"], source: "assets/sources/lamp_01.glb" },
    {
      id: "oak",
      kind: "material",
      name: "oak_floor",
      tags: ["wood"],
      source: "assets/materials/oak_floor.material.json",
    },
  ].map((asset) => ({ ...asset, record: `${asset.source}.asset.json`, still: null }) as unknown as AssetListEntry),
];
const DOCS = ["editor.md", "formats.md", "cli.md", "quickstart.md"].flatMap((file) =>
  docHeadings(file, read(`docs/${file}`)),
);

const noop = (): void => undefined;
const PROVIDERS: SearchProvider[] = [
  { id: "commands", prefix: ">", title: "Commands", items: () => commandItems([...PAGE, ...CORE], noop) },
  { id: "entities", prefix: "@", title: "Entities", items: (filters) => entityItems(SCENE, filters.c, noop) },
  {
    id: "files",
    prefix: "",
    title: "Files",
    items: () => FILES.map((path) => ({ id: path, label: path.split("/").pop() ?? path, detail: path, run: noop })),
  },
  { id: "assets", prefix: "#", title: "Assets", items: (filters) => assetItems(ASSETS, filters) },
  { id: "settings", prefix: "", title: "Settings", items: () => settingItems(SETTING_FIELDS, noop) },
  { id: "docs", prefix: "?", title: "Docs", items: () => docItems(DOCS, noop) },
];

/** The 30 queries and the result that each one must give in its first three results. */
const QUERIES: readonly (readonly [string, string])[] = [
  ["save", "commands:file.save"],
  ["undo", "commands:history.undo"],
  ["redo", "commands:history.redo"],
  [">dup", "commands:entity.duplicate"],
  ["delete entities", "commands:entity.delete"],
  ["copy", "commands:entity.copy"],
  ["paste", "commands:entity.paste"],
  ["show all", "commands:view.showAll"],
  ["frame", "commands:view.frame"],
  ["play", "commands:play.start"],
  ["light theme", "commands:theme.light"],
  ["navy", "commands:theme.navy"],
  ["maximize", "commands:panel.maximize"],
  ["next panel", "commands:panel.next"],
  ["reset the layout", "commands:layout.reset"],
  ["preferences", "commands:panel.open.preferences"],
  ["armchair", "entities:armchair"],
  ["@otto", "entities:ottoman"],
  ["lantern light", "entities:lantern-light"],
  ["@c:light key", "entities:sun"],
  ["coffee", "entities:coffee-table"],
  ["front camera", "entities:front"],
  ["grid snap", "settings:snaps.grid"],
  ["angle snap", "settings:snaps.angleDegrees"],
  ["orbit speed", "settings:camera.orbitSpeed"],
  ["?gizmos", `docs:editor.md#${headingAnchor("Gizmos")}`],
  ["?sequence", `docs:formats.md#${headingAnchor("The sequence")}`],
  ["scenity shot", `docs:cli.md#${headingAnchor("`scenity shot`")}`],
  ["crowd", "files:scenes/crowd.scene.json"],
  ["#t:material oak", "assets:oak"],
];

describe("search and ask", () => {
  it("finds the target of each of the 30 queries in the first three results", () => {
    expect(QUERIES).toHaveLength(30);
    const misses = QUERIES.flatMap(([query, target]) => {
      const top = searchAll(PROVIDERS, query)
        .slice(0, 3)
        .map((result) => `${result.provider}:${result.item.id}`);
      return top.includes(target) ? [] : [`${query} → ${target} (got ${top.join(", ")})`];
    });
    expect(misses).toEqual([]);
  });

  it("reads the query words: the prefix of a provider and the filters", () => {
    expect(parseQuery("@c:light key", PROVIDERS)).toEqual({
      provider: "entities",
      filters: { c: "light" },
      text: "key",
    });
    expect(parseQuery("#tag:wood in:materials oak", PROVIDERS)).toEqual({
      provider: "assets",
      filters: { tag: "wood", in: "materials" },
      text: "oak",
    });
    expect(parseQuery("Grid", PROVIDERS)).toEqual({ provider: null, filters: {}, text: "grid" });
  });

  it("knows a sentence for the agent: a question, a request word, or four words", () => {
    expect(readsAsSentence("how do I add a light?")).toBe(true);
    expect(readsAsSentence("make the room darker")).toBe(true);
    expect(readsAsSentence("put two chairs near the table")).toBe(true);
    expect(readsAsSentence("lantern light")).toBe(false);
  });

  it("puts the item of the last run first among equal items, and keeps the recent items", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as Storage;
    const search = new WindowSearch(() => storage);
    for (const provider of PROVIDERS) search.register(provider);
    const lights = (): string[] => search.results("@c:light").map((result) => result.item.id);
    expect(lights()[0]).toBe("fill");
    const sun = search.results("@c:light").find((result) => result.item.id === "sun");
    if (sun === undefined) throw new Error("no sun");
    search.run(sun);
    expect(lights()[0]).toBe("sun");
    expect(search.recent()).toEqual(["entities:sun"]);
  });
});
