// SPDX-License-Identifier: Apache-2.0
/**
 * The scene page of the editor: it draws a scene document of a Scenity project with the document core of
 * `@scenity/runtime`: in the generic scene worker, or on the main thread with `worker=0`. The page sends the documents
 * and the asset manifest in one "load" message and each edit as a "patch".
 *
 *   /scene.html?project=showroom[&scene=scenes/main.scene.json][&camera=front][&worker=0][&assets=source]
 *   /scene.html?project=gltf-samples&scene=scenes/unlit-test.scene.json&backend=webgpu
 *   /scene.html?project=characters[&sequence=sequences/walk-wave.sequence.json][&t=2500][&paused=1]
 *
 * With a sequence (the `sequence` parameter, else the first sequence of the project), the page clock plays it from `t`.
 * With `paused=1`, the clock stands at `t`. The core shows the scene and the animated models at the clock time.
 *
 * The page loads the built outputs through the asset manifest when the project has a build, else the source files.
 * `assets=source` takes the source files (scene/assets.ts). `backend=webgpu` draws with the WebGPU core on the main
 * thread: the generic scene worker draws with WebGL only. `data-assets` and `data-backend` on the canvas show which.
 *
 * On the dev server, a new import of an asset of the project replaces the asset in the open scene with no page reload
 * (scene/hotReload.ts). `__scenity.reloads()` lists the reloads, and `data-reloads` on the canvas counts them.
 *
 * The page plays the sounds of the core (scene/audio.ts; `audio=0`: no sound) from the first key or pointer press.
 *
 * `tier=ultra|high|medium|low` sets the quality tier (default "high"): the frame cap, the shadows, the lights and the
 * cap of the level of detail of each model. `gpu=1` enables the GPU timer of the stats. The stats give the draw calls,
 * the triangles, the instances and the entities in the view of the last frame. They also give the 95th percentiles of
 * the frame work and of the GPU time. `stats(true)` starts a new window of the percentiles.
 *
 * The open scene document is state of the editor (scene/sceneEditor.ts). `apply`, `undo` and `redo` go through the
 * scene channel of `@scenity/editor-core` (one history; each change goes to the core as a "patch"). With `edit=1` the
 * page has the file bar, the local draft, the entity drag and the save (scene/editMode.ts):
 *
 *   /scene.html?project=showroom&camera=front&edit=1
 *
 * The edit mode also has the inspector panel on the right (scene/inspector). The widgets of each component come from
 * its schema and editor hints, and the project plugins add their components (scene/pageRegistry.ts). A click on the
 * canvas selects an entity. Each edit of the panel is scene ops and one step of the history.
 *
 * The edit mode also has the hierarchy panel on the left (scene/hierarchy). It has the entity tree, a drag to change
 * the parent, rename, search, hide (a document value), solo and lock (editor view values that the file never keeps). It
 * also has multi-select with the selection of the page. Each action is a command with one step of the history. The
 * script API runs the same commands (`command`, `commands`, `view`). A locked entity takes no pick, so no select or
 * drag.
 *
 * With a sequence, the edit mode also has the sequencer, a tab of the bottom dock (scene/sequencer). It has a track
 * list per entity, the keys on a time ruler, markers, the curve editor and the play bar with the loop between A and B.
 * It also has the record mode (an edit at the time of the clock becomes a key). Each change is a command and one step
 * of the history. Save writes the sequence file too, and the core plays the edited sequence immediately.
 *
 * The edit mode also has the transform gizmos of the selection (scene/gizmo, a lazy chunk): move, turn and scale
 * handles on an overlay canvas, world or local axes, the pivot or the centre, the grid, angle and scale snaps. A free
 * move snaps to surfaces (from the boxes of the inspect report) and sockets. The W, E and R keys and keyboard values
 * also control the gizmos. Each gizmo drag is one step of the history. `__scenity.gizmo()` and `setGizmo` drive them.
 *
 * The edit mode also has the play mode (scene/play). Play in the file bar plays the sequence from 0 ms on a play state.
 * An edit in the play mode changes only the play state. Stop gives back the edit state, and Keep applies the chosen
 * changes as one step. The gizmo and the inspector show the posed scene (the scene at the clock time). "Play in a
 * window" opens the player page (player/play.html) with the current documents.
 *
 * The edit mode also has the viewport (scene/viewport, a lazy chunk): the editor camera (orbit, pan, zoom, fly, F
 * frames the selection), the camera menu, the grid and the axes, the view modes, the icons of the lights and the
 * cameras, and the camera preview. The editor camera is not in the document. `__scenity.viewport()` drives it.
 *
 * `sel=<entity>[,<entity>…]` or `__scenity.select(ids)` selects entities, and the core draws their outline
 * (scene/selection.ts). The effect values of the `environment` component draw under the caps of the tier. The stats
 * give the names of the effects of the last frame (`effects`).
 *
 * The page draws with the dev document core of `@scenity/runtime-dev` (the dev scene worker, or the main thread).
 * `debug=bounds,skeleton` enables debug layers, and `inspect=1` (or the I key) opens the inspect panel.
 * `__scenity.inspect()` gives the inspect report (scene/devTools.ts). With no layer, the frames do not change.
 *
 * In a frame of a workbench surface (`workbench=<origin>`), the page serves the workbench bridge
 * (scene/sceneBridge.ts). The bridge has the base calls, `scene.query`, `commands`, `command` and the methods of the
 * script API. Thus the host tools `scene_query`, `scene_commands` and `scene_command` reach the page. A run of Claude
 * waits as a proposal.
 *
 * The document core runs the runtime faces of the project plugins: their components, presenters, simulations and
 * systems. The page worker (scene/sceneWorker.ts) loads them from `virtual:scenity/project-plugins` of its own build.
 * The main-thread core gets them from the same module on the page.
 *
 * The script API `globalThis.__scenity` gives the tests and the tools the frame, the ops, the cameras, the pick and the
 * stats. The runtime draws the expanded document (the entities of each prefab instance, scene/prefabs).
 * `scene=<path>.prefab.json` opens a prefab in the prefab mode. The page sets `data-ready="1"` on the canvas when it
 * draws the first frame with every asset. It sets `data-renderer` to the path that draws ("worker" or "main").
 */
