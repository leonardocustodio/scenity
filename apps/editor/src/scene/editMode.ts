// SPDX-License-Identifier: Apache-2.0
/**
 * The edit mode of the scene page (`edit=1`): the file bar, the local draft, the entity drag, the keys (⌘S saves, ⌘Z
 * undoes, ⇧⌘Z redoes: commands of the key map) and a disk check at each focus of the window. Without `edit=1` the page
 * draws only the scene (the gallery frames), and its script API edits through the scene channel.
 *
 * The edit mode also has the commands of the page (hierarchy/sceneCommands.ts) and the hierarchy panel on the
 * left side; the script API runs the same commands (`command`, `commands`, `view`).
 *
 * With a sequence, the edit mode also has the open sequence (sequencer/pageSequence.ts: a channel of the one
 * history, the record mode, the commands and the file) and the sequencer tab of the bottom dock.
 *
 * The edit mode also has the play mode (play/pagePlay.ts): Play, Stop, Keep and "Play in a window" in the
 * file bar; an edit during the play mode changes only the play state.
 *
 * The edit mode also has the entity commands: ⌘D, Delete or Backspace, ⌘C and ⌘V (entityKeys.ts), the
 * clipboard of the project (pageClipboard.ts), and the drop of an asset tile into the viewport (assetDrop.ts).
 *
 * The edit mode also has the proposal card (proposalCard.ts): the edits of Claude that wait for the owner.
 *
 * The edit mode also has the viewport (viewport/startViewport.ts, a lazy chunk): the editor camera, the camera
 * menu, the grid, the view modes, the icons and the camera preview. The drag, the gizmos and the drops use the camera
 * that draws (the editor camera or the document camera).
 *
 * The edit mode also has the prefab tools (prefabs/prefabTools.ts). Save writes the changed prefab files after the
 * scene. The inspector and the hierarchy open a prefab and apply or revert the overrides of an instance.
 *
 * The edit mode also has the layout tools (layoutTools/startLayoutTools.ts, a lazy chunk): measure, reach
 * spheres, clearance, walk paths and visibility, with a tool menu, a readout and an overlay canvas.
 *
 * The edit mode also has the material editor (material/pageMaterials.ts, its panel a tab of the bottom dock):
 * the open material assets are a channel of the one history, each change shows on each user of the asset, and Save
 * writes each changed material file after the scene.
 *
 * The edit mode also has the open scenes of the project (projects/pageScenes.ts): new, open, save as, close
 * and the scene switcher of the file bar; each open scene keeps its own undo history.
 *
 * The edit mode also has the editor settings, the key map and the dock layout of the project
 * (settings/startEditorSettings.ts): each key of the page is a command of the key map, and the settings tab of the
 * dock changes a key or a setting.
 */
