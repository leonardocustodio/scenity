// SPDX-License-Identifier: Apache-2.0
/**
 * The editor window of the scene page in the edit mode: the one Vue app of the studio shell. The canvas and the
 * status line move into the Scene view panel, and the parts over the canvas follow the canvas there. The commands of
 * the shell (studio/shell/dockCommands.ts: `panel.open.<id>`, `panel.maximize`, `workspace.switch` and the others) go
 * into the key map and the command registry of the page. Thus each dock action works by keyboard, from a menu and for
 * an agent.
 */
import { createAnnouncer } from "@scenity/ui";
import { createApp } from "vue";
import StudioShellView from "../studio/shell/StudioShell.vue";
import type { Dock, LayoutDefaults } from "../studio/shell/dock";
import type { ShellCommandSpec } from "../studio/shell/dockCommands";
import { storageLayoutStore, type LayoutStore } from "../studio/shell/layoutStore";
import { copyOf, PanelRegistry } from "../studio/shell/panels";
import { WindowNotices } from "../studio/shell/dialogs";
import { WindowKeySheet } from "../studio/shell/keySheet";
import { WindowSearch } from "../studio/shell/search";
import { WindowStatus } from "../studio/shell/status";
import { hostPreferences } from "../studio/shell/hostPreferences";
import { docsLinkOf } from "./extensions/docsLinks";
import { panelDocsUrl } from "./panelDocs";
import { recordUsage } from "./usage/usageLog";
import { startTour, startTourOnce } from "../studio/tour/tour";
import { pageTheme, THEMES, type PageTheme } from "../studio/shell/theme";
import { syncWithHost } from "../studio/shell/hostLayouts";
import { Workspaces } from "../studio/shell/workspaceState";
import {
  regionElement,
  setCurrentShell,
  type CommandPort,
  type ShellRegions,
  type StudioShell,
} from "../studio/shell/shell";
import "../studio/shell/shell.css";
import "./editLayout.css";
import { editorI18n, messageIdOf, t, textOr } from "../texts";
import { tabPanel } from "./assetDock/tabPanels";
import SceneViewPanel from "./viewport/SceneViewPanel.vue";
import { setPartPlaces } from "./pageParts";
import { pageSettings } from "./settings/pageSettings";
import { syncKeymapWithHost } from "./settings/hostKeymap";
import { servedByStudio } from "./projects/noProject";
import { pageKeys, type PageKeyCommandSpec, type WindowCommand } from "./settings/pageKeys";
import { keyLabel } from "./settings/useSettingsPanel";

/** The commands of the theme: one for each theme, and one that enables or disables the high contrast. */
export function themeCommands(theme: PageTheme): PageKeyCommandSpec[] {
  return [
    ...THEMES.map((name) => ({
      id: `theme.${name}`,
      title: t("theme-use", { name: t(`settings-theme-${name}`) }),
      menu: "window/theme",
      run: () => void theme.set({ theme: name }),
    })),
    {
      id: "theme.contrast",
      menu: "window/theme",
      title: t("theme-contrast"),
      run: () => void theme.set({ contrast: theme.choice.value.contrast === "more" ? "standard" : "more" }),
    },
  ];
}

/** The help commands: the key sheet (`?`), the tour and the docs of the active panel (F1). */
function helpCommands(dock: Dock, sheet: WindowKeySheet): PageKeyCommandSpec[] {
  return [
    { id: "help.keys", title: t("help-command-keys"), keys: ["Shift+/"], menu: "help", run: () => sheet.open() },
    // Start the tour again.
    { id: "help.tour", title: t("help-command-tour"), menu: "help", agents: true, run: () => startTour() },
    {
      id: "help.context",
      title: t("help-command-context"),
      keys: ["F1"],
      inText: true,
      menu: "help",
      run: () => {
        const panel = copyOf(dock.api.activePanel?.id ?? "").base;
        // A panel of a plugin opens the docs of the plugin.
        const own = docsLinkOf(`panel:${panel}`);
        if (own !== null) {
          window.open(own, "_blank", "noopener");
          return;
        }
        // F1 in a field of a component card opens the docs of the component, else the section of the panel.
        const card = document.activeElement?.closest("[data-docs]")?.getAttribute("data-docs") ?? null;
        window.open(card ?? panelDocsUrl(panel), "_blank", "noopener");
      },
    },
  ];
}

/** The label of a command in a menu: its short menu text, else its title in the language of the page. */
function menuLabel(command: WindowCommand): string {
  return textOr(
    messageIdOf("menu-item", command.id),
    textOr(messageIdOf("settings-command", command.id), command.title),
  );
}

