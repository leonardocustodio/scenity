// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the editor window that the edit mode starts after the scene editor. They include the providers of the
 * search box, the file and project commands, the UI calls of the agents and the one state call.
 */
import { startTutorials } from "./tutorials/startTutorials";
import type { StudioShell } from "../studio/shell/shell";
import type { EditParts } from "./editMode";
import { materialsOf } from "./material/editMaterials";
import { fileCommands, type FileCommandParts } from "./projects/fileCommands";
import type { PageScenes } from "./projects/pageScenes";
import type { ScenePageEditor } from "./sceneEditor";
import { startSearch, type SearchSources } from "./searchProviders";
import type { PageSequence } from "./sequencer/pageSequence";
import type { ViewportInfo } from "./viewport/viewportTypes";
import { pageKeys } from "./settings/pageKeys";
import { startUi } from "./uiCalls";
import { startDocumentSync } from "./documentSync";
import { startWindowIdentity } from "./windowIdentity";
import ActivityPanel from "./activity/ActivityPanel.vue";
import { startConsole } from "./console/startConsole";
import { startProblems } from "./problems/startProblems";
import { startSearchWindow } from "./search/startSearchWindow";
import TagsPanel from "./tags/TagsPanel.vue";
import { startNotes } from "./notes/startNotes";
import { startVariants } from "./variants/startVariants";
import { startSimulation } from "./simulation/startSimulation";
import { startAnimator } from "./animator/startAnimator";
import { startAssetPanels } from "../assetBrowser/startAssetPanels";
import { startPerformance } from "./performance/startPerformance";
import { startBuild } from "./build/startBuild";
import { startShortcuts } from "./shortcuts/startShortcuts";
import { startVcs } from "./vcs/startVcs";
import { startJobs } from "./jobs/startJobs";
import { startStudioPlugins } from "./extensions/startStudioPlugins";
import { startCharacterSetup } from "./character/startCharacterSetup";
import { startClipBrowser } from "./clips/startClipBrowser";
import { startSelectionTools } from "./selectionCommands";
import ScenesPanel from "./projects/ScenesPanel.vue";
import HistoryPanel from "./history/HistoryPanel.vue";
import { shallowRef, watchEffect } from "vue";
import { goToCommand, watchHistory } from "./history/historyRows";
import { lastPanel, startAgentPanel } from "./agent/agentPanel";
import { pageActivity } from "./activity/activityLog";
import { startStudioState } from "./studioState";
import { readProposalMode } from "@scenity/editor-core";

/** What the window parts read of the page. */
export interface WindowPartsInput {
  readonly parts: EditParts;
  readonly editor: ScenePageEditor;
  readonly scenes: PageScenes | null;
  readonly shell: StudioShell;
  readonly sequence: PageSequence | null;
}

/** The parts of the page that the file and project commands use. */
function fileCommandParts(
  parts: EditParts,
  editor: ScenePageEditor,
  scenes: PageScenes | null,
  shell: StudioShell,
): FileCommandParts {
  return {
    editor,
    scenes,
    files: parts.files,
    materials: materialsOf(parts),
    ...(parts.checkRules === undefined ? {} : { checkRules: parts.checkRules }),
    ...(parts.selection === undefined ? {} : { selection: parts.selection }),
    prefabs: parts.prefabs,
    notices: shell.notices,
    openSequence: (path) => {
      const url = new URL(location.href);
      url.searchParams.set("sequence", path);
      // First the command sends its answer (an agent call waits for it). Then the page loads again.
      setTimeout(() => location.assign(url), 300);
    },
  };
}

/** The parts of the page that the search box reads. */
function searchSources(
  parts: EditParts,
  editor: ScenePageEditor,
  scenes: PageScenes | null,
  shell: StudioShell,
): SearchSources {
  return {
    project: parts.project,
    document: () => editor.doc,
    select: (ids) => parts.selection?.set(ids),
    sceneFiles: async () => (await scenes?.projectScenes())?.files.map((file) => file.path) ?? [],
    openScene: (path) => void scenes?.open(path),
    showPanel: (id) => shell.showPanel(id),
  };
}

