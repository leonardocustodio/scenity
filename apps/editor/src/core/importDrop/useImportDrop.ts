// SPDX-License-Identifier: Apache-2.0
/**
 * Import by drop on the scene of the lab.
 *
 * - **The lab page alone**: a dropped GLTF, GLB, OBJ or FBX file shows at the drop point as a quick preview. The
 *   three.js loaders of the labs load it, and the label is "preview, not optimized". Nothing is saved.
 * - **In the workbench** (the browser path): the drop asks for the source and the licence of the file. Then it sends
 *   the file with its drop point to the workbench page (the bridge event `import`). The page uploads the file to the
 *   host, and the import job of the host builds it (Blender, meshopt, KTX2, the budgets). The quick preview shows
 *   during the job. The optimized model of the job replaces it (the bridge call `importPreview`).
 * - **In Scenity** (the desktop path): the native drag and drop of the shell does not give the drop to the web view.
 *   Thus the scene gets no `drop` event. The workbench page maps the window point of the drop of the shell to this
 *   frame. It calls `importDropAt` with the drop ID and the file name (bridgeCalls.ts), and it keeps the file path.
 *   The drop point and the questions are the same. The `import` event has no file, and no quick preview shows (the
 *   page cannot read the bytes). The built model of the job comes as a scratch prop.
 *
 * The refusals and the status texts are Fluent messages of `src/i18n/en-US/import.ftl`.
 */
import {
  extensionOf,
  IMPORT_FORMATS,
  previewFormat,
  type PickCamera,
  type PickResult,
  type PreviewModel,
} from "@scenity/runtime-dev";
import { getCurrentInstance, onBeforeUnmount, ref, shallowRef, type Ref } from "vue";
import { t } from "../../texts";
import { dropPoint, type DropPoint } from "./dropPoint";
import { previewStore, type DropAtResult, type LabImportApi, type ShownPreview } from "./previewStore";

/** What the drop uses of the room view (LabsRoomView). */
export interface ImportView {
  pick?(x: number, y: number, pane?: number): Promise<PickResult | null>;
  previews?(models: readonly PreviewModel[]): void;
}

/** The largest file of an import (bytes); the host has the same limit. */
export const IMPORT_MAX_BYTES = 200 * 1024 * 1024;

/** A drop that waits for the source and the licence (in the workbench). */
export interface PendingDrop {
  readonly drop: string;
  readonly name: string;
  /** The dropped file, or null for a drop of the desktop shell (the workbench page keeps its path). */
  readonly file: File | null;
  readonly point: DropPoint | null;
}

export interface ImportDrop {
  readonly dragging: Ref<boolean>;
  readonly pending: Ref<PendingDrop | null>;
  readonly previews: Ref<readonly ShownPreview[]>;
  readonly status: Ref<string | null>;
  inWorkbench(): boolean;
  onDragOver(event: DragEvent): void;
  onDragLeave(): void;
  onDrop(event: DragEvent): Promise<void>;
  /** Send the pending drop to the workbench with the answers of the owner. */
  send(source: string, licence: string): void;
  cancel(): void;
  remove(id: string): void;
}

/** The reason that a dropped file cannot be imported, or null. `alone`: the lab page without the workbench. */
export function refusal(file: { readonly name: string; readonly size: number }, alone: boolean): string | null {
  if (!(IMPORT_FORMATS as readonly string[]).includes(extensionOf(file.name))) {
    return t("import-refused-format", { name: file.name, formats: IMPORT_FORMATS.join(", ") });
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return t("import-refused-size", { name: file.name, mb: String(Math.round(file.size / 1048576)) });
  }
  if (alone && previewFormat(file.name) === null) {
    return t("import-refused-blender", { name: file.name });
  }
  return null;
}

/** The canvas point (CSS pixels) of a point of the page (`clientX`, `clientY` of a drop). */
function canvasPoint(clientX: number, clientY: number, scene: HTMLElement | null): { x: number; y: number } {
  const canvas = scene?.querySelector('[data-testid="room-3d-canvas"]');
  const box = (canvas ?? scene)?.getBoundingClientRect();
  return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
}

