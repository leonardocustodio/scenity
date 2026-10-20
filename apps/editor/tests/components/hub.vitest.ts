// SPDX-License-Identifier: Apache-2.0
// The Hub of Scenity Studio: the list of projects (search, sort, pinned first, the marks), and the new project steps (a
// create job, a Git job, the open). Also the first run, the import of the browser keys, and the client of the host API
// (the CSRF header, the errors). Also the templates of the person in the wizard, and "Save as a template".
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import HubApp from "../../src/hub/HubApp.vue";
import { childPath, makeNewProject, PROJECT_NAME } from "../../src/hub/makeProject";
import SaveTemplateDialog from "../../src/hub/SaveTemplateDialog.vue";
import { studioApi, StudioError, type DataTemplate } from "../../src/hub/studioApi";
import { browserKeys, importBrowserKeys, useHub, visibleProjects } from "../../src/hub/useHub";
import { t } from "../../src/texts";
import { fakeApi, project, type FakeApi } from "./hubFakes";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

async function mountHub(api: FakeApi) {
  const hub = useHub(api);
  const wrapper = mount({ render: () => h(HubApp, { hub }) }, { attachTo: document.body });
  mounted.push(wrapper);
  await hub.load();
  await flushPromises();
  return { hub, wrapper };
}

describe("visibleProjects", () => {
  const list = [
    project("alpha", { lastOpened: "2026-10-01T00:00:00Z" }),
    project("beta", { lastOpened: "2026-10-03T00:00:00Z" }),
    project("gamma", { lastOpened: "2026-10-02T00:00:00Z", pinned: true }),
  ];

  it("puts the pinned projects first, then the last opened", () => {
    expect(visibleProjects(list, "", "recent").map((p) => p.key)).toEqual(["gamma", "beta", "alpha"]);
    expect(visibleProjects(list, "", "name").map((p) => p.key)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("finds the projects that have each word of the search", () => {
    expect(visibleProjects(list, "  BET ", "recent").map((p) => p.key)).toEqual(["beta"]);
    expect(visibleProjects(list, "work alpha", "recent").map((p) => p.key)).toEqual(["alpha"]);
    expect(visibleProjects(list, "delta", "recent")).toEqual([]);
  });
});

describe("the new project steps", () => {
  it("runs create in the parent folder, then git init in the new folder, then opens it", async () => {
    const api = fakeApi();
    const hub = useHub(api);
    const result = await makeNewProject(hub, {
      name: "demo",
      template: "empty",
      parent: "/home/me/work/",
      git: true,
      packages: "linked",
    });
    expect(result).toEqual({ kind: "opened", url: "/p/demo/", dir: "/home/me/work/demo" });
    expect(api.jobs).toEqual([
      {
        command: "create",
        args: { name: "demo", template: "empty", install: true, json: true },
        cwd: "/home/me/work/",
      },
      { command: "git.init", cwd: "/home/me/work/demo" },
    ]);
    expect(api.calls).toEqual(["open /home/me/work/demo"]);
  });

  it("stops after a failed create and opens nothing", async () => {
    const api = fakeApi();
    api.jobEnd.create = "failed";
    const result = await makeNewProject(useHub(api), {
      name: "demo",
      template: "sample:spin",
      parent: "/w",
      git: true,
      packages: "linked",
    });
    expect(result.kind).toBe("failed");
    expect(api.jobs.map((job) => job.command)).toEqual(["create"]);
    expect(api.calls).toEqual([]);
  });

  it("asks for the published packages with the npm option", async () => {
    const api = fakeApi();
    await makeNewProject(useHub(api), { name: "demo", template: "empty", parent: "/w", git: false, packages: "npm" });
    expect(api.jobs).toEqual([
      {
        command: "create",
        args: { name: "demo", template: "empty", install: true, json: true, version: "latest" },
        cwd: "/w",
      },
    ]);
  });

  it("checks the name and joins the paths with the separator of the parent", () => {
    expect(PROJECT_NAME.test("my-scene_2")).toBe(true);
    expect(PROJECT_NAME.test("my scene")).toBe(false);
    expect(PROJECT_NAME.test("")).toBe(false);
    expect(childPath("C:\\work\\", "demo")).toBe("C:\\work\\demo");
    expect(childPath("/work", "demo")).toBe("/work/demo");
  });
});

describe("the Hub page", () => {
  it("shows the empty state with the two first actions when there is no project", async () => {
    const { wrapper } = await mountHub(fakeApi());
    expect(wrapper.find("[data-testid=hub-projects-empty]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=hub-new-project]").text()).toContain("New project");
    expect(wrapper.find("[data-testid=hub-open]").exists()).toBe(true);
  });

  it("lists the projects with their marks and filters them with the search", async () => {
    const api = fakeApi([
      project("demo", { pinned: true, git: { branch: "main", changed: 2 } }),
      project("lost", { exists: false }),
      project("future", { newer: true }),
      project("plugin", { runsCode: true, trusted: false }),
    ]);
    const { wrapper } = await mountHub(api);
    const items = wrapper.findAll("[data-project]");
    expect(items.map((item) => item.attributes("data-project"))).toEqual(["demo", "lost", "future", "plugin"]);
    expect(items[0]?.text()).toContain("main · 2 changed");
    expect(wrapper.find("[data-project=lost] [data-testid=hub-project-missing]").exists()).toBe(true);
    expect(wrapper.find("[data-project=future]").text()).toContain("newer Scenity");
    expect(wrapper.find("[data-project=plugin]").text()).toContain("restricted until you trust it");
    await wrapper.find("[data-testid=hub-search]").setValue("plug");
    expect(wrapper.findAll("[data-project]").map((item) => item.attributes("data-project"))).toEqual(["plugin"]);
  });

  it("switches the sections from the side navigation", async () => {
    const { wrapper } = await mountHub(fakeApi());
    await wrapper.find("[data-testid=hub-nav-learn]").trigger("click");
    expect(wrapper.find("[data-testid=hub-learn]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=hub-nav-learn]").attributes("aria-current")).toBe("page");
    await wrapper.find("[data-testid=hub-nav-agents]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=agents-claude]").text()).toContain("2.1.0");
    await wrapper.find("[data-testid=hub-nav-settings]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-check=chromium]").attributes("data-state")).toBe("missing");
    expect(wrapper.find("[data-check=webgpu]").exists()).toBe(true);
  });

  it("runs the first run once and saves firstRunDone at the end", async () => {
    const api = fakeApi([], { firstRunDone: false });
    await mountHub(api);
    const dialog = (): HTMLElement | null => document.querySelector("[data-testid=first-run]");
    expect(dialog()?.dataset.step).toBe("1");
    document.querySelector<HTMLButtonElement>("[data-testid=first-next]")?.click();
    await flushPromises();
    expect(dialog()?.dataset.step).toBe("2");
    document.querySelector<HTMLButtonElement>("[data-testid=first-skip]")?.click();
    await flushPromises();
    expect(api.studio.preferences.firstRunDone).toBe(true);
  });

  it("shows the log and a retry after a failed create", async () => {
    const api = fakeApi();
    api.jobEnd.create = "failed";
    const { wrapper } = await mountHub(api);
    await wrapper.find("[data-testid=hub-new-project]").trigger("click");
    await flushPromises();
    const name = document.querySelector<HTMLInputElement>("[data-testid=wizard-name]");
    if (name === null) throw new Error("no name field");
    name.value = "demo";
    name.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>("[data-testid=wizard-make]")?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid=wizard-progress] [role=alert]")?.textContent).toContain(
        "The project was not made.",
      );
    });
    expect(document.querySelector("[data-testid=wizard-log]")?.textContent).toContain("create output");
    api.jobEnd.create = "done";
    const retry = [...document.querySelectorAll<HTMLButtonElement>("[data-testid=wizard-progress] button")].find(
      (button) => button.textContent.trim() === "Retry",
    );
    retry?.click();
    await vi.waitFor(() => {
      expect(api.calls).toContain("open /home/me/demo");
    });
    expect(api.jobs.map((job) => job.command)).toEqual(["create", "create", "git.init"]);
  });

  it("lists the templates of the person after the built-in ones and makes a project from one", async () => {
    const api = fakeApi([project("demo")]);
    api.templateList = [{ id: "user:lobby", source: "user", title: "Lobby", description: "My lobby.", picture: false }];
    const { wrapper } = await mountHub(api);
    await wrapper.find("[data-testid=hub-new-project]").trigger("click");
    await flushPromises();
    const tiles = [...document.querySelectorAll<HTMLButtonElement>("[data-template]")];
    expect(tiles.at(-1)?.dataset.template).toBe("user:lobby");
    expect(tiles.at(-1)?.textContent).toContain("My lobby.");
    tiles.at(-1)?.click();
    const name = document.querySelector<HTMLInputElement>("[data-testid=wizard-name]");
    if (name === null) throw new Error("no name field");
    name.value = "second";
    name.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>("[data-testid=wizard-make]")?.click();
    await vi.waitFor(() => {
      expect(api.calls).toContain("open /home/me/second");
    });
    expect(api.jobs[0]).toMatchObject({ command: "create", args: { name: "second", template: "user:lobby" } });
  });

  it("saves a project as a template with a title and a description", async () => {
    const api = fakeApi([project("demo")]);
    const hub = useHub(api);
    const saved: DataTemplate[] = [];
    const wrapper = mount(
      {
        render: () =>
          h(SaveTemplateDialog, { hub, project: project("demo"), onSaved: (made: DataTemplate) => saved.push(made) }),
      },
      { attachTo: document.body },
    );
    mounted.push(wrapper);
    await flushPromises();
    const title = document.querySelector<HTMLInputElement>("[data-testid=hub-template-title]");
    expect(title?.value).toBe("demo");
    if (title === null) throw new Error("no title field");
    title.value = "Lobby";
    title.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>("[data-testid=hub-template-go]")?.click();
    await vi.waitFor(() => {
      expect(saved.map((made) => made.title)).toEqual(["Lobby"]);
    });
    expect(api.calls).toContain("template demo Lobby");
  });

  it("clones a repository into the folder of the open dialog and shows the new folder", async () => {
    const api = fakeApi();
    const { wrapper } = await mountHub(api);
    await wrapper.find("[data-testid=hub-open]").trigger("click");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid=folder-path]")?.textContent).toBe("/home/me");
    });
    document.querySelector<HTMLButtonElement>("[data-testid=clone-toggle]")?.click();
    await flushPromises();
    const url = document.querySelector<HTMLInputElement>("[data-testid=clone-url]");
    if (url === null) throw new Error("no URL field");
    url.value = "https://example.com/team/courtyard.git";
    url.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>("[data-testid=clone-start]")?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid=folder-path]")?.textContent).toBe("/home/me/courtyard");
    });
    expect(api.jobs).toEqual([
      {
        command: "git.clone",
        args: { url: "https://example.com/team/courtyard.git", folder: "courtyard" },
        cwd: "/home/me",
      },
    ]);
  });

  it("shows the error of a failed action until a dismiss", async () => {
    const api = fakeApi([project("demo")]);
    api.openProject = () => Promise.reject(new Error("the folder is gone"));
    const { wrapper } = await mountHub(api);
    await wrapper.find("[data-project=demo] button").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=hub-notice]").text()).toContain("the folder is gone");
  });
});

