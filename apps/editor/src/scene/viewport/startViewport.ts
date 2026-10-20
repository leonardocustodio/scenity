// SPDX-License-Identifier: Apache-2.0
/**
 * The viewport of the scene page in the edit mode. The page loads this module only with `edit=1` (a lazy chunk).
 * Thus a page without the edit mode and the gallery frames do not change.
 *
 * - The editor camera (viewportCamera.ts, viewportInput.ts): orbit, pan, zoom, fly and the arrow keys. F frames the
 *   selection. The camera is not in the document, and the "camera" message of the protocol carries its view. F and
 *   the keys 0 to 9 are page commands of the key map. The start view mode, the grid and the speeds are editor
 *   settings.
 * - The bar (viewportBar.ts): the camera menu (the editor camera and the document cameras, with the keys 0 to 9) and
 *   the view mode (lit, unlit, wireframe, normals: core layers of the dev core). The bar also has the grid and the
 *   axes (a core layer, enabled by default) and the Frame button.
 * - The icons of the lights and the cameras (viewIcons.ts): a click selects the entity.
 * - The camera preview (previewInset.ts): the view of the selected document camera.
 * - The split view (splitViews.ts): 1, 2 or 4 views, each with its own camera and view mode. The main view at the top
 *   left gets the picks, the gizmos and the drags (mainView.ts).
 *
 * `__scenity.viewport()`, `setViewport(change)` and `frameSelection()` control the viewport from a script.
 */
import { viewOf } from "@scenity/editor-core";
import { t } from "../../texts";
import { cameraEntity, documentCameraIds, entityCount, pageView, type CameraView } from "../dragMath";
import { changePins, PinLayer, presencePins } from "./changePins";
import { changeGhosts, ghostSender } from "./ghosts";
import type { GhostSpec } from "@scenity/runtime-dev/document/ghostCopies";
import { pageViewPreview } from "../review/viewPreview";
import { pagePresences } from "../agent/presence";
import { pageReview } from "../review/reviewState";
import { IconLayer, viewIcons } from "./viewIcons";
import { PreviewInset } from "./previewInset";
import { viewOverlayParts } from "./viewOverlays";
import { editorViewCommands } from "./editorViews";
import { ViewportCamera } from "./viewportCamera";
import { listenViewportInput } from "./viewportInput";
import {
  VIEW_MODE_LAYERS,
  type ViewMode,
  type ViewportApi,
  type ViewportChange,
  type ViewportInfo,
  type ViewportParts,
} from "./viewportTypes";
import { cameraFromViewCommand } from "./cameraFromView";
import { splitCommands, SplitViews } from "./splitViews";
import "./viewport.css";
import { pageKeys, SCENE_CONTEXT, type PageKeyCommandSpec } from "../settings/pageKeys";
import { pageSettings } from "../settings/pageSettings";
import { mainViewBox } from "./mainView";

/** The split view info of one view (the loop of the bar does not read the panes). */
const SINGLE: ViewportInfo["split"] = { layout: "1", panes: [] };

/** The view state of the viewport: the view mode and the grid. */
interface ViewState {
  viewMode: ViewMode;
  grid: boolean;
}

/** The core layers of a view state. */
function layersOf(state: ViewState): string[] {
  const mode = VIEW_MODE_LAYERS[state.viewMode];
  return [...(state.grid ? ["grid"] : []), ...(mode === null ? [] : [mode])];
}

/** The document cameras of the page in the order of the number keys (by ID). */
function documentCameras(parts: ViewportParts): readonly string[] {
  return documentCameraIds(parts.editor.doc);
}

/** Wait for the next frame of the core. */
async function nextFrame(): Promise<void> {
  await globalThis.__scenity?.frame();
}

/** The current state of the viewport. */
function info(
  parts: ViewportParts,
  camera: ViewportCamera,
  state: ViewState,
  extra: Pick<ViewportInfo, "icons" | "preview" | "split">,
): ViewportInfo {
  const editor = camera.active ? camera.current() : null;
  const view = pageView(parts.editor.posed(), parts);
  const pose = editor === null ? null : viewOf(editor);
  return {
    camera: camera.active ? "editor" : (cameraEntity(parts.editor.doc, parts.camera()) ?? ""),
    position: pose?.position ?? view?.position ?? null,
    target: pose?.target ?? null,
    fov: pose?.fov ?? view?.fov ?? null,
    moving: camera.moving,
    ...{ viewMode: state.viewMode, grid: state.grid, projection: camera.projection },
    ...extra,
  };
}

/** The selected document camera of the preview, or null. */
function previewCamera(parts: ViewportParts): string | null {
  const doc = parts.editor.doc;
  return parts.selection.ids.find((id) => doc.entities[id]?.components.camera !== undefined) ?? null;
}

