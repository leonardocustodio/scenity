// SPDX-License-Identifier: Apache-2.0
/**
 * The inspector of the scene page in the edit mode. It gives the Vue panel to the panel "inspector" of the editor
 * window and connects it to the page. The panel edits through the scene channel of the page editor (one step for each
 * edit). A click on the canvas with no drag selects the entity under the pointer (Shift adds or removes it; a click on
 * nothing shows the scene). The page loads this module
 * only with `edit=1`, so the frames of the gallery do not change.
 *
 * The prefab documents of the instances come from the prefab set of the page editor (prefabs/pagePrefabs.ts), so
 * the panel shows the entities of an instance with their overrides and follows an apply to a prefab. The
 * prefab actions of the page open a prefab and apply or revert overrides (prefabs/prefabTools.ts).
 *
 * The panel shows the posed scene (the scene at the time of the clock; the base scene with no sequence). An
 * edit of the panel makes ops on the posed scene, and `unposeOps` turns them into the same change of the base scene.
 */
import type { InspectPort } from "../gizmo/freeDrag";
import { assetChoices, EditError, prefabPath, unposeOps } from "@scenity/editor-core";
import type { ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { PickHit } from "@scenity/runtime/protocol";
import type { ScenePageEditor } from "../sceneEditor";
import { prefabActions } from "../prefabs/prefabTools";
import { createInspector, type PickedPart, type InspectorPort, type InspectorState } from "./inspectorState";
import InspectorHost from "./InspectorHost.vue";
import { setPanelContent } from "../pageParts";
import "./inspector.css";
import { playing } from "../play/playState";
import { shallowRef } from "vue";
import { devServerAssets } from "../../assetBrowser/assetClient";
import type { AssetListEntry } from "../../assetBrowser/assetTypes";
import { currentShell } from "../../studio/shell/shell";
import LightingPanel from "../lighting/LightingPanel.vue";
import { pageKeys } from "../settings/pageKeys";

/** What the inspector reads of the page. */
export interface InspectorParts {
  readonly editor: ScenePageEditor;
  readonly registry: ComponentRegistry;
  readonly canvas: HTMLCanvasElement;
  /** The records of the asset manifest of the project. */
  readonly assets: readonly {
    readonly id: string;
    readonly kind: string;
    readonly files?: readonly { file: string }[];
  }[];
  /** The URL of the project folder and the path of the scene in it (for the prefab files). */
  readonly base: string;
  readonly scenePath: string;
  /** The selection of the page (the selection outline): the inspector shows it and follows each change of it. */
  readonly selection: PageSelectionPort;
  /** The inspect report of the core (the parts of a model for the keys of its material overrides). */
  readonly inspect?: InspectPort;
  pick(x: number, y: number): Promise<PickHit | null>;
}

/** The parts of the selection of the page that the inspector uses (`PageSelection` of selection.ts). */
export interface PageSelectionPort {
  readonly ids: readonly string[];
  set(ids: readonly string[]): void;
  listen(listener: (ids: readonly string[]) => void): () => void;
}

/** The inspector of the page. */
export interface PageInspector {
  readonly state: InspectorState;
}

/** The source file of each asset (the asset index of the project, scripts/projects.ts), for the asset pickers. */
async function assetSources(base: string): Promise<Record<string, string>> {
  const response = await fetch(`${base}assets.index.json`).catch(() => null);
  if (response?.ok !== true) return {};
  const index = (await response.json()) as Readonly<Record<string, { readonly path?: unknown }>>;
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(index)) if (typeof entry.path === "string") out[id] = entry.path;
  return out;
}

/** The Lighting window over the scene (no entity), with the environment maps of the project. */
function startLighting(parts: InspectorParts, port: InspectorPort): void {
  const maps = shallowRef<readonly AssetListEntry[]>([]);
  void devServerAssets(parts.base)
    .list()
    .then((list) => (maps.value = list.assets.filter((asset) => asset.kind === "environment")))
    .catch(() => undefined);
  void setPanelContent("lighting", {
    component: LightingPanel,
    props: {
      state: createInspector(port, []),
      maps: () => maps.value,
      base: parts.base,
      setLight: (entity: string, field: string, value: unknown) =>
        void pageKeys().execute("component.set", { entity, component: "light", field, value: JSON.stringify(value) }),
      select: (id: string) => parts.selection.set([id]),
      ask: () => currentShell()?.search.ask ?? null,
    },
    hostId: "scene-lighting",
  });
}

/** The part pick that waits for the next click of the canvas. */
interface PartWaiter {
  resolve: ((part: PickedPart | null) => void) | null;
  stop(): void;
}

/** The waiter of the part picks; Escape gives null. */
function partWaiter(canvas: HTMLCanvasElement): PartWaiter & { wait(): Promise<PickedPart | null> } {
  const waiter = {
    resolve: null as ((part: PickedPart | null) => void) | null,
    stop(): void {
      waiter.resolve = null;
      delete canvas.dataset.pickPart;
    },
    wait(): Promise<PickedPart | null> {
      waiter.resolve?.(null);
      canvas.dataset.pickPart = "1";
      return new Promise((resolve) => (waiter.resolve = resolve));
    },
  };
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || waiter.resolve === null) return;
    const resolve = waiter.resolve;
    waiter.stop();
    resolve(null);
  });
  return waiter;
}

