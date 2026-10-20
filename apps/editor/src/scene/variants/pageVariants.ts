// SPDX-License-Identifier: Apache-2.0
/**
 * The variants of the open scene: the override layers that the scene names in `variants` (`scenity.overrides/1`,
 * docs/formats.md). The editor can do these operations:
 *
 * - show a variant in the view. The core gets the scene with the ops of the layer, and the document of the editor
 *   stays the base scene. An edit while a variant shows goes to the base scene. Then the view shows the base scene
 *   again.
 * - make a variant from the edits since the last save. The layer is the change from the saved scene to the current
 *   scene (`variantFromDiff`). The file of the layer goes adjacent to the scene file, and the scene names it. Then the
 *   scene returns to the saved values as one step, and the edits are only in the variant.
 * - take a picture of a variant (the compare wipe), and apply a variant to the base scene as one step.
 */
import { applyLayers, diffDocuments, readDocument, variantFromDiff, variantNames, writeDocument } from "@scenity/scene";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { OverridesDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { shallowRef, type ShallowRef } from "vue";
import type { ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { t } from "../../texts";

/** The base scene: no variant. */
export const BASE = "";

/** What the variants read of the page. */
export interface VariantParts {
  readonly editor: ScenePageEditor;
  readonly files: SceneFilePort;
  readonly registry: ComponentRegistry;
  /** Send ops only to the core (the document of the editor does not change). */
  patch(ops: readonly SceneOp[]): Promise<unknown>;
}

/** The file name part of a variant name: lower case words with `-`. */
export function variantSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The path of the layer file of a new variant adjacent to the scene file, and its path relative to the scene file. */
export function variantFile(scenePath: string, name: string): { readonly path: string; readonly relative: string } {
  const base = scenePath.replace(/\.scene\.json$/, "");
  const file = `${base.slice(base.lastIndexOf("/") + 1)}.${variantSlug(name)}.overrides.json`;
  const folder = scenePath.includes("/") ? scenePath.slice(0, scenePath.lastIndexOf("/") + 1) : "";
  return { path: `${folder}${file}`, relative: file };
}

/** The path of a project file from the path of the scene file and a path relative to it. */
function resolved(scenePath: string, relative: string): string {
  const parts = scenePath.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export class PageVariants {
  /** The variant that shows in the view (BASE: the base scene). */
  readonly shown: ShallowRef<string> = shallowRef(BASE);
  readonly error: ShallowRef<string | null> = shallowRef(null);
  readonly #parts: VariantParts;
  /** The layer of each variant that the page read. */
  readonly #layers = new Map<string, OverridesDocument>();
  /** The scene that the core shows, and the document of the editor at that time. */
  #core: { readonly shown: SceneDocument; readonly base: SceneDocument } | null = null;

  constructor(parts: VariantParts) {
    this.#parts = parts;
    parts.editor.listen(() => void this.#edited());
  }

  /** The names of the variants of the scene, in sorted order. */
  names(): string[] {
    return variantNames(this.#parts.editor.doc);
  }

  /** The layer of a variant (read once from its file). */
  async layer(name: string): Promise<OverridesDocument> {
    const known = this.#layers.get(name);
    if (known !== undefined) return known;
    const { editor, files } = this.#parts;
    const relative = editor.doc.variants?.[name];
    if (relative === undefined) throw new Error(`no variant "${name}"`);
    const read = readDocument((await files.read(resolved(editor.file.path, relative))).text, "overrides");
    if (!read.ok) throw new Error(read.errors[0]?.message ?? "the variant does not read");
    this.#layers.set(name, read.doc);
    return read.doc;
  }

  /** The scene of a variant: the base scene with the ops of its layer (BASE: the base scene). */
  async scene(name: string): Promise<SceneDocument> {
    const base = this.#parts.editor.doc;
    if (name === BASE) return base;
    return applyLayers(base, [await this.layer(name)], this.#parts.registry).doc;
  }

  /** Show a variant in the view (BASE: the base scene again). */
  async show(name: string): Promise<void> {
    try {
      const next = await this.scene(name);
      const now = this.#core?.shown ?? this.#parts.editor.doc;
      await this.#parts.patch(diffDocuments(now, next));
      this.#core = name === BASE ? null : { shown: next, base: this.#parts.editor.doc };
      this.shown.value = name;
      this.error.value = null;
    } catch (error) {
      this.error.value = error instanceof Error ? error.message : String(error);
    }
  }

  /** An edit while a variant shows. The core has the edit on the variant, and this call sets the base scene again. */
  async #edited(): Promise<void> {
    const core = this.#core;
    if (core === null) return;
    this.#core = null;
    this.shown.value = BASE;
    const edits = diffDocuments(core.base, this.#parts.editor.doc);
    const applied = applyLayers(
      core.shown,
      [{ format: "scenity.overrides/1", scene: core.shown.id, ops: edits }],
      this.#parts.registry,
    );
    await this.#parts.patch(diffDocuments(applied.doc, this.#parts.editor.doc)).catch(() => undefined);
  }

  /**
   * Make a variant of the edits since the last save. Write its layer file, name it in the scene, and return the scene
   * to the saved values as one step. The result is the reason of a refusal, or null.
   */
  async makeFromEdits(name: string): Promise<string | null> {
    const { editor, files, registry } = this.#parts;
    const slug = variantSlug(name);
    if (slug === "") return t("variants-no-name");
    const saved = readDocument(editor.file.baseText, "scene", { registry });
    if (!saved.ok) return t("variants-saved-unread");
    const layer = variantFromDiff(saved.doc, editor.doc, name);
    if (layer.ops.length === 0) return t("variants-no-edits");
    const file = variantFile(editor.file.path, slug);
    const result = await files.save({ path: file.path, text: writeDocument(layer), baseHash: null });
    if (!result.ok) return "reason" in result ? result.reason : t("variants-not-written");
    this.#layers.set(slug, layer);
    const back: SceneDocument = { ...saved.doc, variants: { ...(editor.doc.variants ?? {}), [slug]: file.relative } };
    return editor.apply(diffDocuments(editor.doc, back), t("variants-history-make", { name }));
  }

  /** Apply the ops of a variant to the base scene as one step. The result is the reason of a refusal, or null. */
  async applyToBase(name: string): Promise<string | null> {
    const next = await this.scene(name);
    if (this.#core !== null) await this.show(BASE);
    return this.#parts.editor.apply(diffDocuments(this.#parts.editor.doc, next), t("variants-history-apply", { name }));
  }
}