/** The Scenes panel of the open scenes (none in the prefab mode). */
function startScenesPanel(shell: StudioShell, scenes: PageScenes | null, project: string): void {
  if (scenes === null) return;
  const base = `/projects/${project}/`;
  shell.setPanel("scenes", {
    component: ScenesPanel,
    props: { scenes, base, newScene: () => void pageKeys().run("scene.new") },
  });
}

/** The History panel, the command that goes to a step, and the steps of Undo and Redo in the toolbar. */
function startHistoryParts(shell: StudioShell, editor: ScenePageEditor): void {
  const history = watchHistory(editor.channel.history);
  shell.setPanel("history", {
    component: HistoryPanel,
    props: { rows: () => history.rows.value, goTo: (index: number) => editor.channel.goTo(index) },
  });
  pageKeys().register([goToCommand((index) => editor.channel.goTo(index))]);
  watchEffect(() => {
    const rows = history.rows.value;
    const at = rows.findIndex((row) => row.current);
    const undo = at > 0 ? (rows[at]?.title ?? null) : null;
    shell.status.set("history", { undo, redo: rows[at + 1]?.title ?? null });
  });
}

/** The Tags panel over the document of the editor. */
function startTagsPanel(shell: StudioShell, editor: ScenePageEditor, selection: EditParts["selection"]): void {
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  shell.setPanel("tags", {
    component: TagsPanel,
    props: {
      doc,
      select: (ids: readonly string[]) => selection?.set([...ids]),
      run: async (command: string, args: Readonly<Record<string, unknown>>) => {
        try {
          await pageKeys().execute(command, args);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    },
  });
}

/** The panels over the open scene, and the other panels and windows of the project. */
function startScenePanels(shell: StudioShell, editor: ScenePageEditor, parts: EditParts): void {
  // The notes: the note file of the scene, the pins in the Scene view, the Notes panel.
  startNotes({
    ...{ shell, editor, files: parts.files, canvas: parts.canvas, selection: parts.selection },
    camera: () => parts.camera(),
    editorView: () => parts.editorView?.() ?? null,
  });
  // The Variants panel (the override layers of the scene, the compare wipe).
  startVariants({
    ...{ shell, editor, files: parts.files, registry: editor.registry, viewport: parts.viewport },
    patch: (ops) => parts.patch(ops),
  });
  // The Tags panel (the tags and the pick layers, a rename across the scene).
  startTagsPanel(shell, editor, parts.selection);
  // The Simulation panel, the Animator window, the character setup and the clip browser.
  startSimulation(shell, parts.project, parts.files);
  startAnimator(shell, editor, parts.selection);
  startCharacterSetup(shell, editor, parts.selection, parts.canvas, parts.viewport);
  startClipBrowser(shell, editor, parts.selection, parts.viewport);
  // The Build window (the build, its report, the size budgets of the entries).
  const project = () => parts.rules?.project.project ?? null;
  startBuild(
    shell,
    `/projects/${parts.project}/`,
    () => project()?.scenes ?? [],
    editor,
    () => project()?.sequences ?? [],
  );
  // The Performance panel (the frame statistics, the cost of each entity, the render switches).
  startPerformance(shell, parts.selection, `/projects/${parts.project}/`);
  // The asset build panel and the Rights panel of the project.
  startAssetPanels(shell, `/projects/${parts.project}/`, () => editor.file.path);
  // The Shortcuts window.
  startShortcuts(shell);
  // The version control panel.
  startVcs(shell, parts.project, editor);
  // The Jobs panel.
  startJobs(shell, parts.project);
  // The studio faces of the project plugins.
  void startStudioPlugins({
    shell,
    project: parts.project,
    editor,
    canvas: parts.canvas,
    ...(parts.selection === undefined ? {} : { selection: parts.selection }),
  });
}

/**
 * The current view of the viewport, or null. The viewport is a lazy chunk, and its API throws before the chunk runs.
 * The agent panel reads the view in its first render. A throw there stops the panel and then the changes of the dock.
 */
function viewNow(): ViewportInfo | null {
  try {
    return globalThis.__scenity?.viewport?.() ?? null;
  } catch {
    return null;
  }
}

/** Start the window parts of the edit mode. */
export function startWindowParts(input: WindowPartsInput): void {
  const { parts, editor, scenes, shell, sequence } = input;
  startSearch(shell.search, searchSources(parts, editor, scenes, shell));
  pageKeys().register(fileCommands(fileCommandParts(parts, editor, scenes, shell)));
  startStudioState({
    project: parts.project,
    document: () => editor.doc,
    file: () => ({ path: editor.file.path, dirty: editor.dirty }),
    selection: () => parts.selection?.ids ?? [],
    prefabs: () => Object.keys(editor.prefabs).sort(),
    sequence: () => sequence?.path ?? null,
    mode: readProposalMode,
  });
  // The changes of the scene go to the other windows of the studio (and come from them).
  startDocumentSync({
    editor,
    project: parts.project,
    ...(parts.selection === undefined ? {} : { selection: parts.selection }),
  });
  // The title and the icon of the window.
  startWindowIdentity(editor, parts.project);
  // The Scenes panel (the open scenes are tabs of the file bar).
  startScenesPanel(shell, scenes, parts.project);
  // The selection tools and the selection history.
  startSelectionTools({ doc: () => editor.doc, notices: shell.notices }, parts.selection);
  // The Problems panel (its counts and its press in the status bar).
  startProblems({
    ...{ shell, editor, sequence, rules: parts.rules, assets: parts.assets ?? [], selection: parts.selection },
    base: `/projects/${parts.project}/`,
  });
  startScenePanels(shell, editor, parts);
  // The Search window (⌘⇧K, and ⌥↩ in the search box).
  startSearchWindow(shell, editor, parts.selection, parts.project);
  // The Console panel, and the failed jobs of the studio host.
  startConsole(shell, editor, parts.selection);
  // The Activity panel.
  shell.setPanel("activity", { component: ActivityPanel, props: { log: pageActivity() } });
  startHistoryParts(shell, editor);
  // The tutorials (Help → Tutorials).
  startTutorials({
    editor,
    selection: () => parts.selection?.ids ?? [],
    sequence: () => sequence?.channel.doc ?? null,
    playing: () => sequence?.time.playing() ?? false,
  });
  // The agent panel, when the studio host serves the window.
  startAgentPanel(shell, parts.project, {
    editor,
    canvas: parts.canvas,
    selection: () => parts.selection?.ids ?? [],
    time: () => (sequence === null ? null : { sequence: sequence.path, ms: sequence.time.now() }),
    view: viewNow,
    ...(parts.viewport === undefined ? {} : { viewport: parts.viewport }),
    panel: lastPanel(shell),
    search: shell.search,
    rules: () => parts.rules?.project.rules ?? [],
    commandTitle: (id) =>
      pageKeys()
        .list()
        .find((command) => command.id === id)?.title ?? id,
    show: (ids) => {
      parts.selection?.set(ids);
      void globalThis.__scenity?.frameSelection?.();
    },
    openReview: () => shell.showPanel("review"),
    pick: async (x, y) => {
      const hit = await parts.pick(x, y);
      return hit === null ? null : { entity: hit.entity, point: hit.point };
    },
  });
  startUi({
    registry: editor.registry,
    ...(parts.selection === undefined ? {} : { selection: parts.selection }),
    scene: () => editor.file.path,
    time: () => sequence?.time.now() ?? null,
  });
}
