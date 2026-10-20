// SPDX-License-Identifier: Apache-2.0
// The editor window of Scenity Studio. The shell mounts the dock with the panels of the registry in the default layout.
// The dock opens, closes, floats, moves and maximizes a panel. It keeps its layout in the store and reads it again. The
// Window menu lists each panel of the registry.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import AdoptElement from "../../src/studio/shell/AdoptElement.vue";
import { bottomHeight, type Dock } from "../../src/studio/shell/dock";
import { memoryLayoutStore, storageLayoutStore } from "../../src/studio/shell/layoutStore";
import { copyOf, CORE_PANELS, PanelRegistry, panelTitle, studioHost } from "../../src/studio/shell/panels";
import { usePanelState } from "../../src/studio/shell/panelState";
import { regionElement, type CommandPort, type ShellContext } from "../../src/studio/shell/shell";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";
import { Workspaces } from "../../src/studio/shell/workspaceState";
import { WORKSPACES } from "../../src/studio/shell/workspaces";
import StudioShell from "../../src/studio/shell/StudioShell.vue";

/**
 * The core panels of the default Layout workspace (the Activity panel is in the Review workspace; the agent panel
 * needs the studio host).
 */
const LAYOUT_PANELS = CORE_PANELS.filter((spec) => spec.when?.() !== false)
  .map((spec) => spec.id)
  .filter((id) => Object.values(WORKSPACES[0]?.areas ?? {}).some((ids) => ids.includes(id)))
  .sort();

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

async function shell(
  store = memoryLayoutStore(),
  commands?: CommandPort,
): Promise<{ dock: Dock; registry: PanelRegistry; context: ShellContext }> {
  const registry = new PanelRegistry();
  const view = regionElement("view");
  view.dataset.testid = "studio-view";
  registry.setContent("scene.view", { component: AdoptElement, props: { element: view } });
  const found: { dock: Dock | null } = { dock: null };
  const context: ShellContext = {
    registry,
    regions: {
      bar: regionElement("bar"),
      tools: regionElement("tools"),
      clock: regionElement("clock"),
      view,
      status: regionElement("status"),
    },
    workspaces: new Workspaces(store),
    notices: new WindowNotices(),
    status: new WindowStatus(),
    ...(commands === undefined ? {} : { commands }),
    ready: (dock) => (found.dock = dock),
  };
  const host = document.createElement("div");
  host.style.width = "1200px";
  host.style.height = "800px";
  document.body.append(host);
  mounted.push(mount(StudioShell, { props: { context }, attachTo: host }));
  if (found.dock === null) throw new Error("no dock");
  // dockview-vue renders the panels and the tabs in portals on the next tick.
  await flushPromises();
  return { dock: found.dock, registry, context };
}

describe("the dock of the editor window", () => {
  it("opens every core panel in the default layout, with the Scene view and its region", async () => {
    const { dock } = await shell();
    expect(dock.panels().sort()).toEqual(LAYOUT_PANELS);
    expect(document.querySelector("[data-testid=studio-view]")?.isConnected).toBe(true);
    expect(dock.state()).toMatchObject({ maximized: false, floating: [] });
  });

  it("adds the agent panel to a default layout when the studio answers, with no focus", async () => {
    const { dock } = await shell();
    dock.adopt("agent");
    expect(dock.isOpen("agent")).toBe(false);
    studioHost.value = true;
    try {
      dock.adopt("agent");
      expect(dock.isOpen("agent")).toBe(true);
      expect(dock.api.getPanel("agent")?.group.activePanel?.id).toBe("inspector");
    } finally {
      studioHost.value = false;
    }
  });

  it("closes, opens again, floats, docks and maximizes a panel", async () => {
    const { dock } = await shell();
    dock.close("rules");
    expect(dock.isOpen("rules")).toBe(false);
    dock.open("rules");
    expect(dock.state().active).toBe("rules");
    dock.toggleFloat();
    expect(dock.state().floating).toEqual(["rules"]);
    dock.toggleFloat();
    expect(dock.state().floating).toEqual([]);
    dock.toggleMaximize();
    expect(dock.state().maximized).toBe(true);
    dock.toggleMaximize();
    expect(dock.state().maximized).toBe(false);
    dock.close("scene.view");
    expect(dock.isOpen("scene.view")).toBe(true);
  });

  it("keeps the layout in its store and reads it back; a layout it cannot read gives the default", async () => {
    const store = memoryLayoutStore();
    const first = await shell(store);
    first.dock.close("material");
    first.dock.moveTo("hierarchy", "right");
    const saved = JSON.stringify(store.value);
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    const second = await shell(store);
    expect(second.dock.isOpen("material")).toBe(false);
    expect(JSON.stringify(store.value)).toBe(saved);
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    const broken = await shell(memoryLayoutStore({ grid: "not a layout" }));
    expect(broken.dock.panels().length).toBe(LAYOUT_PANELS.length);
  });

  it("lists each panel of the registry in the Window menu", async () => {
    const { registry } = await shell();
    registry.register({ id: "demo.panel", title: "panel-unknown", icon: CORE_PANELS[0]!.icon, area: "right" });
    await nextTick();
    const trigger = document.querySelector<HTMLButtonElement>("[data-testid=menu-window]");
    trigger?.focus();
    trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    const items = [...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent.trim());
    expect(items).toEqual(expect.arrayContaining(["Scene", "Inspector", "Hierarchy", "Project", "Preferences"]));
    expect(items).toContain("This panel is not available in this project.");
    expect(items).toContain("Reset the layout");
  });
});

