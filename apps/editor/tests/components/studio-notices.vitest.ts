// SPDX-License-Identifier: Apache-2.0
// The dialogs, the toasts and the banners of the editor window. A notice of the file bar is a dialog (no notice bar).
// The tests also cover the safe action and Escape, the prompt field, a toast for a save and the play banner. They also
// cover the restricted banner, the trust of the project and the guard of unsaved changes.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";
import DialogHost from "../../src/studio/shell/DialogHost.vue";
import BannerRow from "../../src/studio/shell/BannerRow.vue";
import { setCurrentShell, type StudioShell } from "../../src/studio/shell/shell";
import { sceneBar } from "../../src/scene/sceneBar";
import { guardUnsaved, showPlayBanner, showRestricted } from "../../src/scene/windowState";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  setCurrentShell(null);
  document.body.innerHTML = "";
  delete document.body.dataset.play;
});

function host(): WindowNotices {
  const notices = new WindowNotices();
  mounted.push(mount(DialogHost, { props: { notices }, attachTo: document.body }));
  mounted.push(mount(BannerRow, { props: { notices }, attachTo: document.body }));
  setCurrentShell({ notices, status: new WindowStatus() } as unknown as StudioShell);
  return notices;
}

const find = <T extends Element = HTMLElement>(testId: string): T | null =>
  document.querySelector<T>(`[data-testid="${testId}"]`);

describe("the notices of the file bar are dialogs", () => {
  it("shows the draft offer as a dialog that needs a choice, and runs the action", async () => {
    const notices = host();
    const bar = sceneBar("scenes/main.scene.json", () => undefined);
    const restore = vi.fn();
    bar.notice({
      kind: "draft",
      text: "A local draft has changes.",
      first: { label: "Restore", testId: "draft-restore", run: restore },
      second: { label: "Discard", testId: "draft-discard", run: () => bar.notice(null) },
    });
    await flushPromises();
    expect(find("scene-notice")?.dataset.kind).toBe("draft");
    expect(find("scene-notice")?.dataset.spec).toBe("confirm.discardDraft");
    expect(find("scene-notice-text")?.textContent).toBe("A local draft has changes.");
    expect(bar.noticeKind).toBe("draft");
    expect(notices.dialog?.dismiss).toBeNull();
    find<HTMLButtonElement>("draft-restore")?.click();
    await flushPromises();
    expect(restore).toHaveBeenCalledOnce();
    expect(find("scene-notice")).toBeNull();
    expect(bar.noticeKind).toBeNull();
    expect(document.querySelector("#scene-notice")).toBeNull();
  });

  it("asks a reason with a field: the first action waits for a text, Escape cancels", async () => {
    host();
    const bar = sceneBar("scenes/main.scene.json", () => undefined);
    const save = vi.fn();
    const cancel = vi.fn();
    bar.notice({
      kind: "rules",
      text: "Not saved. The lamp is too low.",
      input: { placeholder: "Reason", testId: "rules-reason" },
      first: { label: "Save with the reason", testId: "rules-save", run: save },
      second: { label: "Cancel", testId: "rules-cancel", run: cancel },
    });
    await flushPromises();
    expect(find<HTMLButtonElement>("rules-save")?.disabled).toBe(true);
    const field = find<HTMLInputElement>("rules-reason");
    if (field === null) throw new Error("no field");
    field.value = "The owner said so";
    field.dispatchEvent(new Event("input"));
    await nextTick();
    expect(find<HTMLButtonElement>("rules-save")?.disabled).toBe(false);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(save).toHaveBeenCalledWith("The owner said so");
    bar.notice({
      kind: "rules",
      text: "Not saved.",
      input: { placeholder: "Reason", testId: "rules-reason" },
      first: { label: "Save", testId: "rules-save", run: save },
      second: { label: "Cancel", testId: "rules-cancel", run: cancel },
    });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    find("scene-notice")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("closes the dialog when the page hides the notice (a restore of the script API)", async () => {
    const notices = host();
    const bar = sceneBar("scenes/main.scene.json", () => undefined);
    bar.notice({
      kind: "conflict",
      text: "The file changed.",
      first: { label: "Reload", testId: "conflict-reload", run: () => undefined },
      second: { label: "Overwrite", testId: "conflict-overwrite", run: () => undefined },
    });
    await flushPromises();
    expect(notices.dialog?.spec).toBe("confirm.fileChanged");
    bar.notice(null);
    await flushPromises();
    expect(notices.dialog).toBeNull();
    expect(find("scene-notice")).toBeNull();
  });

  it("gives a toast for a save that ends well", async () => {
    const notices = host();
    const bar = sceneBar("scenes/main.scene.json", () => undefined);
    bar.state("saving", true);
    bar.state("saved", false);
    await flushPromises();
    expect(notices.state.toasts.map((toast) => toast.title)).toEqual(["Saved scenes/main.scene.json"]);
    expect(find("studio-toast")?.textContent).toContain("Saved scenes/main.scene.json");
  });
});

describe("the banners and the guard of the window", () => {
  it("shows the play banner while the page plays", async () => {
    const notices = host();
    showPlayBanner(notices);
    document.body.dataset.play = "1";
    await flushPromises();
    expect(notices.state.banners.map((banner) => banner.id)).toEqual(["play"]);
    delete document.body.dataset.play;
    await flushPromises();
    expect(notices.state.banners).toEqual([]);
  });

  it("shows the restricted banner in the studio and trusts the project after the confirm", async () => {
    const notices = host();
    const calls: string[] = [];
    const fetcher = (input: string, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      const body =
        input === "/health"
          ? { studio: true }
          : input === "/api/state"
            ? { open: [{ key: "spin", dir: "/w/spin", restricted: true }] }
            : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
    const reload = vi.fn();
    expect(await showRestricted(notices, "spin", fetcher, reload)).toBe(true);
    await flushPromises();
    expect(document.querySelector('[data-banner="restricted"]')).not.toBeNull();
    find<HTMLButtonElement>("trust-project")?.click();
    await flushPromises();
    expect(notices.dialog?.spec).toBe("confirm.trust");
    expect(notices.dialog?.safe).toBe("no");
    find<HTMLButtonElement>("trust-yes")?.click();
    await flushPromises();
    expect(calls).toContain("POST /api/projects/trust");
    expect(reload).toHaveBeenCalledOnce();
    expect(await showRestricted(notices, "other", fetcher, reload)).toBe(false);
  });

  it("asks before a close of the window with unsaved changes", () => {
    let dirty = false;
    const target = new EventTarget() as Window;
    guardUnsaved(() => dirty, target);
    const clean = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    dirty = true;
    const unsaved = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
  });
});
