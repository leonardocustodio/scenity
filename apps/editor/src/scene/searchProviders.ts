// SPDX-License-Identifier: Apache-2.0
/**
 * The providers of the search box of the scene page: the commands of the window, the entities of the scene, the scene
 * files of the project, the assets, the editor settings and the headings of the docs. ⌘K opens the box; ⌘O opens it
 * with the scene filter (`@`).
 */
import { docsLinkOf } from "./extensions/docsLinks";
import { SETTING_FIELDS, type SettingField } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { devServerAssets } from "../assetBrowser/assetClient";
import { showAsset } from "../assetBrowser/assetFocus";
import type { AssetListEntry } from "../assetBrowser/assetTypes";
import type { SearchItem, SearchProvider, WindowSearch } from "../studio/shell/search";
import { messageIdOf, t, textOr } from "../texts";
import { pageKeys, type PageKeyCommandSpec, type WindowCommand } from "./settings/pageKeys";
import { keyLabel } from "./settings/useSettingsPanel";

/** The page parts that the providers read. */
export interface SearchSources {
  readonly project: string;
  document(): SceneDocument;
  /** Select entities (the first is the primary one). */
  select(ids: readonly string[]): void;
  /** The scene files of the project, and the open of one. */
  sceneFiles(): Promise<readonly string[]>;
  openScene(path: string): void;
  /** Show a panel of the window. */
  showPanel(id: string): void;
}

/** The address of the docs of the repository. */
export const DOCS_URL = "https://github.com/leonardocustodio/scenity/blob/main/docs/";

/** A heading of the docs: its file, its text and its anchor. */
export interface DocHeading {
  readonly file: string;
  readonly title: string;
  readonly anchor: string;
}