describe("the menu bar", () => {
  it("makes the menus from the metadata of the commands, with the keys and the reason of an entry that is off", async () => {
    const ran: string[] = [];
    const port: CommandPort = {
      menuCommands: () => [
        { id: "history.undo", menu: "edit", label: "Undo", shortcut: "⌘Z", available: true, reason: null },
        { id: "entity.copy", menu: "edit", label: "Copy", shortcut: "⌘C", available: false, reason: "No selection." },
        { id: "theme.light", menu: "window/theme", label: "Light", shortcut: "", available: true, reason: null },
      ],
      run: (id) => {
        ran.push(id);
        return null;
      },
      listen: () => () => undefined,
      keyRows: () => [],
    };
    await shell(memoryLayoutStore(), port);
    // A menu with no command (Assets) does not show.
    expect(document.querySelector("[data-testid=menu-assets]")).toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>("[data-testid=menu-edit]");
    trigger?.focus();
    trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    const undo = document.querySelector<HTMLElement>('[role=menuitem][data-command="history.undo"]');
    const copy = document.querySelector<HTMLElement>('[role=menuitem][data-command="entity.copy"]');
    expect(undo?.textContent).toContain("⌘Z");
    expect(copy?.hasAttribute("data-disabled")).toBe(true);
    expect(copy?.getAttribute("title")).toBe("No selection.");
    undo?.click();
    await flushPromises();
    expect(ran).toEqual(["history.undo"]);
  });
});

describe("the fold of the sides on a small screen", () => {
  const visible = (dock: Dock, id: string): boolean | undefined => dock.api.getPanel(id)?.group.api.isVisible;

  it("hides the sides, shows one side from its rail, and folds it when the centre is active", async () => {
    const { dock } = await shell();
    dock.fold.setFolded(true);
    await flushPromises();
    expect(dock.state()).toMatchObject({ folded: true, shown: null });
    expect(visible(dock, "hierarchy")).toBe(false);
    expect(visible(dock, "inspector")).toBe(false);
    expect(visible(dock, "scene.view")).toBe(true);
    expect(document.querySelector("[data-testid=studio-rail-left]")?.textContent).toContain("Hierarchy");
    document.querySelector<HTMLButtonElement>('[data-testid="rail-tab-inspector"]')?.click();
    await flushPromises();
    expect(dock.state()).toMatchObject({ shown: "right", active: "inspector" });
    expect(visible(dock, "inspector")).toBe(true);
    expect(visible(dock, "hierarchy")).toBe(false);
    expect(document.querySelector('[data-testid="rail-tab-inspector"]')?.getAttribute("aria-pressed")).toBe("true");
    // A panel of the left side that becomes active (a key, the Window menu) shows the left side.
    dock.open("hierarchy");
    expect(dock.state().shown).toBe("left");
    dock.open("scene.view");
    expect(dock.state().shown).toBeNull();
    expect(visible(dock, "hierarchy")).toBe(false);
  });

  it("stores the layout with no folded group, and shows each group again on a large screen", async () => {
    const store = memoryLayoutStore();
    const { dock } = await shell(store);
    dock.fold.setFolded(true);
    dock.save();
    expect(JSON.stringify(dock.workspaces.layout(dock.workspaces.active()))).not.toContain('"visible":false');
    dock.fold.setFolded(false);
    await flushPromises();
    expect(visible(dock, "hierarchy")).toBe(true);
    expect(document.querySelector("[data-testid=studio-rail-left]")).toBeNull();
  });
});