/** The parts of the drop that the drop of the desktop shell uses. */
interface ShellDropParts {
  readonly dragging: Ref<boolean>;
  readonly pending: Ref<PendingDrop | null>;
  readonly status: Ref<string | null>;
  inWorkbench(): boolean;
  pointAt(clientX: number, clientY: number): Promise<DropPoint | null>;
}

/**
 * The desktop path: a file of the shell at a point of the page (`importDropAt`). The host does the size check (the
 * page has no file).
 */
function shellDropAt(parts: ShellDropParts): NonNullable<LabImportApi["dropAt"]> {
  return async (info) => {
    parts.dragging.value = false;
    const refused = parts.inWorkbench()
      ? refusal({ name: info.name, size: 0 }, false)
      : t("import-refused-app", { name: info.name });
    parts.status.value = refused;
    if (refused !== null) return { refused } satisfies DropAtResult;
    const point = await parts.pointAt(info.x, info.y);
    parts.pending.value = { drop: info.drop, name: info.name, file: null, point };
    return { point: point?.at ?? null, on: point?.on ?? null };
  };
}

/** Give the import functions to `globalThis.__labImport` until the component unmounts. */
function publish(api: LabImportApi): void {
  globalThis.__labImport = api;
  if (getCurrentInstance() !== null) {
    onBeforeUnmount(() => {
      globalThis.__labImport = undefined;
    });
  }
}

export function useImportDrop(parts: { view: () => ImportView | null; scene: Ref<HTMLElement | null> }): ImportDrop {
  const dragging = ref(false);
  const pending = shallowRef<PendingDrop | null>(null);
  const store = previewStore((models) => parts.view()?.previews?.(models));
  const { status } = store;
  let lastCamera: PickCamera | null = null;
  let count = 0;
  const inWorkbench = (): boolean => globalThis.__workbench !== undefined;

  /**
   * The drop point at a point of the page: the pick of the core, or the floor under the pointer from the camera of the
   * last pick.
   */
  async function pointAt(clientX: number, clientY: number): Promise<DropPoint | null> {
    const { x, y } = canvasPoint(clientX, clientY, parts.scene.value);
    const pick = (await parts.view()?.pick?.(x, y)) ?? null;
    if (pick !== null) lastCamera = pick.camera;
    return dropPoint(pick, lastCamera, x, y);
  }

  async function onDrop(event: DragEvent): Promise<void> {
    dragging.value = false;
    const file = event.dataTransfer?.files[0];
    if (file === undefined) return;
    status.value = refusal(file, !inWorkbench());
    if (status.value !== null) return;
    const point = await pointAt(event.clientX, event.clientY);
    count += 1;
    if (inWorkbench()) pending.value = { drop: `drop-${String(count)}`, name: file.name, file, point };
    else await store.quick(file, point, null);
  }

  function send(source: string, licence: string): void {
    const drop = pending.value;
    if (drop === null) return;
    pending.value = null;
    const { file, name } = drop;
    const point = drop.point?.at ?? null;
    const answers = { source: source.trim(), licence: licence.trim() };
    globalThis.__workbench?.emit({ event: "import", drop: drop.drop, file, name, point, ...answers });
    status.value = t("import-sent", { name });
    // A drop of the shell has no bytes in the page: the built model of the job is the first model of the drop.
    if (file !== null) void store.quick(file, drop.point, drop.drop);
  }

  const dropAt = shellDropAt({ dragging, pending, status, inWorkbench, pointAt });
  publish({ ...store.api, dropAt, dragHint: (over) => (dragging.value = over) });

  return {
    dragging,
    pending,
    previews: store.previews,
    status,
    inWorkbench,
    onDragOver(event) {
      if (event.dataTransfer?.types.includes("Files") !== true) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      dragging.value = true;
    },
    onDragLeave() {
      dragging.value = false;
    },
    onDrop,
    send,
    cancel() {
      pending.value = null;
    },
    remove: (id) => {
      store.remove(id);
    },
  };
}