/** The anchor of a heading as GitHub makes it. */
export function headingAnchor(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** The headings (`##` and `###`) of a docs file. */
export function docHeadings(file: string, text: string): DocHeading[] {
  return [...text.matchAll(/^#{2,3} (.+)$/gm)].map((match) => {
    const title = (match[1] ?? "").trim();
    return { file, title, anchor: headingAnchor(title) };
  });
}

/** The product docs for the person, loaded at the first open of the box. */
const DOC_FILES = import.meta.glob<string>(
  "../../../../docs/{README,quickstart,editor,formats,cli,plugins,workbench,testing}.md",
  { query: "?raw", import: "default" },
);

/** The label of a command in the language of the page. */
function commandLabel(command: WindowCommand): string {
  return textOr(messageIdOf("settings-command", command.id), command.title);
}

/** The commands of the window that run with no arguments. */
export function commandItems(commands: readonly WindowCommand[], run: (id: string) => unknown): SearchItem[] {
  return commands
    .filter((command) => ((command.schema.required as unknown[] | undefined) ?? []).length === 0)
    .map((command) => {
      const [first] = command.keys;
      const docs = docsLinkOf(`command:${command.id}`);
      return {
        ...(docs === null ? {} : { docs }),
        id: command.id,
        label: commandLabel(command),
        ...(first === undefined ? {} : { detail: keyLabel(first) }),
        words: [command.id, command.category, command.description],
        reason: command.available ? null : command.reason,
        copy: command.id,
        run: () => run(command.id),
      };
    });
}

/** The entities of a scene; the filter `c:` keeps the entities with a component of that name. */
export function entityItems(doc: SceneDocument, filter: string | undefined, run: (id: string) => void): SearchItem[] {
  return Object.entries(doc.entities)
    .filter(
      ([, entity]) => filter === undefined || Object.keys(entity.components).some((name) => name.includes(filter)),
    )
    .map(([id, entity]) => {
      const components = Object.keys(entity.components);
      return {
        id,
        label: entity.name ?? id,
        detail: id,
        words: [id, ...components],
        copy: id,
        run: () => run(id),
      };
    });
}

/** The label of a setting in the language of the page. */
function settingLabel(field: SettingField): string {
  return textOr(messageIdOf("settings-field", field.path), field.label);
}

/** The editor settings: a result opens Preferences at the field. */
export function settingItems(fields: readonly SettingField[], run: (path: string) => void): SearchItem[] {
  return fields.map((field) => ({
    id: field.path,
    label: settingLabel(field),
    detail: t("panel-preferences"),
    words: [field.path, field.label],
    copy: field.path,
    run: () => run(field.path),
  }));
}

/** The headings of the docs: a result opens the heading in a new tab. */
export function docItems(headings: readonly DocHeading[], open: (url: string) => void): SearchItem[] {
  return headings.map((heading) => {
    const url = `${DOCS_URL}${heading.file}#${heading.anchor}`;
    return {
      id: `${heading.file}#${heading.anchor}`,
      label: heading.title,
      detail: heading.file,
      copy: url,
      run: () => open(url),
    };
  });
}

/** The assets of the project; the filters `t:` (kind), `tag:` and `in:` (folder) keep a part of them. */
export function assetItems(assets: readonly AssetListEntry[], filters: Readonly<Record<string, string>>): SearchItem[] {
  return assets
    .filter((asset) => filters.t === undefined || asset.kind.toLowerCase().includes(filters.t))
    .filter((asset) => filters.tag === undefined || asset.tags.some((tag) => tag.toLowerCase() === filters.tag))
    .filter((asset) => filters.in === undefined || asset.source.toLowerCase().includes(filters.in))
    .map((asset) => ({
      id: asset.id,
      label: asset.name,
      detail: asset.source,
      words: [asset.kind, ...asset.tags, asset.source],
      copy: asset.source,
      run: () => showAsset(asset.id, asset.name),
    }));
}

/** Focus a field of Preferences after the panel shows. */
function focusSetting(sources: SearchSources, path: string): void {
  sources.showPanel("preferences");
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="setting-${path}"]`)?.focus());
}

/** The providers of the page and the loads that they need at an open of the box. */
function providers(sources: SearchSources): { list: SearchProvider[]; load: () => Promise<void> } {
  const loaded = { files: [] as readonly string[], assets: [] as readonly AssetListEntry[], docs: [] as DocHeading[] };
  const load = async (): Promise<void> => {
    const [files, assets, docs] = await Promise.all([
      sources.sceneFiles().catch(() => []),
      devServerAssets(`/projects/${sources.project}/`)
        .list()
        .then((list) => list.assets)
        .catch(() => []),
      loaded.docs.length > 0
        ? Promise.resolve(loaded.docs)
        : Promise.all(
            Object.entries(DOC_FILES).map(async ([path, read]) =>
              docHeadings(path.split("/").pop() ?? path, await read()),
            ),
          ).then((all) => all.flat()),
    ]);
    Object.assign(loaded, { files, assets, docs });
  };
  const frame = (id: string): void => {
    sources.select([id]);
    void pageKeys().run("view.frame");
  };
  const list: SearchProvider[] = [
    {
      id: "commands",
      prefix: ">",
      title: t("search-kind-commands"),
      items: () => commandItems(pageKeys().list(), (id) => pageKeys().run(id)),
    },
    {
      id: "entities",
      prefix: "@",
      title: t("search-kind-entities"),
      items: (filters) => entityItems(sources.document(), filters.c, frame),
    },
    {
      id: "files",
      prefix: "",
      title: t("search-kind-files"),
      items: () =>
        loaded.files.map((path) => ({
          id: path,
          label: path.split("/").pop() ?? path,
          detail: path,
          copy: path,
          run: () => sources.openScene(path),
        })),
    },
    {
      id: "assets",
      prefix: "#",
      title: t("search-kind-assets"),
      items: (filters) => assetItems(loaded.assets, filters),
    },
    {
      id: "settings",
      prefix: "",
      title: t("search-kind-settings"),
      items: () => settingItems(SETTING_FIELDS, (path) => focusSetting(sources, path)),
    },
    {
      id: "docs",
      prefix: "?",
      title: t("search-kind-docs"),
      items: () => docItems(loaded.docs, (url) => window.open(url, "_blank", "noopener")),
    },
  ];
  return { list, load };
}

/** Register the providers of the page and the commands of the box; the result removes them. */
export function startSearch(search: WindowSearch, sources: SearchSources): () => void {
  const { list, load } = providers(sources);
  const stops = list.map((provider) => search.register(provider));
  search.prepare = load;
  const open = (text: string): void => search.open(text);
  const commands: PageKeyCommandSpec[] = [
    { id: "search.open", title: t("search-command-open"), keys: ["Mod+K"], inText: true, run: () => open("") },
    { id: "scene.quickOpen", title: t("search-command-scene"), keys: ["Mod+O"], inText: true, run: () => open("@") },
  ];
  stops.push(pageKeys().register(commands));
  return () => {
    for (const stop of stops) stop();
  };
}