describe("the panel registry", () => {
  it("opens numbered copies of a panel that can have many, and names them", async () => {
    const { dock, registry } = await shell();
    expect(dock.openCopy("inspector")).toBe("inspector#2");
    expect(dock.openCopy("inspector")).toBe("inspector#3");
    expect(dock.openCopy("hierarchy")).toBeNull();
    expect(copyOf("inspector#3")).toEqual({ base: "inspector", copy: 3 });
    expect(copyOf("scene.view")).toEqual({ base: "scene.view", copy: 1 });
    const translate = (message: string, args?: Record<string, string | number>): string =>
      message === "panel-copy" ? `${String(args?.title)} ${String(args?.copy)}` : message;
    expect(panelTitle(registry, "inspector#2", translate)).toBe("panel-inspector 2");
    await flushPromises();
    expect(document.querySelector('[data-testid="dock-tab-inspector#2"]')?.textContent).toContain("Inspector 2");
  });

  it("does not open a panel that is not available now", async () => {
    let ready = false;
    const { dock, registry } = await shell();
    registry.register({ ...CORE_PANELS[1]!, id: "later", area: "right", when: () => ready });
    dock.open("later");
    expect(dock.isOpen("later")).toBe(false);
    ready = true;
    dock.open("later");
    expect(dock.isOpen("later")).toBe(true);
  });

  it("keeps the state of a panel in the layout and gives it back after a restart", async () => {
    const Probe = defineComponent({
      setup() {
        const text = usePanelState("search", "");
        return () =>
          h("input", {
            "data-testid": "probe",
            value: text.value,
            onInput: (e: Event) => (text.value = (e.target as HTMLInputElement).value),
          });
      },
    });
    const store = memoryLayoutStore();
    const first = await shell(store);
    first.registry.setContent("rules", { component: Probe });
    first.dock.open("rules");
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("[data-testid=probe]");
    if (input === null) throw new Error("no probe");
    input.value = "lamp";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    const second = await shell(store);
    second.registry.setContent("rules", { component: Probe });
    second.dock.open("rules");
    await flushPromises();
    expect(document.querySelector<HTMLInputElement>("[data-testid=probe]")?.value).toBe("lamp");
  });
});

describe("the size of the bottom area", () => {
  it("is 30 % of the dock, and 240 px or more when the window has room", () => {
    expect(bottomHeight(1000)).toBe(300);
    expect(bottomHeight(655)).toBe(240);
    expect(bottomHeight(400)).toBe(180);
  });
});

describe("the layout store", () => {
  it("keeps nothing when the storage is closed", () => {
    const store = storageLayoutStore("scenity.studio.layout", () => {
      throw new Error("closed");
    });
    store.write({ a: 1 });
    expect(store.read()).toBeNull();
    const open = storageLayoutStore("scenity.studio.layout.test");
    open.write({ a: 1 });
    expect(open.read()).toEqual({ a: 1 });
    open.clear();
    expect(open.read()).toBeNull();
  });
});

// The tab of a panel shows the title of the registry and closes the panel.
describe("the tab of a panel", () => {
  it("names the panel and closes it", async () => {
    const { dock } = await shell();
    const tab = document.querySelector<HTMLElement>("[data-testid=dock-tab-rules]");
    expect(tab?.textContent).toContain("Rules");
    document.querySelector<HTMLElement>("[data-testid=dock-close-rules]")?.click();
    await nextTick();
    expect(dock.isOpen("rules")).toBe(false);
    expect(document.querySelector('[data-testid="dock-close-scene.view"]')).toBeNull();
  });
});
