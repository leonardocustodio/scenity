// SPDX-License-Identifier: Apache-2.0
/**
 * The models of the import by drop in the scene. The store has the list of the layer, the models with their bitmaps
 * for the core, and `globalThis.__labImport` (a lab marker, tools/lab-markers.ts) for the tools and the bridge. A quick
 * preview has the label "preview, not optimized". The model of an import job of the host replaces the quick preview of
 * its drop. The label and the status texts are Fluent messages of `src/i18n/en-US/import.ftl`.
 */
import { previewFormat, type PreviewModel } from "@scenity/runtime-dev";
import type { Vec3 } from "@scenity/character";
import { ref, shallowRef, type Ref } from "vue";
import type { DropPoint } from "./dropPoint";
import { t } from "../../texts";
import { loadPreview } from "./previewModel";

/** Where a model shows without a drop point: beyond the foot of the large prop in the middle of the room. */
export const DEFAULT_POINT: Vec3 = [0, 0, 1.8];
/** The label of a quick preview (the locale of the page does not change, so one text for the page is correct). */
export const QUICK_LABEL = t("import-quick-label");

/** A model in the scene, for the list of the layer. */
export interface ShownPreview {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly at: Vec3;
  readonly drop: string | null;
}

/** The import functions of the page (`globalThis.__labImport`). */
export interface LabImportApi {
  /** Show a model file (its bytes) at a point; a model of the same drop goes away. */
  show(
    bytes: ArrayBuffer,
    info: { readonly name: string; readonly point?: Vec3 | null; readonly label?: string; readonly drop?: string },
  ): Promise<{ readonly id: string; readonly triangles: number; readonly scale: number }>;
  /** The state of the import job of a drop (the workbench page tells it). */
  status(info: { readonly drop: string; readonly state: string; readonly text: string }): void;
  list(): readonly ShownPreview[];
  /** Remove one model, or all. */
  clear(id?: string): void;
  /**
   * The desktop path: a file of the drag and drop of Scenity at the point (x, y) of the page (CSS pixels). The
   * workbench page keeps the path of the file. The lab gets only its name and its drop ID. The lab asks for the source
   * and the licence, then sends the `import` event without a file. Only the drop layer of the scene has this function
   * (useImportDrop.ts).
   */
  dropAt?(info: {
    readonly drop: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
  }): Promise<DropAtResult>;
  /** The desktop path: a file of the shell is over the scene (true) or not (false). The hint shows when it is over. */
  dragHint?(over: boolean): void;
}

/** The answer of `dropAt`: the drop point (null: no point), or the reason of a refusal. */
export type DropAtResult =
  { readonly point: Vec3 | null; readonly on: DropPoint["on"] | null } | { readonly refused: string };

declare global {
  // The import preview of the lab page: the tools and the workbench bridge call it.
  var __labImport: LabImportApi | undefined;
}

export interface PreviewStore {
  readonly previews: Ref<readonly ShownPreview[]>;
  readonly status: Ref<string | null>;
  readonly api: LabImportApi;
  remove(id: string): void;
  /** The quick preview of a dropped file at its point; a failure shows in the status. */
  quick(file: File, point: DropPoint | null, drop: string | null): Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The store of the models; `apply` gives the models to the core (LabsRoomView `previews`). */
export function previewStore(apply: (models: readonly PreviewModel[]) => void): PreviewStore {
  const previews = shallowRef<readonly ShownPreview[]>([]);
  const status = ref<string | null>(null);
  /** The models with their bitmaps: not reactive. */
  const models = new Map<string, PreviewModel>();
  let count = 0;

  function remove(id: string): void {
    models.delete(id);
    previews.value = previews.value.filter((item) => item.id !== id);
    apply([...models.values()]);
  }

  const show: LabImportApi["show"] = async (bytes, info) => {
    const format = previewFormat(info.name);
    if (format === null) throw new Error(`${info.name}: the lab shows .glb, .gltf, .obj and .fbx files`);
    count += 1;
    const id = `import-${String(count)}`;
    const at = info.point ?? DEFAULT_POINT;
    const made = await loadPreview(bytes, { id, name: info.name, at, format });
    const drop = info.drop ?? null;
    const replaced = previews.value.filter((item) => drop !== null && item.drop === drop);
    for (const item of replaced) models.delete(item.id);
    models.set(id, made);
    const shown = { id, name: info.name, label: info.label ?? QUICK_LABEL, at, drop };
    previews.value = [...previews.value.filter((item) => !replaced.includes(item)), shown];
    apply([...models.values()]);
    return { id, triangles: made.triangles, scale: made.scale };
  };

  async function quick(file: File, point: DropPoint | null, drop: string | null): Promise<void> {
    if (previewFormat(file.name) === null) return;
    try {
      const info = { name: file.name, point: point?.at ?? null, ...(drop === null ? {} : { drop }) };
      await show(await file.arrayBuffer(), info);
    } catch (error) {
      status.value = t("import-no-preview", { name: file.name, error: errorText(error) });
    }
  }

  const api: LabImportApi = {
    show,
    status: (info) => {
      status.value = info.text;
    },
    list: () => previews.value,
    clear: (id) => {
      if (id !== undefined) remove(id);
      else for (const item of previews.value) remove(item.id);
    },
  };
  return { previews, status, api, remove, quick };
}
