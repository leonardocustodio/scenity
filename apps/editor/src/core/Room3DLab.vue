<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The 3D room lab (the labs app at "/"): the 3D scene on the left and a control panel on the right. The lab gives the
 * same views as an engine to the scene view of the plugin. Thus the scene runs on the same path as in a case (scene
 * input, render worker, cards), without an engine, a session or a sign-in.
 *
 * The state of the lab is a take: a list of events on a local clock (the take model of the plugin). The panel (the
 * tabs of the plugin, LabViewTab), the content browser and the keys add events at the time of the clock. The state at a
 * time is a pure function of the events. Thus the clock can stop, run faster or slower, and seek. Agents and tools
 * control the lab through `globalThis.__room3dLab` (useLabApi.ts).
 *
 * URL parameters:
 * - `take` (or `preset`): a take at sim time 0; `rec`: the events of the panel; `t`: the time of the clock;
 *   `paused=1`: the clock stops. The page keeps them current, thus a reload shows the same moment.
 * - `freeze`: a fixed frame of the visual tests. The clock stops at this time, with no adaptive quality, no dock and no
 *   frame rate readout. Example: /?preset=greet&freeze=14136&tier=medium
 * - `camera`: a named camera (cameras.ts); `view=x,y,z,tx,ty,tz,fov`: a free camera.
 * - `tier`, `worker=0` (the main-thread core), `cards=1`, `motion=reduced`, `assets=0` (graybox members), `team=0`
 *   (the empty room for the poster image), `panel=0`, `dock=0`.
 * - `backend=webgpu|webgl`: the renderer backend, in place of the choice of the checks. `backend=webgl` shows what a
 *   learner on a device without WebGPU sees.
 * - The performance harness (scripts/perf of the room plugin): `adaptive=0` and `gpu=1`.
 * - `debug=<layer,…>`: the debug layers; `tune=<path:value,…>`: the tune values; `source=track:<name>`: a case of the
 *   engine; `source=mock`: a live session of the mock engine; `timeline=0`: no time line; `review=<family>`: the review
 *   of a clip family in the inspector of the dock.
 * - The content browser: `dock=bar|half|tall|0` (`film=0` is the old name of `dock=0`), `path`, `item`, `q`, `filter`
 *   and `strip`.
 * - `follow=1`: the clock follows the lab of another window (follow/useClockFollow.ts); `only=dock`: the content
 *   browser alone, without a 3D scene.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { probeGpu } from "@scenity/runtime/probe";
import { type Tier } from "@scenity/runtime/protocol";
import type { DebugLayer } from "../plugins";
import { parseTunes, tuneText } from "@scenity/runtime-dev";
import { cn } from "@scenity/ui";
import { PanelRightOpen } from "lucide-vue-next";
import { computed, provide, ref, shallowRef, watch } from "vue";
import LabFrameStats from "./LabFrameStats.vue";
import LabGraph from "./graph/LabGraph.vue";
import LabPanel from "./LabPanel.vue";
import LabTimeline from "./LabTimeline.vue";
import { LAB_INDEX, useLabIndex } from "./index/useLabIndex";
import { LAB_CONTEXT, type LabContext } from "./labContext";
import { button } from "./labUi";
import LabDock from "./browser/LabDock.vue";
import { useBrowser } from "./browser/useBrowser";
import { useLabApi } from "./useLabApi";
import { useWorkbenchBridge } from "./bridge/workbenchBridge";
import { useLabBackend } from "./useLabBackend";
import { drawnBackend } from "./backendText";
import { useLabCamera } from "./useLabCamera";
import { useLabClock } from "./useLabClock";
import { TIERS, useLabStats, type ViewHandle } from "./useLabStats";
import { startEvents, useLabTake } from "./useLabTake";
import { editorRoom, editorScene } from "./sceneSource";
import SceneEditLayer from "./edit/SceneEditLayer.vue";
import ImportDropLayer from "./importDrop/ImportDropLayer.vue";
import { useImportDrop } from "./importDrop/useImportDrop";
import { useEditPanel } from "./edit/useEditPanel";
import { useEditor } from "./editor/useEditor";
import { keyRelay } from "./editor/labParts";
import { editorPlugin } from "./plugin";
import { useSceneEdit } from "./edit/useSceneEdit";
import { rightsGap } from "./scratch/scratchInfo";
import { useScratch } from "./scratch/useScratch";
import LabPanes from "./panes/LabPanes.vue";
import { installPaneApi, paneApi } from "./panes/paneApi";
import { usePanes } from "./panes/usePanes";
import { useClockFollow } from "./follow/useClockFollow";