import { isLocked, type DraftStorage, type PrefabSet } from "@scenity/editor-core";
import { pageDrafts, startRecovery } from "./drafts/startRecovery";
import { sceneCommandsOf, setSceneCommands } from "./extensions/pluginPresets";
import type { ComponentRegistry, SceneOp } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { PatchResult, PickHit, ScenePrefabs } from "@scenity/runtime/protocol";
import { commandApi, sceneCommands, type SceneCommandApi, type SceneCommands } from "./hierarchy/sceneCommands";
import type { InspectorParts, PageSelectionPort } from "./inspector/startInspector";
import { openAssetDock } from "./assetDock/openAssetDock";
import { listenAssetDrop } from "./assetDrop";
import { listenClipDrop } from "./clips/clipDrop";
import { listenModelDrop } from "./modelDrop";
import { listenEntityKeys } from "./entityKeys";
import { pageClipboard } from "./pageClipboard";
import { startProposalCard } from "./proposalCard";
import { startReview } from "./review/startReview";
import { startGameView } from "./game/startGameView";
import { startShell } from "./shellHost";
import { currentShell } from "../studio/shell/shell";
import { startWindowState } from "./windowState";
import { startStatus, type StatusParts } from "./statusParts";
import { pageKeys } from "./settings/pageKeys";
import { sceneBar } from "./sceneBar";
import { listenDrag } from "./sceneDrag";
import type { InspectPort } from "./gizmo/freeDrag";
import { TransformSettings } from "./gizmo/gizmoSettings";
import type { GizmoApi } from "./gizmo/startGizmo";
import type { WalksApi } from "./walks/startWalks";
import type { HandlesApi } from "./handles/startHandles";
import { ScenePageEditor, type PageEditorParts } from "./sceneEditor";
import type { PageRulesPort } from "./pageRules";
import { PageSequence, type SequenceApi, type SequenceEditParts } from "./sequencer/pageSequence";
import { startSequenceClock } from "./sequencer/clockBar";
import type { PagePlay, PlayApi, PlayParts } from "./play/pagePlay";
import { startPlay } from "./play/playBar";
import { playInputOf, type PlayInputLink } from "./play/playInput";
import type { SceneFilePort } from "./sceneFiles";
import type { EditorPose } from "./dragMath";
import { openViewport, viewportApi } from "./viewport/viewportHolder";
import { layoutToolsApi, openLayoutTools } from "./layoutTools/layoutToolsHolder";
import type { LayoutToolsApi } from "./layoutTools/startLayoutTools";
import { prefabFiles, type PagePrefabs } from "./prefabs/pagePrefabs";
import { prefabApi, startPrefabTools, type PrefabApi } from "./prefabs/prefabTools";
import { startPrefabLoader } from "./prefabs/prefabLoader";
import { placementCommands } from "./placement/placementCommands";
import { PagePresets, presetCommands, setPagePresets } from "./presets/pagePresets";
import type { ViewportApi, ViewportPort } from "./viewport/viewportTypes";
import { pageScenesApi, startPageScenes, type ScenesApi } from "./projects/sceneSwitcher";
import type { PageScenes, PageScenesParts } from "./projects/pageScenes";
import { uiApi, type UiApi } from "./uiCalls";
import { startAdjustPanel } from "./activity/adjustPanel";
import { startWindowParts } from "./windowParts";
import type { MaterialPageParts } from "./material/pageMaterials";
import { materialApi, type MaterialApi } from "./material/materialApi";
import { materialEditorParts, startMaterials } from "./material/editMaterials";
import { settingsApi, startEditorSettings, type SettingsApi } from "./settings/startEditorSettings";
// The project start screen (`edit=1` with no `scene=`); the entry of the page asks it first.
export { startPage } from "./projects/startScreen";

/** The parts of the page that the editor uses. */
export interface EditParts {
  readonly params: URLSearchParams;
  readonly canvas: HTMLCanvasElement;
  readonly project: string;
  readonly path: string;
  readonly doc: SceneDocument;
  readonly diskText: string;
  readonly files: SceneFilePort;
  patch(ops: readonly SceneOp[]): Promise<PatchResult>;
  /** Send a new prefab set to the runtime (a "load" with only `prefabs`). */
  loadPrefabs?(prefabs: ScenePrefabs): Promise<unknown>;
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The channel of the input events of the play mode to the core; absent: no input in the play mode. */
  readonly input?: PlayInputLink;
  /** The camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera while it draws, else null. */
  editorView?(): EditorPose | null;
  /** The editor camera, the document cameras, the view layers and the camera preview of the client. */
  readonly viewport?: ViewportPort;
  /** The components of the engine and of the project plugins (default: the built-in components). */
  readonly registry?: ComponentRegistry | undefined;
  /** The selection of the page and the asset records of the manifest, for the inspector panel. */
  readonly selection?: PageSelectionPort;
  readonly assets?: InspectorParts["assets"];
  /** The inspect report of the dev core (the boxes of the surface snap). */
  readonly inspect?: InspectPort;
  /** The frame statistics of the core (the status bar). */
  readonly stats?: StatusParts["stats"];
  /** The rule check of the page before a save (pageRules.ts). */
  readonly checkRules?: PageEditorParts["checkRules"];
  /** The project rules and the rule check of the core, for the rules tab of the dock (pageRules.ts). */
  readonly rules?: PageRulesPort;
  /** The open sequence (sequencer/sequenceParts.ts); absent: no sequencer. */
  readonly sequence?: SequenceEditParts;
  /** The prefabs of the document (prefabs/pagePrefabs.ts); absent: the runtime draws the document as it is. */
  readonly prefabs?: PagePrefabs;
  /** Send edited material documents to the core (a "load" with `materials`); absent: no material editor. */
  readonly materials?: MaterialPageParts["send"];
}

