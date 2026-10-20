// SPDX-License-Identifier: Apache-2.0
// The workspaces of the editor window. Each workspace opens its panels, keeps its own layout and gives it back after a
// restart. The tests also cover the workspaces of the person (save as, rename, delete), the reset and the old stored
// layout. They also cover the copy of the workspace state in the user state of the studio host.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AdoptElement from "../../src/studio/shell/AdoptElement.vue";
import type { Dock } from "../../src/studio/shell/dock";
import { syncWithHost } from "../../src/studio/shell/hostLayouts";
import { memoryLayoutStore } from "../../src/studio/shell/layoutStore";
import { PanelRegistry } from "../../src/studio/shell/panels";
import { regionElement } from "../../src/studio/shell/shell";
import StudioShell from "../../src/studio/shell/StudioShell.vue";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";
import { Workspaces, workspacesDoc, WORKSPACES_FORMAT } from "../../src/studio/shell/workspaceState";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

async function shell(store = memoryLayoutStore()): Promise<{ dock: Dock; workspaces: Workspaces }> {
  const registry = new PanelRegistry();
  const view = regionElement("view");
  registry.setContent("scene.view", { component: AdoptElement, props: { element: view } });
  const workspaces = new Workspaces(store);
  const found: { dock: Dock | null } = { dock: null };
  const regions = {
    bar: regionElement("bar"),
    tools: regionElement("tools"),
    clock: regionElement("clock"),
    view,
    status: regionElement("status"),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const notices = new WindowNotices();
  const status = new WindowStatus();
  const context = { registry, regions, workspaces, notices, status, ready: (dock: Dock) => (found.dock = dock) };
  mounted.push(mount(StudioShell, { props: { context }, attachTo: host }));
  if (found.dock === null) throw new Error("no dock");
  await flushPromises();
  return { dock: found.dock, workspaces };
}

describe("the workspaces", () => {
  it("opens the panels of each workspace and keeps the layout of each one", async () => {
    const store = memoryLayoutStore();
    const { dock } = await shell(store);
    expect(dock.state().workspace).toBe("layout");
    expect(dock.panels().sort()).toEqual(
      [
        "console",
        "game.view",
        "hierarchy",
        "inspector",
        "jobs",
        "lighting",
        "material",
        "notes",
        "preferences",
        "problems",
        "project",
        "review",
        "rules",
        "scene.view",
        "scenes",
        "timeline",
        "variants",
      ].sort(),
    );
    dock.switchTo("animate");
    expect(dock.panels().sort()).toEqual(
      [
        "animator",
        "character",
        "clips",
        "game.view",
        "hierarchy",
        "inspector",
        "project",
        "scene.view",
        "timeline",
      ].sort(),
    );
    expect(dock.areaOf("timeline")).toBe("bottom");
    dock.close("project");
    dock.switchTo("assets");
    expect(dock.areaOf("project")).toBe("left");
    dock.switchTo("animate");
    expect(dock.isOpen("project")).toBe(false);
    // A restart gives the active workspace and its layout back.
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    const again = await shell(store);
    expect(again.dock.state().workspace).toBe("animate");
    expect(again.dock.isOpen("project")).toBe(false);
    again.dock.reset();
    expect(again.dock.isOpen("project")).toBe(true);
  });

  it("saves a layout as a workspace of the person, renames it and deletes it", async () => {
    const { dock, workspaces } = await shell();
    dock.close("rules");
    const id = dock.saveAs("My layout");
    expect(workspaces.active()).toBe(id);
    expect(workspaces.list().at(-1)).toMatchObject({ id, name: "My layout", custom: true });
    workspaces.rename(id, "Lighting");
    expect(workspaces.list().at(-1)?.name).toBe("Lighting");
    dock.switchTo("layout");
    expect(dock.isOpen("rules")).toBe(false);
    dock.switchTo(id);
    dock.removeWorkspace(id);
    expect(workspaces.active()).toBe("layout");
    expect(workspaces.list().some((entry) => entry.id === id)).toBe(false);
  });

  it("reads an older bare layout as the layout of the workspace Layout", () => {
    expect(workspacesDoc({ grid: {} })).toEqual({
      format: WORKSPACES_FORMAT,
      active: "layout",
      layouts: { layout: { grid: {} } },
      custom: [],
    });
    expect(workspacesDoc(null).active).toBe("layout");
  });

  it("shows the workspace tabs and switches with a press", async () => {
    const { dock } = await shell();
    const tab = document.querySelector<HTMLButtonElement>("[data-testid=workspace-review]");
    expect(document.querySelector("[data-testid=workspace-layout]")?.getAttribute("aria-selected")).toBe("true");
    tab?.click();
    await flushPromises();
    expect(dock.state().workspace).toBe("review");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("the copy in the studio host", () => {
  function host(initial: unknown): {
    fetcher: (input: string, init?: RequestInit) => Promise<Response>;
    puts: unknown[];
  } {
    const puts: unknown[] = [];
    let file = { format: "scenity.studio-layouts/1", scopes: initial === undefined ? {} : { "*": initial } };
    const fetcher = (input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "PUT") {
        file = JSON.parse(typeof init.body === "string" ? init.body : "{}") as typeof file;
        puts.push(file.scopes["*"]);
      }
      return Promise.resolve(new Response(JSON.stringify(file), { status: input.endsWith("/layouts") ? 200 : 404 }));
    };
    return { fetcher, puts };
  }

  it("takes the copy of the host at the start and sends each change", async () => {
    const workspaces = new Workspaces(memoryLayoutStore());
    const remote = { format: WORKSPACES_FORMAT, active: "build", layouts: {}, custom: [] };
    const fake = host(remote);
    let shown = 0;
    const stop = await syncWithHost(workspaces, () => (shown += 1), fake.fetcher);
    expect(workspaces.active()).toBe("build");
    expect(shown).toBe(1);
    workspaces.setActive("review");
    await new Promise((done) => setTimeout(done, 500));
    expect(fake.puts.at(-1)).toMatchObject({ active: "review" });
    stop();
  });

  it("sends a change that waits when the page goes (a reload)", async () => {
    const workspaces = new Workspaces(memoryLayoutStore());
    const fake = host({ format: WORKSPACES_FORMAT, active: "layout", layouts: {}, custom: [] });
    const stop = await syncWithHost(workspaces, () => undefined, fake.fetcher);
    workspaces.setActive("animate");
    expect(fake.puts).toEqual([]);
    globalThis.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(fake.puts.at(-1)).toMatchObject({ active: "animate" });
    stop();
  });

  it("gives the host the copy of the browser when the host has none", async () => {
    const workspaces = new Workspaces(
      memoryLayoutStore({ format: WORKSPACES_FORMAT, active: "assets", layouts: {}, custom: [] }),
    );
    const fake = host(undefined);
    const stop = await syncWithHost(workspaces, () => undefined, fake.fetcher);
    expect(fake.puts).toEqual([workspaces.doc]);
    stop();
  });
});