import type { UiApi } from "./uiCalls";
import type { SceneDocument, SceneOp } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { DocumentClient } from "@scenity/runtime/documentClient";
import { createDevDocumentClient, type DevDocumentClient } from "@scenity/runtime-dev/document/client";
import type { AudioFrame, EditorView, PickHit, PickOptions } from "@scenity/runtime/protocol";
import { tierOf } from "./tier";
import { t } from "../texts";
// The dev scene worker with the inspect report, the debug layers and the project plugins.
import sceneWorkerUrl from "./sceneWorker?worker&url";
import { loadProjectDevPlugins, loadProjectPlugins } from "virtual:scenity/project-plugins";
import type { AudioPlayer, StartedSound } from "@scenity/runtime/audio";
import { pageAudio } from "./audio";
import { PageClock, readSequence } from "./clock";
import { readAssets } from "./assets";
import { listenAssetReloads, type AssetReload } from "./hotReload";
import { DECODERS } from "./decoders";
import { editApi, preloadEditParts, startEditor, startPage, type EditParts } from "./editMode";
import { liveProjectRules, pageRuleChecker } from "./pageRules";
import type { RuleCheckRequest } from "@scenity/runtime-dev/document/ruleCheck";
import type { SceneCommandApi } from "./hierarchy/sceneCommands";
import type { PageSaveResult, ScenePageEditor } from "./sceneEditor";
import { devServerFiles } from "./sceneFiles";
import { sequenceEditParts } from "./sequencer/sequenceParts";
import { isPrefabPath, pageDocument, prefabLoad, sequencePathOf } from "./prefabs/pagePrefabs";
import type { SequenceApi } from "./sequencer/pageSequence";
import type { WalksApi } from "./walks/startWalks";
import type { GizmoApi } from "./gizmo/startGizmo";
import type { PlayApi } from "./play/pagePlay";
import { PlayInputLink } from "./play/playInput";
import { linkPage } from "./pageLink";
import { renderParams } from "./settings/renderParams";
import type { ViewportApi, ViewportPort } from "./viewport/viewportTypes";
import type { ScenesApi } from "./projects/sceneSwitcher";
import { showNoProject } from "./projects/noProject";
import type { LayoutToolsApi } from "./layoutTools/startLayoutTools";
import type { SettingsApi } from "./settings/startEditorSettings";
import { PageSelection, selectionParam, type SelectionApi } from "./selection";
import { startDevTools, type DevToolsApi } from "./devTools";
import { startPageBridges, type SceneBridgeParts } from "./studioBridge";