/** The open sequence of each editor in the edit mode. */
const pageSequences = new WeakMap<ScenePageEditor, PageSequence>();

/** The sequence part of the script API (empty with no sequence). */
function sequenceApi(editor: ScenePageEditor): Partial<SequenceApi> {
  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return pageSequences.get(editor)?.api(frame) ?? {};
}

/** The play mode of each editor in the edit mode. */
const pagePlays = new WeakMap<ScenePageEditor, PagePlay>();

/** The play part of the script API (empty without `edit=1`). */
function playApi(editor: ScenePageEditor): Partial<PlayApi> {
  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return pagePlays.get(editor)?.api(frame) ?? {};
}

/** The gizmo API of each editor in the edit mode, when its lazy chunk runs. */
const pageGizmos = new WeakMap<ScenePageEditor, { api: (GizmoApi & HandlesApi & WalksApi) | null }>();

/** The gizmo part of the script API: it calls the gizmos of the lazy chunk. */
function gizmoApi(editor: ScenePageEditor): Partial<GizmoApi & HandlesApi & WalksApi> {
  const holder = pageGizmos.get(editor);
  if (holder === undefined) return {};
  const api = (): GizmoApi & HandlesApi & WalksApi => {
    if (holder.api === null) throw new Error("the gizmos do not run yet (wait for data-gizmo)");
    return holder.api;
  };
  return {
    ...{ gizmo: () => api().gizmo(), setGizmo: (change) => api().setGizmo(change), handles: () => api().handles() },
    walkRoutes: () => api().walkRoutes(),
  };
}

/** The commands part of the script API of an editor in the edit mode (empty without `edit=1`). */
export function editApi(
  editor: ScenePageEditor,
): Partial<SceneCommandApi> &
  Partial<GizmoApi> &
  Partial<HandlesApi> &
  Partial<SequenceApi> &
  Partial<PlayApi> &
  Partial<ViewportApi> &
  Partial<PrefabApi> &
  Partial<LayoutToolsApi> &
  Partial<MaterialApi> &
  Partial<ScenesApi> &
  Partial<SettingsApi> &
  Partial<UiApi> {
  const commands = sceneCommandsOf(editor);
  return {
    ...(commands === undefined ? {} : commandApi(commands, editor)),
    ...gizmoApi(editor),
    ...sequenceApi(editor),
    ...playApi(editor),
    ...viewportApi(editor),
    ...prefabApi(editor),
    ...layoutToolsApi(editor),
    ...materialApi(editor, nextFrames),
    ...pageScenesApi(editor),
    ...settingsApi(editor),
    ...(commands === undefined ? {} : uiApi()),
  };
}

/** Wait for two paints: the frame of the core and the paint of the page. */
function nextFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** The local storage of the page, or null when the browser blocks it. */
function pageStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Save writes the changed prefabs. The prefabs of new instances load after the edit that adds them. */
function startPrefabFiles(editor: ScenePageEditor, loaded: PagePrefabs, files: SceneFilePort): void {
  editor.attach(prefabFiles(editor, loaded, files));
  startPrefabLoader(editor, loaded);
}