// ---------------------------------------------------------------------------------------------
// URL parameters, the clock and the live take.

const { $t } = useI18n();
const params = new URLSearchParams(globalThis.location.search);
const frozenAt = Number(params.get("freeze"));
/** The clock stops at `freeze` (a fixed frame of the visual tests): no adaptive quality, no dock, no readout. */
const frozen = params.has("freeze") && Number.isFinite(frozenAt);
const startAt = Number(params.get("t"));
const clock = useLabClock({
  startMs: frozen ? frozenAt : Number.isFinite(startAt) ? startAt : 0,
  running: !frozen && params.get("paused") !== "1",
});
const take = useLabTake(clock, startEvents(params), { keepUrl: !frozen });
const state = take.state;
/** The clock follows the lab of another window; `only=dock` shows the content browser alone. */
const follow = !frozen && params.get("follow") === "1";
const dockOnly = follow && params.get("only") === "dock";
/** The adaptive quality: off for a fixed frame and for the measurements of the harness (`adaptive=0`). */
const adaptive = !frozen && params.get("adaptive") !== "0";

// ---------------------------------------------------------------------------------------------
// The renderer and the camera.

const probe = probeGpu({ allowSoftware: true });
const tierParam = params.get("tier");
const tier = ref<Tier>(TIERS.find(([value]) => value === tierParam)?.[0] ?? probe.tier);
const useWorker = ref(params.get("worker") !== "0");
// The renderer backend (`backend=webgpu|webgl` overrides it). The renderer starts after the choice.
const backend = useLabBackend(params, useWorker.value);
// Without `tier`, a WebGPU choice gives the first tier from the adapter, before the renderer starts.
watch(
  backend.choice,
  (made) => {
    const adapterTier = made?.tier ?? null;
    if (adapterTier !== null && !TIERS.some(([value]) => value === tierParam)) tier.value = adapterTier;
  },
  { flush: "sync" },
);
// `?runtime=1`: the learner renderer and worker (a parity check). Then the tools get no frame or report.
const runtime = params.get("runtime") === "1";
const reduced = ref(params.get("motion") === "reduced");
// The cards start hidden; `cards=1` shows them.
const showCards = ref(params.get("cards") === "1");
const useAssets = ref(params.get("assets") !== "0");
/** The loading fog of the lab fades in 150 ms (`fog=fast`, the default); `fog=learner` keeps the learner fade. */
const fogStyle = params.get("fog") === "learner" ? undefined : { "--scene-view-fog-duration": "150ms" };
/** The count of asset loads at the same time (`loads=1…8`). Without it, the page uses the value of the runtime. */
const loadsParam = Number(params.get("loads"));
const loads = Number.isInteger(loadsParam) && loadsParam >= 1 && loadsParam <= 8 ? loadsParam : null;
const failure = ref<string | null>(null);
const attempt = ref(0);
const rendererKey = computed(
  () => `${tier.value}-${String(useWorker.value)}-${String(useAssets.value)}-${String(attempt.value)}`,
);
const view = shallowRef<ViewHandle | null>(null);
// A slower poll of the statistics when the clock is stopped.
const stats = useLabStats(
  view,
  computed(() => !clock.running.value),
);
/** The card of the frame statistics under the readout. */
const statsOpen = ref(false);
/** The GPU timer adds a little GPU work. It runs when the card is open, or from the start with `gpu=1` (harness). */
const gpuTimer = computed(() => params.get("gpu") === "1" || statsOpen.value);

