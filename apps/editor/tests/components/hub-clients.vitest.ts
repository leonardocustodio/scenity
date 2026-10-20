// SPDX-License-Identifier: Apache-2.0
// The external agents in the Hub. A request with no project gets its project and Allow. An allowed client has Revoke.
// "Connect over HTTP" shows the setup line with the token of the new connection.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import ExternalClients from "../../src/hub/ExternalClients.vue";
import { useHub } from "../../src/hub/useHub";
import { editorI18n } from "../../src/texts";
import { fakeApi, project } from "./hubFakes";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const connection = (id: string, state: string, change: Record<string, unknown> = {}) => ({
  id,
  name: id === "c1" ? "Cursor" : "Codex",
  project: null,
  state,
  session: null,
  at: 1,
  ...change,
});

describe("the external agents in the Hub", () => {
  it("allows a request in a project, revokes a client and connects one over HTTP", async () => {
    const posts: [string, unknown][] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push([url, JSON.parse(init.body as string)]);
        if (url === "/api/agent/connections")
          return Promise.resolve(Response.json({ ...connection("c3", "allowed"), token: "t0k3n" }));
        return Promise.resolve(Response.json({}));
      }
      return Promise.resolve(
        Response.json({
          connections: [connection("c1", "pending"), connection("c2", "allowed", { project: "lobby" })],
        }),
      );
    });
    const hub = useHub(fakeApi([project("lobby"), project("plaza")]));
    await hub.load();
    const wrapper = mount(
      { render: () => h(ExternalClients, { hub }) },
      {
        attachTo: document.body,
        global: { plugins: [editorI18n().plugin] },
      },
    );
    await flushPromises();
    const rows = wrapper.findAll("[data-testid=agents-client]");
    expect(rows.map((row) => row.attributes("data-state"))).toEqual(["pending", "allowed"]);
    await rows[0]?.find("[data-testid=agents-client-project]").setValue("plaza");
    await rows[0]?.find("[data-testid=agents-client-allow]").trigger("click");
    await rows[1]?.find("[data-testid=agents-client-revoke]").trigger("click");
    await wrapper.find("[data-testid=agents-http-name]").setValue("Zed");
    await wrapper.find("[data-testid=agents-http]").trigger("submit");
    await flushPromises();
    expect(posts).toEqual([
      ["/api/agent/connections/c1/allow", { project: "plaza" }],
      ["/api/agent/connections/c2/revoke", {}],
      ["/api/agent/connections", { name: "Zed", project: "lobby" }],
    ]);
    expect(wrapper.find("[data-testid=agents-http-setup]").text()).toBe(
      'claude mcp add --transport http scenity http://127.0.0.1:5170/mcp --header "Authorization: Bearer t0k3n"',
    );
    wrapper.unmount();
  });
});