/** The editor of the page: with the file state in the edit mode, else the scene channel only. */
export function startEditor(parts: EditParts): ScenePageEditor {
  const { params, canvas, path, doc, diskText } = parts;
  const patch = (ops: readonly SceneOp[]): Promise<PatchResult> => parts.patch(ops);
  const registry = parts.registry === undefined ? {} : { registry: parts.registry };
  // The runtime draws the expanded document; the prefab set is a channel of the history.
  const loaded = parts.prefabs;
  const send = (set: PrefabSet): Promise<unknown> => {
    const value = loaded?.load(set);
    return value === undefined ? Promise.resolve() : (parts.loadPrefabs?.(value) ?? Promise.resolve());
  };
  const prefabs = loaded === undefined ? {} : { prefabs: { expander: loaded.expander, set: loaded.set, send } };
  if (params.get("edit") !== "1") return new ScenePageEditor({ patch, doc, path, diskText, ...registry, ...prefabs });
  const { storage: draftStorage, drafts } = pageDrafts(pageStorage(), parts.project, path); // The browser and the host
  // The editor window (the studio shell) places the file bar, the gizmo bar, the panels and the canvas.
  const shell = startShell(canvas);
  const holder: { editor: ScenePageEditor | null } = { editor: null };
  const bar = sceneBar(path, () => void holder.editor?.save());
  const checks = parts.checkRules === undefined ? {} : { checkRules: parts.checkRules };
  const sequence = parts.sequence === undefined ? null : new PageSequence(parts.sequence);
  const editor = new ScenePageEditor({
    ...materialEditorParts(parts, sequence?.editorParts()),
    patch,
    doc,
    path,
    diskText,
    files: parts.files,
    drafts,
    bar,
    ...registry,
    ...checks,
    ...prefabs,
  });
  holder.editor = editor;
  if (loaded !== undefined) startPrefabFiles(editor, loaded, parts.files);
  if (sequence !== null) connectSequence(editor, sequence);
  const input = playInputOf(parts, editor, sequence);
  const play = startPlay({ ...playParts(parts), editor, time: sequence?.time ?? null, sequence, ...input });
  pagePlays.set(editor, play);
  if (sequence !== null) startSequenceClock(sequence, play, sequenceToolParts(parts, editor));
  // The Game view: the scene in the player path.
  startGameView(shell, editor, play);
  startRecovery(editor, draftStorage, bar, diskText); // The draft offer, the host drafts, the autosave, the upgrade
  const scenes = startScenes(parts, editor, { drafts, bar });
  // The search box, the file and project commands, and the UI calls of the window.
  startWindowParts({ parts, editor, scenes, shell, sequence });
  canvas.dataset.edit = "1";
  // The question before a close with unsaved changes, the play banner, the restricted banner.
  startWindowState(shell.notices, editor, bar, parts.project);
  startStatus(shell, statusSources(parts, editor));
  const settings = new TransformSettings();
  const locked = (id: string): boolean => isLocked(editor.doc, editor.view, id);
  const selected = parts.selection === undefined ? {} : { selection: parts.selection };
  listenDrag({
    ...{ canvas, editor, settings, locked, ...selected, ...inspectOf(parts) },
    pick: (x, y) => parts.pick(x, y),
    ...cameraOf(parts),
  });
  void openGizmo(parts, editor, settings);
  // The settings, the key map (⌘S, ⌘Z, ⇧⌘Z and the other keys of the page) and the dock layout of the project.
  const settingsTab = startEditorSettings({ ...parts, editor, transform: settings, play: pagePlays.get(editor) });
  window.addEventListener("focus", () => void editor.checkDisk());
  void openInspector(parts, editor);
  void openAssetDock(parts, editor, sequence, [...startMaterials(parts, editor), settingsTab]);
  if (parts.selection !== undefined) {
    const commands = sceneCommands(editor, parts.selection, pageClipboard());
    setSceneCommands(editor, commands);
    // The proposals of Claude wait on a card for the owner.
    startProposalCard(commands);
    startEntityTools(parts, editor, commands);
    void openHierarchy(parts, editor, commands);
    if (parts.viewport !== undefined) {
      const viewport = { ...{ canvas, editor, selection: parts.selection, port: parts.viewport }, ...inspectOf(parts) };
      void openViewport({ ...viewport, ...cameraOf(parts) });
    }
    // The layout tools (a lazy chunk): measure, reach, clearance, walk paths and visibility.
    void openLayoutTools(parts, editor);
  }
  startPrefabTools(editor, sceneCommandsOf(editor), params);
  return editor;
}