/**
 * A click on the canvas (a press and a release within 4 pixels) selects the entity under it. In the play mode
 * a click goes to the input maps of the plugins only, so the selection stays.
 */
function listenClicks(parts: InspectorParts, state: InspectorState, waiter: PartWaiter): void {
  let press: { x: number; y: number } | null = null;
  parts.canvas.addEventListener("pointerdown", (event) => {
    press = event.button === 0 && !playing() ? { x: event.clientX, y: event.clientY } : null;
  });
  parts.canvas.addEventListener("pointerup", (event) => {
    const start = press;
    press = null;
    if (start === null || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const box = parts.canvas.getBoundingClientRect();
    const pick = parts.pick(event.clientX - box.left, event.clientY - box.top);
    // A click for a part pick names the part and keeps the selection.
    const resolve = waiter.resolve;
    if (resolve !== null) {
      waiter.stop();
      void pick.then((hit) =>
        resolve(hit?.target?.kind === "node" ? { entity: hit.entity, part: hit.target.id } : null),
      );
      return;
    }
    void pick.then((hit) => {
      const now = state.selected.value;
      if (hit === null) state.select(event.shiftKey ? now : []);
      else if (!event.shiftKey) state.select([hit.entity]);
      else state.select(now.includes(hit.entity) ? now.filter((id) => id !== hit.entity) : [...now, hit.entity]);
    });
  });
}

/** The document part of the port: the posed scene, and its edits as the same change of the base scene. */
function editorPort(
  editor: ScenePageEditor,
): Pick<InspectorPort, "doc" | "listen" | "edit" | "begin" | "move" | "end"> {
  // The base and posed scenes at the start of a live drag: each move of the drag starts again from them.
  let start: { readonly base: SceneDocument; readonly posed: SceneDocument } | null = null;
  return {
    doc: () => editor.posed(),
    listen: (listener) => editor.listenPosed(listener),
    edit: (ops, title) => editor.apply(unposeOps(editor.doc, editor.posed(), ops), title),
    begin: () => {
      start = { base: editor.doc, posed: editor.posed() };
      editor.channel.begin();
    },
    move: (ops) => {
      try {
        editor.channel.move(unposeOps(start?.base ?? editor.doc, start?.posed ?? editor.posed(), ops));
        return null;
      } catch (error) {
        if (error instanceof EditError) return error.message;
        throw error;
      }
    },
    end: (cancel) => {
      start = null;
      editor.channel.end(cancel);
      editor.changed();
    },
  };
}

/** Mount the inspector panel and connect it to the page. */
export async function startInspector(parts: InspectorParts): Promise<PageInspector> {
  const { editor } = parts;
  const sources = await assetSources(parts.base);
  // A prefab source is relative to the scene file, or an asset.
  const paths = editor.expander?.paths ?? { docPath: parts.scenePath };
  let echo = false;
  const waiter = partWaiter(parts.canvas);
  const port: InspectorPort = {
    pickPart: () => waiter.wait(),
    partKeys: async (entity) => {
      const report = await (parts.inspect?.() ?? Promise.resolve(null)).catch(() => null);
      const found = report?.entities.find((each) => each.id === entity)?.parts;
      return found === undefined ? [] : [...found.meshes.map((name) => `mesh:${name}`), ...found.materials];
    },
    registry: parts.registry,
    assets: assetChoices(parts.assets, sources),
    ...editorPort(editor),
    prefab: (source) => {
      const path = prefabPath(source, paths.docPath, paths.assetPath);
      return path === undefined ? undefined : editor.prefabs[path];
    },
    listenPrefabs: (listener) => editor.listenPrefabs(() => listener()),
    prefabs: () => prefabActions(editor),
    select: (ids) => {
      echo = true;
      try {
        parts.selection.set(ids);
      } finally {
        echo = false;
      }
    },
  };
  const state = createInspector(port, parts.selection.ids);
  // A selection of the script API or of another tool: the panel follows it. Its own selection is no news.
  parts.selection.listen((ids) => {
    if (!echo) state.follow(ids);
  });
  // The panel "inspector" of the editor window.
  listenClicks(parts, state, waiter);
  // A locked inspector keeps its entities in a state of its own (it does not follow the selection).
  const locked = new Map<string, InspectorState>();
  const keep = (ids: readonly string[]): InspectorState => {
    const key = ids.join(",");
    const found = locked.get(key) ?? createInspector(port, ids);
    locked.set(key, found);
    return found;
  };
  void setPanelContent("inspector", {
    component: InspectorHost,
    props: { state, locked: keep },
    hostId: "scene-inspector",
  }).then(() => (parts.canvas.dataset.inspector = "1"));
  startLighting(parts, port);
  return { state };
}