describe("the browser keys", () => {
  function storage(entries: Record<string, string>): Storage {
    const keys = Object.keys(entries);
    return {
      length: keys.length,
      key: (index: number) => keys[index] ?? null,
      getItem: (key: string) => entries[key] ?? null,
    } as Storage;
  }

  it("moves the scenity keys that the host does not have yet", async () => {
    const local = storage({ "scenity.dock": "{}", "scenity.theme": "dark", other: "x" });
    expect(browserKeys(local, ["scenity.theme"])).toEqual({ "scenity.dock": "{}" });
    expect(await importBrowserKeys(fakeApi(), [], () => local)).toEqual(["scenity.dock", "scenity.theme"]);
    expect(
      await importBrowserKeys(fakeApi(), [], () => {
        throw new Error("closed");
      }),
    ).toEqual([]);
  });
});

describe("the client of the host API", () => {
  it("sends the CSRF value of the cookie and gives the error text of a refused request", async () => {
    document.cookie = "scenity_studio_csrf=abc123";
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const api = studioApi((url, init) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return Promise.resolve(new Response(JSON.stringify({ error: "outside the allowed folders" }), { status: 400 }));
    }, "http://127.0.0.1:5170");
    await expect(api.openProject("/etc")).rejects.toThrow(StudioError);
    await expect(api.openProject("/etc")).rejects.toThrow("outside the allowed folders");
    expect(seen[0]?.url).toBe("http://127.0.0.1:5170/api/projects/open");
    expect(seen[0]?.headers["x-studio-csrf"]).toBe("abc123");
  });
});

describe("the role of the session in the Hub", () => {
  it("says what an editor and a viewer do not do; the owner gets no line", async () => {
    const api = fakeApi([project("alpha")]);
    const { wrapper } = await mountHub(api);
    expect(wrapper.find("[data-testid=hub-role]").exists()).toBe(false);
    for (const role of ["editor", "viewer"] as const) {
      api.studio = { ...api.studio, role };
      const next = await mountHub(api);
      expect(next.wrapper.get("[data-testid=hub-role]").text()).toBe(t(`hub-role-${role}`));
    }
  });
});