/** The parts of the onion skins of the open sequence. */
function sequenceToolParts(parts: EditParts, editor: ScenePageEditor) {
  const { viewport, selection } = parts;
  return { editor, selection, setOnion: viewport?.setOnion?.bind(viewport) };
}

/** Connect the open sequence to the editor. Its commands are commands of the editor window. */
function connectSequence(editor: ScenePageEditor, sequence: PageSequence): void {
  pageSequences.set(editor, sequence);
  pageKeys().connectSequence({
    listings: () => sequence.listings(),
    run: async (id, args) => {
      const run = await sequence.run(id, args);
      await sequence.settled();
      return run;
    },
    runAs: async (id, args, options) => {
      const run = await sequence.runAs(id, args, options);
      await sequence.settled();
      return run;
    },
  });
  sequence.connect(editor);
}

/**
 * The keys of the entity commands and the drop of an asset tile into the viewport. The drop of a model file promotes it
 * (a project asset and an entity, modelDrop.ts).
 */
function startEntityTools(parts: EditParts, editor: ScenePageEditor, commands: SceneCommands): void {
  if (parts.selection === undefined) return;
  const { canvas } = parts;
  listenEntityKeys({ canvas, commands, live: () => editor.channel.live });
  // The placement helpers (Entity ▸ Place).
  const inspect: InspectPort = () => parts.inspect?.() ?? Promise.resolve(null);
  pageKeys().register(placementCommands({ commands, selection: parts.selection, inspect }));
  // The presets of the person (Entity ▸ Create, the card menu of the inspector).
  const presets = new PagePresets(commands);
  setPagePresets(presets);
  const picked = parts.selection;
  pageKeys().register(presetCommands({ presets, editor, selection: () => picked.ids }));
  // Adjust the last action of the person.
  startAdjustPanel(commands, {
    stepIndex: () => editor.channel.history.steps().index,
    listen: (fn) => editor.listen(fn),
  });
  const drop = {
    ...{ canvas, editor, commands, ...inspectOf(parts) },
    pick: (x: number, y: number) => parts.pick(x, y),
    ...cameraOf(parts),
  };
  listenAssetDrop(drop);
  listenClipDrop(drop);
  listenModelDrop({ ...drop, base: `/projects/${parts.project}/` });
  // The review of the change sets of the agents (the Review panel, the status item, the Preview).
  const shell = currentShell();
  const selection = parts.selection;
  if (shell !== null) {
    const { viewport } = parts;
    startReview({
      editor,
      commands,
      shell,
      patch: (ops) => parts.patch(ops),
      select: (ids) => selection.set(ids),
      // The gate and the pictures of a background task.
      check: parts.checkRules,
      ...(viewport === undefined ? {} : { picture: (width: number) => viewport.previewCamera(parts.camera(), width) }),
    });
  }
}

/** Start the load of the lazy chunks of the edit mode, so they load while the scene and the assets load. */
export function preloadEditParts(): void {
  // A failure shows later, at the import of the part.
  void Promise.all([
    import("./hierarchy/startHierarchy"),
    import("./gizmo/startGizmo"),
    import("./handles/startHandles"),
    import("./walks/startWalks"),
    import("./inspector/startInspector"),
    import("./extensions/studioFaces"),
  ]).catch(() => undefined);
}

/** The hierarchy panel. It is a lazy chunk with Vue, as the inspector is. */
async function openHierarchy(parts: EditParts, editor: ScenePageEditor, commands: SceneCommands): Promise<void> {
  if (parts.selection === undefined) return;
  const { startHierarchy } = await import("./hierarchy/startHierarchy");
  startHierarchy({ editor, commands, selection: parts.selection, canvas: parts.canvas });
}

