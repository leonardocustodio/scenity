// SPDX-License-Identifier: Apache-2.0
/**
 * The material editor of the scene page in the edit mode. It holds the material channel of `@scenity/editor-core` (a
 * channel of the one history) and connects it to the page:
 *
 * - open: the asset index of the project gives the file of a material asset; the scene file port reads its text.
 *   The asset browser and the inspector open a material with a window event (materialEvents.ts).
 * - live: each change goes to the core as a "load" with `materials`: the shared material of the asset changes for
 *   each entity that uses it, with no page reload.
 * - save: the page editor saves each changed material after the scene, through the same writer (the canonical form,
 *   the base hash, the denylist and the role check of the host). The file bar shows the dirty state.
 * - assign: the scene ops of the command `material.assign` (one step of the history), with the part names of the
 *   inspect report. The command itself is in the registry of the page commands, for the palette and Claude.
 * - new: "New material" imports a `*.material.json` file of the current values (the import of the asset browser), then
 *   opens it. The core shows it before the manifest of the page has its record.
 *
 * This module has no Vue: the page makes it before the lazy panel chunk loads. The errors that the status line shows
 * and the history titles are Fluent messages of `src/i18n/en-US/material.ftl`.
 */
import {
  assignMaterialOps,
  MATERIAL_CHANNEL,
  MaterialChannel,
  materialFileName,
  materialTargets,
  renamedMaterial,
  type MaterialEdits,
  type MaterialTarget,
  type PartNames,
} from "@scenity/editor-core";
import { writeDocument } from "@scenity/scene/canonical";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import { devServerAssets, type AssetSource } from "../../assetBrowser/assetClient";
import type { PageEditorParts, PageSaveResult, ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { eventDetail, MATERIAL_OPEN_EVENT, showDockTab } from "./materialEvents";
import { t } from "../../texts";

/** The ID of the material tab of the bottom dock. */
export const MATERIAL_TAB = "material";

/** One entry of the asset index of the project (scripts/projects.ts). */
export interface IndexEntry {
  readonly id: string;
  readonly path: string;
  readonly kind: string;
}

/** The part of the inspect report that the material editor reads: the part names of each model entity. */
export interface PartsReport {
  readonly entities: readonly { readonly id: string; readonly parts?: PartNames }[];
}

/** What the material editor reads of the page. */
export interface MaterialPageParts {
  /** The URL of the project folder, with a "/" at the end. */
  readonly base: string;
  readonly files: SceneFilePort;
  /** Send edited material documents to the core (a "load" with `materials`); it ends after the frame. */
  readonly send: (docs: MaterialEdits) => Promise<unknown>;
  /** The inspect report of the dev core (the part names of the models). */
  readonly inspect?: () => Promise<PartsReport | null>;
  /** The asset source of the import (a test gives another one). Default: the dev server of the page. */
  readonly source?: AssetSource;
}

/** The new material when no material is open: a standard material. */
const NEW_MATERIAL: MaterialDocument = { format: "scenity.material/1", type: "standard", colour: "#ffffff" };

export class PageMaterials {
  readonly channel: MaterialChannel;
  readonly #parts: MaterialPageParts;
  readonly #listeners = new Set<() => void>();
  #sent: Promise<unknown> = Promise.resolve();
  #index: Promise<IndexEntry[]> | null = null;
  #current: string | null = null;
  #editor: ScenePageEditor | null = null;

  constructor(parts: MaterialPageParts) {
    this.#parts = parts;
    this.channel = new MaterialChannel({
      send: (docs) => {
        void this.#queue(docs);
      },
    });
    this.channel.listen(() => this.#tell());
  }

  /** The channel and the op kinds for the page editor (with the channels of the sequence, if any). */
  editorParts(more?: Pick<PageEditorParts, "channels" | "kinds">): Pick<PageEditorParts, "channels" | "kinds"> {
    return { ...more, channels: { ...more?.channels, [MATERIAL_CHANNEL]: this.channel.channel } };
  }

  /** Connect the page editor: the history, the save after the scene, the dirty state and the open event. */
  connect(editor: ScenePageEditor): void {
    this.#editor = editor;
    this.channel.connect(editor.channel.history);
    editor.attach({ dirty: () => this.channel.dirtyRefs().length > 0, save: (force) => this.save(force) });
    this.channel.listen(() => editor.changed());
    window.addEventListener(MATERIAL_OPEN_EVENT, (event) => {
      const ref = eventDetail(event, "ref");
      if (ref !== null) void this.open(ref).catch((error: unknown) => console.warn(errorText(error)));
    });
  }

  /** The open material that the panel shows, or null. */
  get current(): string | null {
    return this.#current;
  }

  /** The pictures of the assets of the project (asset ID → URL); empty when the page has no list. */
  async stills(): Promise<ReadonlyMap<string, string>> {
    const list = await devServerAssets(this.#parts.base)
      .list()
      .catch(() => null);
    const base = this.#parts.base;
    return new Map(
      (list?.assets ?? []).flatMap((asset) =>
        asset.still === null ? [] : [[asset.id, `${base}${encodeURI(asset.still)}`]],
      ),
    );
  }

  /** The assets of the project index (a new import reads the index again). */
  index(): Promise<IndexEntry[]> {
    this.#index ??= fetch(`${this.#parts.base}assets.index.json`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(t("material-no-index", { status: String(response.status) }));
        return response.json() as Promise<Readonly<Record<string, { path: string; kind: string }>>>;
      })
      .then((index) => Object.entries(index).map(([id, entry]) => ({ id, path: entry.path, kind: entry.kind })));
    const load = this.#index;
    load.catch(() => {
      if (this.#index === load) this.#index = null;
    });
    return load;
  }

  /** Open a material asset (`asset:<id>`) and show it in the panel. The result is its current document. */
  async open(ref: string): Promise<MaterialDocument> {
    let path = this.channel.path(ref);
    if (path === null) {
      const id = ref.replace(/^asset:/, "");
      const entry = (await this.index()).find((item) => item.id === id);
      if (entry?.kind !== "material") throw new Error(t("material-not-found", { ref }));
      path = entry.path;
      const file = await this.#parts.files.read(path);
      this.channel.open(ref, path, file.text);
    }
    this.#current = ref;
    this.#tell();
    showDockTab(MATERIAL_TAB);
    return this.channel.doc(ref);
  }

  /** Show another open material in the panel. */
  show(ref: string): void {
    this.channel.doc(ref);
    this.#current = ref;
    this.#tell();
  }

  /** Wait until the core shows each change so far. */
  settled(): Promise<unknown> {
    return this.#sent;
  }

  /** The parts of an entity that can take a material asset, with the part names of the inspect report. */
  async targets(entity: string): Promise<MaterialTarget[]> {
    const editor = this.#need();
    const report = await this.#parts.inspect?.().catch(() => null);
    const parts = report?.entities.find((item) => item.id === entity)?.parts;
    return materialTargets(editor.doc, entity, parts);
  }

  /** Assign a material asset to a part of an entity: the ops of `material.assign`, one step of the history. */
  async assign(entity: string, part: string | null, ref: string | null): Promise<void> {
    const editor = this.#need();
    const title =
      part === null ? t("material-assign-step", { entity }) : t("material-assign-step-part", { entity, part });
    const reason = editor.apply(assignMaterialOps(editor.doc, entity, part, ref), title);
    if (reason !== null) throw new Error(reason);
    await editor.settled();
  }

  /**
   * Make a new material: a `*.material.json` asset with the values of the open material (or a standard material) and
   * the name, through the import of the asset browser. The result is the reference of the new asset, open in the panel.
   */
  async create(name: string): Promise<string> {
    const from = this.#current === null ? NEW_MATERIAL : this.channel.doc(this.#current);
    const doc = renamedMaterial(from, name);
    const text = writeDocument(doc);
    const file = new File([text], materialFileName(name), { type: "application/json" });
    const imported = await (this.#parts.source ?? devServerAssets(this.#parts.base)).importFile(file);
    if (!imported.ok) throw new Error(t("material-import-failed", { reason: imported.reason }));
    const ref = `asset:${imported.asset.id}`;
    this.#index = null;
    const disk = await this.#parts.files.read(imported.asset.source);
    const opened = this.channel.open(ref, imported.asset.source, disk.text);
    // The core gets the document before any entity uses the asset: the manifest of the page has no record of it.
    void this.#queue({ [ref]: opened });
    this.#current = ref;
    this.#tell();
    return ref;
  }

  /** Save each changed material through the scene file port; the first result that is not ok, else the last. */
  async save(force = false): Promise<PageSaveResult> {
    let last: PageSaveResult = { ok: false, conflict: false, reason: t("material-no-changes") };
    for (const ref of this.channel.dirtyRefs()) {
      const result = await this.#parts.files.save(this.channel.saveRequest(ref, force));
      this.channel.saved(ref, result);
      if (!result.ok) return result;
      last = result;
    }
    return last;
  }

  /** Call `listener` after each change of the materials or of the material of the panel; the result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #queue(docs: MaterialEdits): Promise<unknown> {
    const send = this.#sent.then(() => this.#parts.send(docs));
    this.#sent = send.catch((error: unknown) => console.warn(`the core refused a material: ${errorText(error)}`));
    return this.#sent;
  }

  #need(): ScenePageEditor {
    if (this.#editor === null) throw new Error("the material editor has no page editor yet");
    return this.#editor;
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