/** The frame statistics of the scene page. */
export interface ScenePageStats {
  readonly mode: "worker" | "main";
  /** The backend that draws. */
  readonly backend: string;
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly entities: number;
  /** The quality tier, the entities that draw through an instance batch, and the entities in the view. */
  readonly tier: string;
  readonly instances: number;
  readonly visibleEntities: number;
  /** The frames of the window and the 95th percentiles of the frame work and of the GPU time (null: no timer), ms. */
  readonly frames: number;
  readonly workP95: number;
  readonly gpuP95: number | null;
  /** The post-processing effects of the last frame after the tier caps. */
  readonly effects: readonly string[];
}

/** The script API of the scene page. */
export interface ScenePageApi
  extends
    Partial<SelectionApi>,
    Partial<DevToolsApi>,
    Partial<SceneCommandApi>,
    Partial<GizmoApi>,
    Partial<WalksApi>,
    Partial<SequenceApi>,
    Partial<PlayApi>,
    Partial<ViewportApi>,
    Partial<LayoutToolsApi>,
    Partial<ScenesApi>,
    Partial<SettingsApi>,
    Partial<UiApi> {
  /** Draw a frame and wait for the next paint. */
  frame(): Promise<void>;
  /** Apply ops to the document as one step of the history and draw; the reason of a refusal, or null. */
  apply(ops: SceneOp[]): Promise<string | null>;
  /** Move one step back or forward in the history and draw; false at the end of the history. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /** The scene file: its path, the hash of the disk text at the load or the last save, the dirty state. */
  file(): { readonly path: string; readonly baseHash: string | null; readonly dirty: boolean };
  /**
   * With `edit=1`: save the scene file (`force`: also over a file that changed on the disk). With a `reason`, the save
   * continues while a `block` rule fails.
   */
  save(force?: boolean, reason?: string): Promise<PageSaveResult>;
  camera(name: string | null): Promise<boolean>;
  cameras(): string[];
  document(): SceneDocument;
  /** The stats of the last frame; `reset` starts a new window of the percentiles. */
  stats(reset?: boolean): Promise<ScenePageStats>;
  /** The entity under a point of the canvas (CSS pixels), or null. */
  pick(x: number, y: number, options?: PickOptions): Promise<PickHit | null>;
  /** With a sequence: stand at a time (ms) and wait for its frame. */
  seek?(t: number): Promise<void>;
  /** The time of the page clock (ms). */
  time?(): number;
  /** True while the page clock plays. */
  playing?(): boolean;
  play?(): void;
  pause?(): void;
  /** The starts of the voices (the debug list of the audio player), oldest first. */
  sounds?(): readonly StartedSound[];
  /** The state of the audio context: "none", "suspended", "running" or "closed". */
  audioState?(): string;
  /** On the dev server: the hot reloads of assets, oldest first. */
  reloads?(): readonly AssetReload[];
}