/** The commands of the window for the menu bar (the one registry of pageKeys.ts). */
function commandPort(): CommandPort {
  return {
    menuCommands: () =>
      pageKeys()
        .list()
        .flatMap((command) => {
          if (command.menu === null) return [];
          const [first] = command.keys;
          return [
            {
              id: command.id,
              menu: command.menu,
              label: menuLabel(command),
              shortcut: first === undefined ? "" : keyLabel(first),
              available: command.available,
              reason: command.reason,
            },
          ];
        }),
    run: (id) => pageKeys().run(id),
    has: (id) =>
      pageKeys()
        .commands()
        .some((command) => command.id === id),
    execute: (id, args) => pageKeys().execute(id, args),
    listen: (listener) => pageKeys().listen(listener),
    keyRows: () =>
      pageKeys()
        .infos()
        .map((info) => ({
          id: info.id,
          label: textOr(messageIdOf("settings-command", info.id), info.title),
          context: info.context,
          keys: info.keys.map(keyLabel),
          keyKind: info.keyKind,
        })),
  };
}

/** The bottom panel and height of the editor settings for a new layout. */
function layoutDefaults(): LayoutDefaults {
  const { dock } = pageSettings().value;
  return { bottomPanel: tabPanel(dock.tab), bottomPx: Math.round(dock.height * 16) };
}

/**
 * The default workspace of the project (the `layout.workspace` setting of the project) for a person with no
 * workspace. The editor window shows it when the project settings are available.
 */
function useProjectWorkspace(dock: Dock): void {
  const stop = pageSettings().listen((settings) => {
    stop();
    if (settings.layout.workspace !== dock.workspaces.active()) dock.switchTo(settings.layout.workspace);
  });
}

function regions(): ShellRegions {
  const view = regionElement("view");
  view.dataset.testid = "studio-view";
  return {
    bar: regionElement("bar"),
    tools: regionElement("tools"),
    clock: regionElement("clock"),
    view,
    status: regionElement("status"),
  };
}

/** In the studio, the host also keeps the workspace state, the key map, the theme and the preferences of the person. */
async function syncHost(workspaces: Workspaces, reload: () => void, theme: PageTheme): Promise<void> {
  if (!(await servedByStudio())) return;
  await Promise.all([
    syncWithHost(workspaces, reload),
    syncKeymapWithHost(pageSettings()),
    theme.useHost(),
    hostPreferences().use(),
  ]);
}

/** Mount the studio shell. The canvas moves into the Scene view. */
export function startShell(canvas: HTMLCanvasElement, store: LayoutStore = storageLayoutStore()): StudioShell {
  const registry = new PanelRegistry();
  const workspaces = new Workspaces(store);
  const notices = new WindowNotices();
  const status = new WindowStatus();
  const search = new WindowSearch();
  const keySheet = new WindowKeySheet();
  const places = regions();
  places.view.append(canvas);
  // The parts of the page that exist before the shell: the status line and the inspect panel.
  for (const id of ["status", "scene-inspect"]) {
    const element = document.getElementById(id);
    if (element !== null) places.view.append(element);
  }
  // The Scene view panel keeps the places of the overlays of the view in its state.
  registry.setContent("scene.view", { component: SceneViewPanel, props: { element: places.view }, plain: true });
  setPartPlaces(places);
  document.body.dataset.sceneLayout = "edit";
  const host = document.createElement("div");
  host.id = "studio";
  document.body.append(host);
  const started: { dock: Dock | null; commands: readonly ShellCommandSpec[] } = { dock: null, commands: [] };
  const app = createApp(StudioShellView, {
    context: {
      registry,
      regions: places,
      workspaces,
      notices,
      status,
      search,
      keySheet,
      commands: commandPort(),
      defaults: layoutDefaults,
      ready: (dock: Dock, commands: readonly ShellCommandSpec[]) => {
        started.dock = dock;
        started.commands = commands;
      },
    },
  });
  app.use(editorI18n().plugin).use(createAnnouncer()).mount(host);
  const dock = started.dock;
  if (dock === null) throw new Error("The dock of the editor window did not start.");
  const theme = pageTheme();
  // The usage log of a study. It records only when the person enables it, and it stays in this browser.
  pageKeys().ran = (id, how) => recordUsage(pageSettings().value.usage.log, { at: Date.now(), command: id, how });
  // A toast shows the cause when a command of the person fails after its start.
  pageKeys().failed = (id, error) =>
    notices.toast(t("command-failed", { id }), error instanceof Error ? error.message : String(error), "alert");
  const stopKeys = pageKeys().register([...started.commands, ...themeCommands(theme), ...helpCommands(dock, keySheet)]);
  const shell: StudioShell = {
    registry,
    regions: places,
    dock,
    notices,
    status,
    search,
    keySheet,
    setPanel: (id, content) => registry.setContent(id, content),
    showPanel: (id) => dock.open(id),
    unmount: () => {
      stopKeys();
      app.unmount();
      setPartPlaces({});
      setCurrentShell(null);
    },
  };
  setCurrentShell(shell);
  // The theme of the person: first from the browser, then from the host preferences in the studio.
  theme.start();
  // The tour at the first open of the editor (not under automation).
  startTourOnce();
  if (!workspaces.chosen()) useProjectWorkspace(dock);
  void syncHost(workspaces, () => dock.reload(), theme);
  return shell;
}