/** The debug layers over the scene: the URL keeps them as `debug=ik,paths`. */
const debug = ref<DebugLayer[]>(
  (params.get("debug") ?? "")
    .split(",")
    .filter((layer): layer is DebugLayer => (editorRoom().debugLayers as readonly string[]).includes(layer)),
);
watch(debug, (layers) => {
  const url = new URL(globalThis.location.href);
  if (layers.length === 0) url.searchParams.delete("debug");
  else url.searchParams.set("debug", layers.join(","));
  globalThis.history.replaceState(globalThis.history.state, "", url);
});

/** The tune values: the URL keeps them as `tune=path:value,path:value`. */
const tunes = ref<Record<string, number>>(parseTunes(params.get("tune")));
watch(tunes, (values) => {
  const url = new URL(globalThis.location.href);
  if (Object.keys(values).length === 0) url.searchParams.delete("tune");
  else url.searchParams.set("tune", tuneText(values));
  globalThis.history.replaceState(globalThis.history.state, "", url);
});

const page = ref<HTMLElement | null>(null);
const scene = ref<HTMLElement | null>(null);
const camera = useLabCamera(scene, params);
// The split screen of 1 to 4 panes (`panes`, `cams`). The main pane has the camera above.
const panes = usePanes({ camera, scene, params, frozen });

function retry(): void {
  failure.value = null;
  attempt.value += 1;
}

// ---------------------------------------------------------------------------------------------
// The panel.

// The md breakpoint of Tailwind (48rem): below it, the panel covers the scene (max-md classes of the panel).
const narrow = typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(width < 48rem)").matches;
const panelOpen = ref(params.get("panel") !== "0" && !narrow);
// The inspector shows the open item of the content browser; a page with `item` or `review` opens on it.
// The Inspector tab is hidden. Remove the comment marks to show it again.
// const tab = ref<string>(params.has("item") || params.has("review") ? "inspector" : "team");
const tab = ref<string>("team");
const selectedId = ref<string>(editorPlugin().sequence.members(state.value)[0] ?? "");
/** A press on a member in the scene selects it in the team tab. */
function onAddress(id: string): void {
  if (!editorPlugin().sequence.members(state.value).includes(id)) return;
  selectedId.value = id;
  tab.value = "team";
}

/**
 * On a phone in portrait, the panel covers the scene. Thus an animation, a phase or a preset hides the panel, and the
 * scene shows the motion. In landscape and on a wide screen, the panel stays.
 */
function showScene(): void {
  const portraitPhone =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(orientation: portrait) and (width < 48rem)").matches;
  if (portraitPhone) panelOpen.value = false;
}

/**
 * The plugin gives the source of the views of the scene: the take of the lab, a view track of a case
 * (`source=track:<name>`) or a live session (`source=mock`). The view of the plugin takes the props of the source.
 */
const pluginScene = editorScene();
const SceneView = pluginScene.view;
const source = pluginScene.useSource({ take, clock, params, fail: (reason) => (failure.value = reason) });
const { track, trackName, session: mock } = source;

// ---------------------------------------------------------------------------------------------
// The context of the panel, the keys and the script API.

/** The content browser. A fixed frame of the visual tests has no content browser. */
const browser = frozen ? null : useBrowser({ take, clock, camera, selectedId, useAssets, frozen });

// An item that opens shows in the Inspector tab of the side panel. The tab is hidden. Remove the comment marks to show
// it again.
// if (browser !== null) {
//   watch(browser.opened, () => {
//     tab.value = "inspector";
//   });
// }

// `review=<family>`: the first clip of the family with the Review section of the inspector.
const reviewParam = params.get("review");
if (browser !== null && reviewParam !== null) browser.openReview(reviewParam);

// A follower window takes the clock, the take and (with the content browser alone) the open item.
if (follow) {
  useClockFollow({
    clock,
    take,
    ...(dockOnly && browser !== null
      ? { open: (key: string) => void browser.open(key), item: () => browser.item.value?.key ?? null }
      : {}),
  });
}

// The scratch props of the checkout (`scratch=` in the URL, an input of the frame key). A new scratch prop is selected.
const scratch = useScratch({ view: () => view.value, params, added: (id) => edit.select({ kind: "scratch", id }) });