declare global {
  var __scenity: ScenePageApi | undefined;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function surfaceOf(canvas: HTMLCanvasElement) {
  return { width: canvas.clientWidth, height: canvas.clientHeight, dpr: globalThis.devicePixelRatio };
}

/** The camera of the page: a document camera, and the view of the editor camera while it draws. */
interface PageCamera {
  camera: string | null;
  editor: EditorView | null;
}

/** The script API over a client and the editor of the page (the editor keeps the document). */
function pageApi(client: DocumentClient, editor: ScenePageEditor, view: PageCamera): ScenePageApi {
  const frame = async (): Promise<void> => {
    // An empty patch answers after the next frame of the core.
    await client.patch([]);
    await nextPaint();
  };
  const step = async (done: boolean): Promise<boolean> => {
    await editor.settled();
    await nextPaint();
    return done;
  };
  return {
    frame,
    async apply(ops) {
      const reason = editor.apply(ops);
      if (reason !== null) return reason;
      await step(true);
      return null;
    },
    undo: () => step(editor.channel.undo()),
    redo: () => step(editor.channel.redo()),
    file: () => ({ path: editor.file.path, baseHash: editor.file.baseHash, dirty: editor.dirty }),
    save: (force, reason) => editor.save(force, reason),
    async camera(name) {
      const found = await client.useCamera(name);
      if (!found) return false;
      view.camera = name;
      view.editor = null;
      await frame();
      return true;
    },
    cameras: () =>
      Object.keys(editor.doc.entities)
        .filter((id) => editor.doc.entities[id]?.components.camera !== undefined)
        .sort(),
    document: () => editor.doc,
    async stats(reset = false) {
      const stats = await client.stats(reset);
      return {
        mode: stats.mode,
        backend: stats.backend ?? "webgl",
        calls: stats.drawCalls,
        triangles: stats.triangles,
        geometries: stats.memory?.geometries ?? 0,
        textures: stats.memory?.textures ?? 0,
        entities: stats.entities ?? 0,
        tier: stats.tier,
        instances: stats.instances ?? 0,
        visibleEntities: stats.visibleEntities ?? 0,
        frames: stats.frames,
        workP95: stats.workP95,
        gpuP95: stats.gpu?.p95 ?? null,
        effects: stats.effects ?? [],
      };
    },
    pick: (x, y, options) => client.pickEntity(x, y, options),
  };
}

/** The time part of the script API: a seek sends a new seek count and draws; the audio follows. */
function timeApi(
  client: DocumentClient,
  clock: PageClock,
  frame: () => Promise<void>,
  audio: AudioPlayer | null,
): Partial<ScenePageApi> {
  return {
    async seek(t) {
      clock.seek(t);
      audio?.sync();
      // The input message carries the clock anchor of a new seek count: the worker takes the time as it is.
      client.setInput(null);
      await frame();
    },
    time: () => clock.now(),
    playing: () => clock.playing,
    play: () => {
      clock.play();
      audio?.sync();
      client.setInput(null);
    },
    pause: () => {
      clock.pause();
      audio?.sync();
      client.setInput(null);
    },
  };
}

/** The audio part of the script API. */
function audioApi(audio: AudioPlayer | null): Partial<ScenePageApi> {
  return audio === null ? {} : { sounds: () => audio.started, audioState: () => audio.state };
}

/** The page clock of a sequence from `t` and `paused`, or null for a scene with no sequence. */
function clockOf(
  params: URLSearchParams,
  sequence: { readonly duration: number; readonly loop?: boolean | undefined } | null,
): PageClock | null {
  if (sequence === null) return null;
  const start = Number(params.get("t") ?? 0);
  const at = Number.isFinite(start) ? start : 0;
  return new PageClock(sequence.duration, sequence.loop === true, at, params.get("paused") !== "1");
}

/**
 * The dev document client of the page: the dev scene worker, or the main thread with `worker=0` or a WebGPU choice.
 * A failure of the core marks the state and shows the error.
 */
function pageClient(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  parts: {
    readonly selection: PageSelection;
    readonly clock: PageClock | null;
    readonly audio: AudioPlayer | null;
    readonly state: { failed: boolean };
    readonly project: string;
    readonly input: PlayInputLink;
  },
): Promise<DevDocumentClient> {
  const { selection, clock, audio, state, project, input } = parts;
  const gpu = params.get("backend") === "webgpu";
  return createDevDocumentClient(canvas, {
    // The link also carries the input events of the play mode.
    link: (link) => linkPage(link, selection, input),
    workerUrl: params.get("worker") === "0" || gpu ? null : sceneWorkerUrl,
    // The worker loads the plugins of the project; the main-thread core gets the page loaders.
    init: { plugins: project },
    plugins: () => loadProjectPlugins(project),
    metrics: () => loadProjectDevPlugins(project),
    ...(gpu ? { backend: { backend: "webgpu", reason: "url_override", adapter: null, ms: 0 } as const } : {}),
    getSimMs: () => clock?.now() ?? null,
    getClockEpoch: () => clock?.epoch ?? 0,
    surface: surfaceOf(canvas),
    tier: tierOf(params.get("tier")),
    gpuTimer: params.get("gpu") === "1",
    flags: { reducedMotion: false, paused: false, visible: true },
    onFailure: (reason) => {
      state.failed = true;
      showError(new Error(reason));
    },
    ...(audio === null ? {} : { onAudio: (frame: AudioFrame) => audio.frame(frame) }),
  });
}

async function start(): Promise<void> {
  const params = renderParams(new URLSearchParams(location.search));
  const project = params.get("project");
  if (project === null) return showNoProject(document.getElementById("status")); // The Hub, no default project.
  if (!/^[a-z0-9-]+$/.test(project)) throw new Error(t("scene-error-project", { project }));
  const base = `/projects/${project}/`;
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  if (canvas === null) throw new Error(t("scene-error-no-canvas"));
  const scenePath = params.get("scene") ?? "scenes/main.scene.json";
  const sceneFiles = devServerFiles(base);
  // The lazy parts of the edit mode load while the scene and the assets load.
  if (params.get("edit") === "1") preloadEditParts();
  const [sceneFile, assets, sequence] = await Promise.all([
    sceneFiles.read(scenePath),
    readAssets(base, params.get("assets"), DECODERS),
    readSequence(base, await sequencePathOf(params, base, scenePath)),
  ]);
  const { scene, registry, prefabs } = await pageDocument(params, scenePath, sceneFile.text, sceneFiles);
  const clock = clockOf(params, sequence);
  const state = { failed: false };
  const audio = pageAudio(params, clock, assets);
  const gpu = params.get("backend") === "webgpu";
  const selection = new PageSelection();
  const input = new PlayInputLink();
  const client = await pageClient(canvas, params, { selection, clock, audio, state, project, input });
  Object.assign(canvas.dataset, { renderer: client.mode, backend: gpu ? "webgpu" : "webgl", assets: assets.origin });
  const documents = { scene, ...(sequence === null ? {} : { sequence }), ...prefabs.documents };
  const { manifest, files, decoders } = assets;
  const tier = tierOf(params.get("tier"));
  // The selection of the URL goes before the load, so the first frame shows its outline.
  selection.set(selectionParam(params.get("sel")));
  // The debug layers of the URL go before the load too.
  const dev = startDevTools(params, client, () => client.patch([]).then(() => undefined));
  const loaded = await client.load({ documents, manifest, files, decoders, tier });
  if (!loaded.ok) throw new Error(loaded.reason);
  const view: PageCamera = { camera: params.get("camera"), editor: null };
  const editor = startEditor({
    ...{ params, canvas, project, path: scenePath, doc: scene, diskText: sceneFile.text, files: sceneFiles },
    patch: (ops) => client.patch(ops),
    pick: (x, y) => client.pickEntity(x, y),
    input,
    camera: () => view.camera,
    // The editor camera of the viewport; the drag, the gizmos and the drop use the camera that draws.
    editorView: () => view.editor,
    viewport: viewportPort(client, view, dev),
    ...{ selection, assets: manifest.records, registry, prefabs, loadPrefabs: prefabLoad(client) },
    // The gizmos and the entity drag take the surfaces of the snap from the inspect report.
    ...{ inspect: () => client.inspect(), stats: () => client.stats() },
    materials: (docs) => client.load({ materials: docs }),
    ...(await ruleCheckOf(params, base, client, sequence)),
    ...(await sequenceEditParts({ params, base, client, clock, audio, sequence })),
  });
  const api = { ...pageApi(client, editor, view), ...editApi(editor) };
  if (!(await api.camera(view.camera))) throw new Error(t("scene-error-no-camera", { camera: view.camera ?? "" }));
  const timed = clock === null ? {} : timeApi(client, clock, () => api.frame(), audio);
  const hot = import.meta.hot;
  const reloads =
    hot === undefined
      ? null
      : listenAssetReloads(hot, project, base, { manifest, files }, client, () => {
          canvas.dataset.reloads = String(reloads?.length ?? 0);
        });
  globalThis.__scenity = {
    ...api,
    ...timed,
    ...audioApi(audio),
    ...selection.api(() => api.frame()),
    ...dev.api,
    ...(reloads === null ? {} : { reloads: () => reloads }),
  };
  // The workbench bridge when a workbench surface shows the page (`workbench=<origin>` in a frame).
  startPageBridges(bridgeParts(client, view, clock, { scenePath, diskText: sceneFile.text }), project, () => scenePath);
  new ResizeObserver(() => client.setSurface(surfaceOf(canvas))).observe(canvas); // The dock changes the size of the canvas.
  if (params.get("inspect") === "1") await dev.open();
  if (!state.failed) canvas.dataset.ready = "1";
}

/** The parts of the bridge: the camera preview, the pick, the page clock and the scene file on the disk. */
function bridgeParts(
  client: DevDocumentClient,
  view: PageCamera,
  clock: PageClock | null,
  file: { readonly scenePath: string; readonly diskText: string },
): SceneBridgeParts {
  return {
    ...file,
    preview: (camera, width, at) => client.previewCamera(camera, width, at),
    camera: () => view.camera,
    simMs: () => clock?.now() ?? null,
    pick: (x, y, options) => client.pickEntity(x, y, options as PickOptions),
    hot: import.meta.hot,
  };
}

/** The port of the viewport: the editor camera, the document cameras, the view layers and the previews. */
function viewportPort(
  client: DevDocumentClient,
  view: PageCamera,
  dev: { setViewLayers(layers: readonly string[]): Promise<void> },
): ViewportPort {
  return {
    useEditor: (pose) => {
      view.editor = pose;
      void client.useCamera(view.camera, pose);
    },
    openCamera: (name) => globalThis.__scenity?.camera(name) ?? Promise.resolve(false),
    setViewLayers: (layers) => dev.setViewLayers(layers),
    previewCamera: (name, width) => client.previewCamera(name, width),
    setPanes: (panes) => client.setPanes(panes),
    setOnion: (spec) => client.setOnion(spec),
    setGhosts: (spec) => client.setGhosts(spec),
    previewClip: (preview) => client.previewClip(preview),
  };
}

/** The rule check of a save (the scene, the project, the sequence) and of the rules tab; none in the prefab mode. */
async function ruleCheckOf(
  params: URLSearchParams,
  base: string,
  client: DevDocumentClient,
  sequence: SequenceDocument | null,
): Promise<Pick<EditParts, "checkRules" | "rules">> {
  if (params.get("edit") !== "1" || isPrefabPath(params.get("scene") ?? "")) return {};
  const project = await liveProjectRules(base);
  const checkRules = (request: RuleCheckRequest) => client.checkRules(request);
  return { checkRules: pageRuleChecker({ project, sequence, checkRules }), rules: { project, checkRules } };
}

function showError(error: unknown): void {
  const status = document.querySelector("#status");
  const reason = error instanceof Error ? error.message : String(error);
  if (status !== null) status.textContent = t("scene-error", { reason });
  console.error(error);
}

(startPage(location.search) ?? start()).catch(showError);
