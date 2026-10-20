// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the dock tabs with a fake host: the Runs tab (live output, images, cancel, the gates, the promote
 * confirmation), the Changes tab (turns, diff, undo, keep, commit, tune to code) and the Review tab (the pack, its
 * Markdown and its images).
 */
import type { RunInfo } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { defineComponent, h } from "vue";
import Changes from "../../src/dock/Changes.vue";
import Review from "../../src/dock/Review.vue";
import Runs from "../../src/dock/Runs.vue";
import type { DockHost } from "../../src/dock/dockHost";
import { useRunFiles } from "../../src/dock/runFile";
import { useChanges } from "../../src/dock/useChanges";
import { useRuns } from "../../src/dock/useRuns";
import { fakeDock, runInfo, type DockAnswers } from "./fakeDock";

beforeAll(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:test-${String(next++)}`);
  URL.revokeObjectURL = vi.fn();
});

/** Mount a tab with the composables in a parent setup, as DockPanels does. */
function mountTab(tab: "runs" | "changes" | "review", dock: DockHost) {
  const Parent = defineComponent({
    setup() {
      const runs = useRuns(dock);
      const files = useRunFiles(dock);
      const changes = tab === "changes" || tab === "review" ? useChanges(dock) : null;
      return () =>
        tab === "runs"
          ? h(Runs, { runs, files })
          : tab === "changes"
            ? h(Changes, { runs, changes: changes!, request: dock.request })
            : h(Review, {
                runs,
                files,
                start: changes?.start.value ?? null,
                defaultSequence: dock.defaultSequence?.() ?? null,
              });
    },
  });
  return mount(Parent, { attachTo: document.body });
}

const turnsAnswer = {
  start: "abc1234567890",
  turns: [
    {
      session: "s1",
      turn: 1,
      prompt: "the hat lifts off the head",
      started: "2026-10-12T15:00:00.000Z",
      head: "abc",
      files: ["src/families/hand_wave.ts"],
      state: "open" as const,
    },
  ],
  files: ["src/families/hand_wave.ts"],
  proposal: "The hat lifts off the head",
};

function changeAnswers(extra: DockAnswers = {}): DockAnswers {
  return {
    "runs.list": () => [],
    "git.status": () => ({
      branch: "main",
      head: "abc",
      files: [
        { path: "src/families/hand_wave.ts", status: " M" },
        { path: "docs/notes.md", status: "??" },
      ],
    }),
    "git.turns": () => turnsAnswer,
    "git.diff": () => ({
      patch: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n context\n",
    }),
    ...extra,
  };
}

describe("the Runs tab", () => {
  test("it shows the live output, the images, and cancels a running run", async () => {
    let list: RunInfo[] = [runInfo({ status: "running", code: null, run: "r1" })];
    const { dock, calls, emit } = fakeDock(
      { "runs.list": () => list, "runs.cancel": () => null },
      { "r1:/out/sheet.png": "png" },
    );
    const wrapper = mountTab("runs", dock);
    await flushPromises();
    emit("runs.output", { run: "r1", stream: "stdout", data: "\u001b[31mFAIL\u001b[0m hands.toTarget\n" });
    await flushPromises();
    expect(wrapper.get("[data-testid=run-output]").text()).toBe("FAIL hands.toTarget");
    await wrapper.get("[data-testid=run-cancel]").trigger("click");
    expect(calls.at(-1)).toEqual({ type: "runs.cancel", params: { run: "r1" } });
    list = [runInfo({ run: "r1", status: "failed", code: 1, outDir: "/out", images: ["/out/sheet.png"] })];
    emit("runs.done", { run: "r1", code: 1, summary: "", outDir: "/out", images: ["/out/sheet.png"] });
    await flushPromises();
    await flushPromises();
    expect(wrapper.find("[data-testid=run-cancel]").exists()).toBe(false);
    const thumb = wrapper.get("[data-testid=run-images] button");
    expect(thumb.find("img").attributes("src")).toMatch(/^blob:test-/);
    await thumb.trigger("click");
    expect(wrapper.find("[data-testid=run-image-large]").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find("[data-testid=run-image-large]").exists()).toBe(false);
    wrapper.unmount();
  });

  test("the gates start their runs; promote waits for the confirmation", async () => {
    const { dock, calls } = fakeDock({ "runs.list": () => [], "runs.start": () => ({ run: "r9" }) });
    const wrapper = mountTab("runs", dock);
    await flushPromises();
    const byText = (text: string) => wrapper.findAll("button").find((item) => item.text() === text)!;
    await byText("Verify visual").trigger("click");
    await byText("Perf (quick, dry)").trigger("click");
    await byText("Promote (dry)").trigger("click");
    await wrapper.get("[data-testid=promote]").trigger("click");
    const starts = () => calls.filter((call) => call.type === "runs.start").map((call) => call.params);
    expect(starts()).toEqual([
      { command: "verify", args: ["--visual"] },
      { command: "perf", args: ["--quick", "--dry"] },
      { command: "promote", args: ["--dry"] },
    ]);
    await wrapper.get("[data-testid=promote-confirm] button").trigger("click");
    await flushPromises();
    expect(starts().at(-1)).toEqual({ command: "promote", args: [], confirm: true });
    expect(wrapper.find("[data-testid=promote-confirm]").exists()).toBe(false);
    wrapper.unmount();
  });

  test("an error of the host shows", async () => {
    const { dock } = fakeDock({
      "runs.list": () => [],
      "runs.start": () => {
        throw new Error("A WebGL run is running in this checkout: motion");
      },
    });
    const wrapper = mountTab("runs", dock);
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[role=alert]").text()).toContain("A WebGL run is running");
    wrapper.unmount();
  });
});

describe("the Changes tab", () => {
  test("it lists the turns and the files, shows a diff, undoes a turn and commits the selection", async () => {
    const { dock, calls } = fakeDock(
      changeAnswers({
        "git.undoTurn": () => ({ restored: ["a.ts"], deleted: [], skipped: [] }),
        "git.commit": () => ({ commit: "0123456789abcdef" }),
      }),
    );
    const wrapper = mountTab("changes", dock);
    await flushPromises();
    expect(wrapper.get("[data-testid=turn-1]").text()).toContain("Turn 1: the hat lifts off the head");
    expect((wrapper.get("[data-testid=commit-message]").element as HTMLInputElement).value).toBe(
      "The hat lifts off the head",
    );
    // The file of the session is selected for the commit. The other file is not.
    const boxes = wrapper.findAll("input[type=checkbox]");
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([true, false]);
    await wrapper
      .findAll("button")
      .find((item) => item.text() === "docs/notes.md")!
      .trigger("click");
    await flushPromises();
    expect(calls.find((call) => call.type === "git.diff")?.params).toEqual({ paths: ["docs/notes.md"] });
    expect(wrapper.find("[data-kind=add]").text()).toBe("+new");
    expect(wrapper.find("[data-kind=del]").text()).toBe("-old");
    await wrapper
      .findAll("button")
      .find((item) => item.text() === "Undo the turn")!
      .trigger("click");
    await flushPromises();
    expect(calls.find((call) => call.type === "git.undoTurn")?.params).toEqual({ session: "s1", turn: 1 });
    expect(wrapper.get("[role=status]").text()).toContain("Turn 1 undone: restored 1, deleted 0");
    await wrapper.get("[data-testid=commit-message]").setValue("Keep the hat on the head");
    await wrapper.get("form[aria-label=Commit]").trigger("submit");
    await flushPromises();
    expect(calls.find((call) => call.type === "git.commit")?.params).toEqual({
      message: "Keep the hat on the head",
      paths: ["src/families/hand_wave.ts"],
    });
    expect(wrapper.text()).toContain("Committed 0123456789.");
    wrapper.unmount();
  });

  test("tune to code runs the dry run first, then the apply", async () => {
    let list: RunInfo[] = [];
    const { dock, calls, emit } = fakeDock(
      changeAnswers({
        "runs.list": () => list,
        "tunes.apply": (params) => ({ run: (params as { dry: boolean }).dry ? "t1" : "t2", values: "wave.y:-0.004" }),
      }),
    );
    const wrapper = mountTab("changes", dock);
    await flushPromises();
    await wrapper.get("[data-testid=tune-dry]").trigger("click");
    await flushPromises();
    expect(calls.find((call) => call.type === "tunes.apply")?.params).toEqual({ dry: true });
    expect(wrapper.find("[data-testid=tune-apply]").exists()).toBe(false);
    list = [runInfo({ run: "t1", command: "tune-apply", args: ["wave.y:-0.004", "--dry"] })];
    emit("runs.output", { run: "t1", stream: "stdout", data: "dry run: 1 values written\n" });
    emit("runs.done", { run: "t1", code: 0, summary: "", outDir: null, images: [] });
    await flushPromises();
    await flushPromises();
    expect(wrapper.get("[data-testid=tune-output]").text()).toContain("dry run: 1 values written");
    await wrapper.get("[data-testid=tune-apply]").trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.type === "tunes.apply").at(-1)?.params).toEqual({ dry: false });
    wrapper.unmount();
  });

  test("a save of a scene file loads the tab again and shows the JSON diff of the file", async () => {
    const path = "samples/showroom/scenes/main.scene.json";
    const patch = `diff --git a/${path} b/${path}\n@@ -9 +9 @@\n-  "position": [1.6, 0, -0.9]\n+  "position": [1.9, 0, -0.9]\n`;
    const { dock, calls, emit } = fakeDock(changeAnswers({ "git.diff": () => ({ patch }) }));
    const wrapper = mountTab("changes", dock);
    await flushPromises();
    const loads = calls.filter((call) => call.type === "git.status").length;
    emit("scene.saved", { path, hash: "a".repeat(64) });
    await flushPromises();
    expect(calls.filter((call) => call.type === "git.status").length).toBe(loads + 1);
    expect(calls.find((call) => call.type === "git.diff")?.params).toEqual({ paths: [path] });
    expect(wrapper.find("[data-kind=add]").text()).toBe('+  "position": [1.9, 0, -0.9]');
    wrapper.unmount();
  });
});

describe("the Review tab", () => {
  test("it starts a pack and shows REVIEW.md with its images and the folder", async () => {
    const outDir = "/repo/out/review-r5";
    let list: RunInfo[] = [];
    const markdown =
      "# Review of greet\n\n| check | value |\n| --- | --- |\n| hat | **0.12** |\n\n![sheet](sheet.png)\n";
    const { dock, calls, emit } = fakeDock(
      changeAnswers({ "runs.list": () => list, "runs.start": () => ({ run: "r5" }) }),
      { "r5:REVIEW.md": markdown, [`r5:${outDir}/sheet.png`]: "png" },
    );
    const wrapper = mountTab("review", dock);
    await flushPromises();
    expect(wrapper.text()).toContain("against abc1234567 (the session start)");
    await wrapper.get("form").trigger("submit");
    expect(calls.find((call) => call.type === "runs.start")?.params).toEqual({ command: "review", args: ["greet"] });
    list = [runInfo({ run: "r5", command: "review", args: ["greet", "--ref", "abc"], outDir })];
    emit("runs.done", { run: "r5", code: 0, summary: "", outDir, images: [] });
    await flushPromises();
    await flushPromises();
    await flushPromises();
    const view = wrapper.get("[data-testid=markdown]");
    expect(view.get("h1").text()).toBe("Review of greet");
    expect(view.get("td strong").text()).toBe("0.12");
    expect(view.get("img").attributes("src")).toMatch(/^blob:test-/);
    expect(wrapper.get("[data-testid=review-folder]").text()).toBe(outDir);
    wrapper.unmount();
  });
});