const labContext: LabContext = {
  take,
  clock,
  camera,
  renderer: {
    tier,
    useWorker,
    reduced,
    showCards,
    useAssets,
    probe,
    frozen,
    debug,
    view,
    tunes,
    backend: backend.choice,
    scratch: scratch.text,
  },
  stats,
  selectedId,
  showScene,
  track,
  trackName,
  mock,
  browser,
  panes,
};
provide(LAB_CONTEXT, labContext);
// The frame index of the open take (its readers, the fill of the page alone, the bridge calls).
provide(
  LAB_INDEX,
  // The key holds the backend that draws (after a WebGPU failure: WebGL), not only the choice.
  useLabIndex({ lab: labContext, backend: () => drawnBackend(stats.stats.value, backend.choice.value), runtime }),
);
// The keys of the plugin (for example the member keys P and K).
pluginScene.useKeys(take, selectedId);
// The scene input at a time for the sweep and the onion skin. A live session has no scene input.
const inputAt = source.inputAt;
useLabApi({ take, clock, camera, view, debug, tunes, source, root: () => page.value, browser, inputAt });
// The workbench bridge: it is enabled only with `workbench=<origin>` in a frame.
useWorkbenchBridge(view);
// The edit ops (editor/), one undo, the commands and the layout checks.
const editor = useEditor({ tunes, take, clock });
const keys = keyRelay();
// Pick, select, drag, save placement, marks and ask (edit/). It comes after the script API, because it extends it.
// const edit = useSceneEdit({ view, tunes, scene, camera, params, scratch, history: editor.history });
const edit = useSceneEdit({ view, tunes, scene, camera, params, scratch, history: editor.history, run: keys.run });
const editPanel = useEditPanel({
  edit,
  tunes,
  view,
  scene,
  pause: () => clock.pause(),
  layout: editor.layout,
  // The place and the import facts of a selected scratch prop.
  scratch: (id) => {
    const item = scratch.api.list().find((entry) => entry.id === id);
    if (item === undefined) return null;
    const facts = item.info === null ? null : { ...item.info, rightsGap: rightsGap(item.info) };
    return { place: scratch.placeOf(id), facts };
  },
});
// The command runner (the keys, the card, ⌘P, the script API, the host tools) and the ghosts.
// const commands = useLabCommands({ editor, tunes, edit, panel: editPanel, camera, scratch, keys, view, take, clock });
const labParts = { editor, tunes, edit, panel: editPanel, camera, scratch, keys, view, take, clock };
// The plugin starts the runner with its tools over the scene. `inputAt` gives the scene input at a time for the onion
// skin, and the panes show a compare of layouts.
const commands = editorPlugin().overlays.start({ ...labParts, inputAt, panes });
// A file dropped on the scene (a quick preview alone; the import job of the host in the workbench).
const importDrop = useImportDrop({ view: () => view.value, scene });
// `lab.panes`, `lab.focusPane` and `lab.capture({ pane | grid })` in the script API.
installPaneApi(paneApi(panes, view));
/** A press focuses its pane. Only a press on the main pane can pick (the camera gets the other presses). */
function onScenePointer(event: PointerEvent): void {
  if (panes.onDown(event)) edit.onDown(event);
  else camera.onDown(event);
}
// The take refreshes its state at each seek (useLabTake.ts), thus the page has no refresh of its own here.
</script>

