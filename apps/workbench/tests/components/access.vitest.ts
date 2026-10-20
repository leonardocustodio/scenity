// SPDX-License-Identifier: Apache-2.0
/**
 * The page reacts to `host.hello`. A project folder with no Git has no Changes tab. A viewer token has no Claude
 * column and no "Restart host". The theme of the project manifest applies.
 */
import type { HelloAccess, ProjectInfo, Role } from "@scenity/workbench-host/protocol";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { accessOf } from "../../src/host/useHost";
import Workbench from "../../src/Workbench.vue";
import { fakeHost } from "./fakeHost";

const PROJECT: ProjectInfo = {
  id: "showroom",
  name: "Showroom",
  dir: "/work/showroom",
  manifest: "/work/showroom/scenity.project.json",
  surfaces: [
    {
      id: "editor",
      kind: "scene",
      label: "Editor",
      capabilities: ["scene", "index"],
      page: null,
      hidden: false,
      order: 1,
    },
  ],
  runs: { check: "scenity check" },
  setup: null,
  gate: null,
  contentRoots: ["assets", "scenes"],
  denylist: [],
  credentialFile: ".env",
  theme: "dark",
};

function access(patch: { git?: boolean; role?: Role } = {}): HelloAccess {
  return { project: PROJECT, git: patch.git ?? true, role: patch.role ?? "admin", auth: "token", remote: true };
}

afterEach(() => {
  globalThis.localStorage.clear();
  document.documentElement.dataset.theme = "navy";
});

describe("the page and the access of the host", () => {
  test("a folder with no Git has no Changes tab", () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost({ access: access({ git: false }) }).host } });
    expect(wrapper.find("[data-testid=dock-tab-changes]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=dock-tab-runs]").exists()).toBe(true);
  });

  test("a Git folder keeps the Changes tab; the admin has no role mark and keeps Restart host", () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost({ access: access() }).host } });
    expect(wrapper.find("[data-testid=dock-tab-changes]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=top-role]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=restart-host]").exists()).toBe(true);
  });

  test("a viewer has no Claude column, no Claude toggle and no Restart host", () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost({ access: access({ role: "viewer" }) }).host } });
    expect(wrapper.get("[data-testid=top-role]").text()).toBe("viewer");
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=toggle-claude]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=restart-host]").exists()).toBe(false);
  });

  test("an editor keeps the Claude column but not Restart host", () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost({ access: access({ role: "editor" }) }).host } });
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=restart-host]").exists()).toBe(false);
  });

  test("the theme of the project manifest applies", () => {
    mount(Workbench, { props: { host: fakeHost({ access: access() }).host } });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("accessOf reads host.hello; an older host without a project gives null", () => {
    const base = { protocol: 3, checkout: null, surfaces: [] };
    expect(accessOf(base)).toBeNull();
    expect(accessOf({ ...base, project: PROJECT, role: "viewer" })).toEqual({
      project: PROJECT,
      git: true,
      role: "viewer",
      auth: "none",
      remote: false,
    });
  });
});
