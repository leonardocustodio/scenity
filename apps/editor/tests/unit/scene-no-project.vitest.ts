// SPDX-License-Identifier: Apache-2.0
// The scene page with no project. On the studio host, it opens the Hub. On a plain dev server, it names the commands.
// It never picks a project by itself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { servedByStudio, showNoProject } from "../../src/scene/projects/noProject";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the scene page with no project", () => {
  it("knows the studio host by its health answer", async () => {
    expect(await servedByStudio(() => Promise.resolve(Response.json({ ok: true, studio: true })))).toBe(true);
    expect(await servedByStudio(() => Promise.resolve(new Response("no", { status: 404 })))).toBe(false);
    expect(await servedByStudio(() => Promise.reject(new Error("offline")))).toBe(false);
  });

  it("goes to the Hub on the studio host", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ studio: true })));
    const go = vi.fn();
    const status = document.createElement("p");
    await showNoProject(status, go);
    expect(go).toHaveBeenCalledWith("/");
    expect(status.textContent).toBe("");
  });

  it("names the commands on a plain dev server", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    const go = vi.fn();
    const status = document.createElement("p");
    await showNoProject(status, go);
    expect(go).not.toHaveBeenCalled();
    expect(status.dataset.state).toBe("no-project");
    expect(status.textContent).toContain("scenity studio");
  });
});