/** The loop of each animation frame: the bar, the icons and the camera of the preview follow the page. */
function follow(
  parts: ViewportParts,
  camera: ViewportCamera,
  state: ViewState,
  show: (info: ViewportInfo) => void,
): void {
  const step = (): void => {
    show(info(parts, camera, state, { icons: [], preview: { camera: null, pictures: 0 }, split: SINGLE }));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * The page commands of the viewport keys. F frames the selection, 1 to 9 open the document cameras in their order,
 * and 0 opens the editor camera again. While the right button flies the camera, the commands do not run.
 */
function viewCommands(
  parts: ViewportParts,
  frame: () => void,
  open: (id: string) => Promise<boolean>,
  camera: ViewportCamera,
): PageKeyCommandSpec[] {
  const idle = (): string | null => (parts.canvas.dataset.fly === undefined ? null : t("viewport-refuse-fly"));
  const cameras = Array.from({ length: 9 }, (_, at): PageKeyCommandSpec => {
    const number = String(at + 1);
    return {
      ...{ id: `camera.open${number}`, title: t("viewport-command-open-camera", { number }), keys: [number] },
      keyContext: SCENE_CONTEXT,
      when: () =>
        idle() ?? (documentCameras(parts)[at] === undefined ? t("viewport-refuse-no-camera", { number }) : null),
      run: () => void open(documentCameras(parts)[at] ?? ""),
    };
  });
  return [
    {
      id: "view.frame",
      menu: "edit",
      title: t("viewport-command-frame"),
      keys: ["F"],
      keyContext: SCENE_CONTEXT,
      when: idle,
      run: frame,
    },
    {
      ...{
        id: "camera.editor",
        title: t("viewport-command-editor-camera"),
        keys: ["0"],
        keyContext: SCENE_CONTEXT,
        when: idle,
      },
      run: () => void open("editor"),
    },
    ...cameras,
    // The views along the axes and the projection of the editor camera.
    ...editorViewCommands(camera, idle),
  ];
}

/** A change of the view settings (the panel) shows immediately. */
function followViewSettings(state: ViewState, apply: () => Promise<void>): void {
  let last = JSON.stringify(pageSettings().value.view);
  pageSettings().listen((settings) => {
    const now = JSON.stringify(settings.view);
    if (now === last) return;
    last = now;
    state.viewMode = settings.view.mode;
    state.grid = settings.view.grid;
    void apply();
  });
}

/**
 * The pins of the changes that wait for review. The pins also show the entities that a turn changes while it runs,
 * and the cameras of the frames of the agents.
 */
function showPins(pins: PinLayer, editor: ViewportParts["editor"], view: CameraView | null, box: DOMRect): void {
  const review = pageReview();
  const size = { width: box.width, height: box.height };
  const changes =
    view === null || review === null ? [] : changePins(review, editor.posed(), editor.registry, view, size);
  const marked = new Set(changes.map((pin) => pin.id));
  const presence = view === null ? null : presencePins(pagePresences().values(), editor.posed(), view, size);
  const working = (presence?.pins ?? []).filter((pin) => !marked.has(pin.id));
  pins.show(box, [...changes, ...working], presence?.frustums ?? []);
}

/** The split view of the viewport and its commands. */
function startSplit(
  parts: ViewportParts,
  camera: ViewportCamera,
  state: ViewState,
  apply: () => Promise<void>,
  label: (id: string) => string,
): SplitViews {
  const split = new SplitViews({
    canvas: parts.canvas,
    camera,
    port: parts.port,
    cameras: () => documentCameras(parts).map((id) => ({ id, label: label(id) })),
    mainMode: () => state.viewMode,
    setMainMode: (mode) => {
      state.viewMode = mode;
      void apply();
    },
  });
  pageKeys().register([...splitCommands(split), cameraFromViewCommand(() => pageView(parts.editor.posed(), parts))]);
  return split;
}

/** The split view info of the viewport. */
function splitInfo(split: SplitViews): ViewportInfo["split"] {
  const count = { "1": 0, "2h": 1, "2v": 1, "2x2": 3 }[split.layout];
  return { layout: split.layout, panes: split.panes.slice(0, count).map(({ camera, mode }) => ({ camera, mode })) };
}

/** The parts of the view that follow each frame of the page. */
interface ShownParts extends ReturnType<typeof viewOverlayParts> {
  readonly icons: IconLayer;
  readonly preview: PreviewInset;
  readonly pins: PinLayer;
  /** The sender of the ghosts of the changes that wait. */
  readonly ghosts: (spec: GhostSpec) => void;
  readonly split: SplitViews;
  readonly label: (id: string) => string;
}

/** Show the bar, the stats, the preview, the orientation, the icons, the pins and the panes. Return the icons. */
function showFrame(
  parts: ViewportParts,
  camera: ViewportCamera,
  shown: ShownParts,
  now: ViewportInfo,
): ViewportInfo["icons"] {
  const { canvas, editor, selection } = parts;
  const { bar, stats, preview, orientation, icons, label } = shown;
  const cameras = documentCameras(parts).map((id) => ({ id, label: label(id) }));
  bar.show({ camera: now.camera, cameras, viewMode: now.viewMode, grid: now.grid });
  stats.show(entityCount(editor.doc), selection.ids.length);
  const chosen = previewCamera(parts);
  preview.show(chosen, chosen === null ? "" : label(chosen));
  const box = mainViewBox(canvas);
  const view = pageView(editor.posed(), parts);
  if (view !== null) orientation.show(view.position, view.forward);
  const skip = camera.active ? null : now.camera;
  const shownIcons = view === null ? [] : viewIcons(editor.posed(), view, box.width, box.height, skip);
  icons.show(box, shownIcons, selection.ids);
  showPins(shown.pins, editor, view, box);
  // The ghosts of the changes that wait. A Preview of a change set draws the changed document instead.
  const review = pageReview();
  const previewing = (pageViewPreview()?.key.value ?? null) !== null;
  shown.ghosts(review === null || previewing ? { copies: [] } : changeGhosts(review, editor.posed(), editor.registry));
  shown.split.follow(canvas.getBoundingClientRect());
  return shownIcons;
}

/** Start the viewport of the page. The result is the viewport part of the script API. */
export function startViewport(parts: ViewportParts): ViewportApi {
  const { canvas, editor, selection } = parts;
  const camera = new ViewportCamera(parts);
  // The view mode and the grid at the start come from the editor settings.
  const state: ViewState = { viewMode: pageSettings().value.view.mode, grid: pageSettings().value.view.grid };
  const label = (id: string): string => editor.doc.entities[id]?.name ?? id;
  const applyLayers = (): Promise<void> => parts.port.setViewLayers(layersOf(state));
  void applyLayers();
  const split = startSplit(parts, camera, state, applyLayers, label);
  // The panes of a stored split view start from the first view of the editor camera.
  void parts.inspect?.().then((report) => {
    camera.learn(report);
    split.start();
  });
  const frame = (): Promise<boolean> => {
    const box = mainViewBox(canvas);
    return camera.frame(box.width / Math.max(1, box.height));
  };
  const open = async (id: string): Promise<boolean> => {
    if (id !== "editor") return camera.useDocument(id);
    camera.useEditor();
    return true;
  };
  // The controls of the bar, the orientation and the stats go in the overlays of the Scene view.
  const overlays = viewOverlayParts({
    camera: (id) => void open(id),
    viewMode: (mode) => void change({ viewMode: mode }),
    grid: (on) => void change({ grid: on }),
    frame: () => void frame(),
  });
  const icons = new IconLayer((id, add) => {
    const now = selection.ids;
    selection.set(!add ? [id] : now.includes(id) ? now.filter((each) => each !== id) : [...now, id]);
  }, label);
  const preview = new PreviewInset((id, width) => parts.port.previewCamera(id, width));
  const change = async (next: ViewportChange): Promise<void> => {
    if (next.viewMode !== undefined) state.viewMode = next.viewMode;
    if (next.grid !== undefined) state.grid = next.grid;
    if (next.viewMode !== undefined || next.grid !== undefined) await applyLayers();
    if (next.camera !== undefined && !(await open(next.camera))) throw new Error(`no camera "${next.camera}"`);
    if (next.projection !== undefined) camera.setProjection(next.projection);
    if (next.view !== undefined) camera.view(next.view);
    if (next.split !== undefined) split.setLayout(next.split);
  };
  listenViewportInput({ canvas, camera, live: () => editor.channel.live });
  pageKeys().register(viewCommands(parts, () => void frame(), open, camera));
  // The Orientation overlay turns the editor camera and changes its projection.
  overlays.orientation.listen(camera);
  followViewSettings(state, applyLayers);
  editor.listen(() => {
    preview.refresh();
  });
  // The pins of the changes that wait for review.
  const pins = new PinLayer((id) => selection.set([id]));
  let shownIcons: ViewportInfo["icons"] = [];
  const ghosts = ghostSender((spec) => parts.port.setGhosts?.(spec));
  const shown = { ...overlays, icons, preview, pins, split, label, ghosts };
  follow(parts, camera, state, (now) => {
    shownIcons = showFrame(parts, camera, shown, now);
  });
  canvas.dataset.viewport = "1";
  const current = (): ViewportInfo =>
    info(parts, camera, state, {
      ...{ icons: shownIcons, preview: { camera: preview.camera, pictures: preview.pictures } },
      split: splitInfo(split),
    });
  return {
    viewport: current,
    async setViewport(next) {
      await change(next);
      await nextFrame();
      return current();
    },
    async frameSelection() {
      const framed = await frame();
      await nextFrame();
      return framed;
    },
  };
}
