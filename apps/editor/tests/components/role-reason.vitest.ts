// SPDX-License-Identifier: Apache-2.0
// The reasons of the roles. The state of the host gives the role of the window and the remote mode. An editor gets the
// actions of the owner off, with the reason. The owner of a remote studio gets no shell. The Terminal panel shows its
// buttons off with the reason (not hidden).
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TerminalPanel from "../../src/scene/terminal/TerminalPanel.vue";
import type { TerminalClient } from "../../src/scene/terminal/terminalClient";
import { showViewer } from "../../src/scene/windowState";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { roleReason, studioAccess } from "../../src/studio/shell/viewerRole";
import { t } from "../../src/texts";

afterEach(() => {
  studioAccess.value = { role: "admin", remote: false };
});

/** A fetcher of a studio host with a role and a remote mode. */
function host(role: string, remote: boolean) {
  return (input: string): Promise<Response> =>
    Promise.resolve(
      input === "/health" ? Response.json({ studio: true }) : Response.json({ role, remote, open: [], projects: [] }),
    );
}

const client = { events: () => () => undefined } as unknown as TerminalClient;

describe("the reasons of the roles", () => {
  it("gives a reason for each action that a role does not do", () => {
    const owner = { role: "admin", remote: false } as const;
    expect(["owner", "shell", "auto", "files"].map((action) => roleReason(action as never, owner))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const remote = { role: "admin", remote: true } as const;
    expect(roleReason("shell", remote)).toBe(t("role-remote-shell"));
    expect(roleReason("files", remote)).toBe(t("role-remote-files"));
    expect(roleReason("auto", remote)).toBeNull();
    const editor = { role: "editor", remote: false } as const;
    expect(roleReason("owner", editor)).toBe(t("role-owner-only"));
    expect(roleReason("shell", editor)).toBe(t("role-owner-only"));
    expect(roleReason("auto", editor)).toBe(t("role-editor-auto"));
    expect(roleReason("auto", { role: "viewer", remote: false })).toBe(t("notice-viewer-locked"));
  });

  it("reads the role and the remote mode of the host; the Terminal panel shows its buttons off with the reason", async () => {
    const notices = new WindowNotices();
    expect(await showViewer(notices, () => undefined, host("editor", true))).toBe(false);
    expect(studioAccess.value).toEqual({ role: "editor", remote: true });
    const panel = mount(TerminalPanel, { props: { client, project: "showroom" } });
    for (const kind of ["claude", "shell"]) {
      const button = panel.get(`[data-testid=terminal-new-${kind}]`);
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.attributes("title")).toBe(t("role-owner-only"));
    }
    expect(panel.get("[data-testid=terminal-reason]").text()).toBe(t("role-owner-only"));
    studioAccess.value = { role: "admin", remote: true };
    await panel.vm.$nextTick();
    expect(panel.get("[data-testid=terminal-new-claude]").attributes("disabled")).toBeUndefined();
    expect(panel.get("[data-testid=terminal-new-shell]").attributes("title")).toBe(t("role-remote-shell"));
    expect(panel.find("[data-testid=terminal-reason]").exists()).toBe(false);
    panel.unmount();
  });
});