<template>
  <div
    ref="page"
    :class="
      cn(
        'lab grid h-dvh grid-cols-[minmax(0,1fr)] bg-surface-base text-text-primary',
        panelOpen && 'md:grid-cols-[minmax(0,1fr)_25rem]',
      )
    "
    data-testid="room3d-lab"
  >
    <div class="flex min-h-0 min-w-0 flex-col">
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- a file drop on the 3D scene of the developer page; a drop has no keyboard form. -->
      <section
        v-show="!dockOnly"
        ref="scene"
        class="lab__scene relative min-h-0 flex-1 touch-none"
        :data-motion="reduced ? 'reduced' : undefined"
        :data-scratch="scratch.loading.value ? 'loading' : undefined"
        @pointerdown="onScenePointer"
        @dblclick="panes.onDouble"
        @pointermove="edit.onMove"
        @pointerup="edit.onUp"
        @pointercancel="edit.onUp"
        @dragover="importDrop.onDragOver"
        @dragleave="importDrop.onDragLeave()"
        @drop.prevent="importDrop.onDrop"
        @wheel.prevent="camera.onWheel"
      >
        <!-- A stopped clock shows the frame of its time (the poses of that time), thus the scene is never paused. -->
        <SceneView
          v-if="failure === null && backend.choice.value !== null && !dockOnly"
          :key="rendererKey"
          ref="view"
          v-bind="source.props.value"
          :paused="false"
          :adaptive="adaptive"
          :gpu-timer="gpuTimer"
          :view="panes.drawn.value.views[0] ?? null"
          :panes="panes.drawn.value.layout === '1' ? null : panes.drawn.value"
          :get-sim-ms="source.simNow"
          :clock-epoch="clock.epoch.value"
          :clock-stopped="mock === null && !clock.running.value"
          :debug="debug"
          :tunes="tunes"
          :tunes-quick="edit.dragging.value !== null"
          :selection="edit.selected.value"
          :tier="tier"
          :worker-url="useWorker ? (runtime ? pluginScene.workers.runtime : pluginScene.workers.lab) : null"
          :gpu-worker-url="useWorker ? (runtime ? pluginScene.workers.runtimeGpu : pluginScene.workers.labGpu) : null"
          :backend="backend.choice.value"
          :runtime="runtime"
          :cards="showCards"
          :use-assets="useAssets"
          :style="fogStyle"
          :loads="loads"
          fit
          @address="onAddress"
          @failed="(reason: string) => (failure = reason)"
        />
        <div v-else-if="failure !== null" class="grid size-full place-items-center bg-surface-sunken text-body">
          <div class="flex flex-col items-center gap-2">
            <p>{{ $t("lab-failed", { reason: failure }) }}</p>
            <button type="button" :class="button" @click="retry">{{ $t("lab-retry") }}</button>
          </div>
        </div>
        <!-- Without the dock (`dock=0`), the time line stays at the bottom of the scene. A fixed frame of the visual
           tests has neither. -->
        <div v-if="!frozen && browser?.dock.value === 'hidden'" class="absolute inset-x-0 bottom-0 z-10 flex flex-col">
          <LabTimeline v-if="params.get('timeline') !== '0' && mock === null" />
        </div>
        <button
          v-if="!panelOpen"
          type="button"
          :class="
            cn(
              button,
              'absolute top-3 right-3 z-10 inline-flex size-9 items-center justify-center p-0 shadow-overlay pointer-coarse:size-11',
            )
          "
          :aria-label="$t('lab-show-panel')"
          :title="$t('lab-show-panel')"
          aria-controls="room3d-lab-panel"
          :aria-expanded="false"
          @click="panelOpen = true"
        >
          <PanelRightOpen class="size-4" aria-hidden="true" />
        </button>
        <LabFrameStats v-if="!frozen" v-model:open="statsOpen" class="absolute top-3 left-3 z-10" />
        <!-- The metrics graph of the take over the scene, and the clock link of the graph windows. The graph button is
        hidden (`v-show` true shows it). The component stays: its clock link moves the graph windows and the detached
        windows. -->
        <LabGraph v-if="!frozen && mock === null && !follow" v-show="false" :beside="!panelOpen" />
        <!-- The focus ring and the bar of each pane of the split screen. -->
        <LabPanes v-if="!frozen" :panes="panes" />
        <SceneEditLayer v-if="!frozen" :edit="edit" :panel="editPanel" :scratch="scratch" :commands="commands" />
        <ImportDropLayer v-if="!frozen" :drop="importDrop" />
      </section>
      <!-- The content browser under the scene: the scene keeps its own frame. -->
      <LabDock
        v-if="browser !== null && browser.dock.value !== 'hidden'"
        :browser="browser"
        :fill="dockOnly"
        :timeline="params.get('timeline') !== '0' && mock === null"
      />
    </div>

    <LabPanel v-show="panelOpen" v-model:tab="tab" @hide="panelOpen = false" />
  </div>
</template>

<style scoped>
/* The scene is a size container: the cards of the 3D room size themselves on it. */
.lab__scene {
  container-type: size;
}

/* The scene fills the page to its edges: no margin and no round corners. */
.lab__scene > .scene-view {
  border-radius: 0;
}
</style>