/** The transform gizmos. They are a lazy chunk, so a page without `edit=1` never loads them. */
async function openGizmo(parts: EditParts, editor: ScenePageEditor, settings: TransformSettings): Promise<void> {
  if (parts.selection === undefined) return;
  const holder: { api: (GizmoApi & HandlesApi & WalksApi) | null } = { api: null };
  pageGizmos.set(editor, holder);
  const [{ startGizmo }, { startHandles }, { startWalks }] = await Promise.all([
    import("./gizmo/startGizmo"),
    import("./handles/startHandles"),
    import("./walks/startWalks"),
  ]);
  // The routes of the walks of the selected actor.
  const walks = startWalks({ canvas: parts.canvas, editor, selection: parts.selection, ...cameraOf(parts) });
  // The handles of the components start first, so a press on a handle comes before the axes of the gizmo.
  const handles = startHandles({ canvas: parts.canvas, editor, selection: parts.selection, ...cameraOf(parts) });
  const gizmo = startGizmo({
    canvas: parts.canvas,
    editor,
    selection: parts.selection,
    settings,
    ...cameraOf(parts),
    ...inspectOf(parts),
  });
  holder.api = { ...gizmo, ...handles, ...walks };
}

/** The open scenes of the project and the scene switcher of the file bar. */
function startScenes(
  parts: EditParts,
  editor: ScenePageEditor,
  file: Pick<PageScenesParts, "drafts" | "bar">,
): PageScenes | null {
  const { files, project, selection, checkRules, viewport } = parts;
  const openCamera = (name: string | null): Promise<boolean> => viewport?.openCamera(name) ?? Promise.resolve(false);
  const camera = (): string | null => parts.camera();
  return startPageScenes({
    ...file,
    editor,
    files,
    project,
    storage: pageStorage(),
    selection,
    checkRules,
    camera,
    openCamera,
  });
}

/** The page parts of the play mode. */
function playParts(parts: EditParts): Pick<PlayParts, "project" | "camera" | "selection"> {
  const selection = parts.selection === undefined ? {} : { selection: parts.selection };
  return { project: parts.project, camera: () => parts.camera(), ...selection };
}

/** The camera of the page for the drag, the gizmos and the drops: the document camera and the editor camera. */
function cameraOf(parts: EditParts): { camera(): string | null; editorView(): EditorPose | null } {
  return { camera: () => parts.camera(), editorView: () => parts.editorView?.() ?? null };
}

/** The inspect port of the parts as an optional field. */
function inspectOf(parts: EditParts): { readonly inspect?: InspectPort } {
  return parts.inspect === undefined ? {} : { inspect: parts.inspect };
}

/** The inspector panel. It is a lazy chunk with Vue, so a page without `edit=1` never loads it. */
async function openInspector(parts: EditParts, editor: ScenePageEditor): Promise<void> {
  if (parts.selection === undefined) return;
  const { startInspector } = await import("./inspector/startInspector");
  await startInspector({
    ...{ editor, registry: editor.registry, canvas: parts.canvas, assets: parts.assets ?? [] },
    ...{ base: `/projects/${parts.project}/`, scenePath: parts.path, selection: parts.selection },
    ...inspectOf(parts),
    pick: (x, y) => parts.pick(x, y),
  });
}

/** The sources of the status bar: the save, the selection and the frame statistics. */
function statusSources(parts: EditParts, editor: ScenePageEditor): StatusParts {
  const { selection } = parts;
  return {
    save: () => void editor.save(),
    frame: () => void pageKeys().run("view.frame"),
    // A press on the render item opens the Performance panel.
    openPerformance: () => currentShell()?.showPanel("performance"),
    ...(selection === undefined ? {} : { selection }),
    ...(parts.stats === undefined ? {} : { stats: parts.stats }),
  };
}
