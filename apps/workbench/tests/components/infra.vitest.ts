// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the infrastructure parts of the page, with a fake host: the background runs of the Sessions tab (start,
 * live lines, stop, the pack), the experiment log, the checkout settings (Blender), the Picker tab (the sheets, the
 * keys 1 to 9 and S), the asset run behind a confirmation, and "New window".
 */
import type { LoopInfo, PickCandidate } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, describe, expect, test, vi } from "vitest";
import AssetRun from "../../src/dock/AssetRun.vue";
import BackgroundRuns from "../../src/dock/BackgroundRuns.vue";
import CheckoutOptions from "../../src/dock/CheckoutOptions.vue";
import ExperimentLog from "../../src/dock/ExperimentLog.vue";
import Picker from "../../src/dock/Picker.vue";
import SessionsTabs from "../../src/dock/SessionsTabs.vue";
import { useRunFiles } from "../../src/dock/runFile";
import { openNewWindow, pageUrlFor } from "../../src/start/newWindow";
import { fakeDock } from "./fakeDock";
import { fakePictures, pictureIdOf } from "./fakePictures";

beforeAll(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:test-${String(next++)}`);
  URL.revokeObjectURL = vi.fn();
});

function loopInfo(patch: Partial<LoopInfo> = {}): LoopInfo {
  return {
    loop: "bg-1",
    checkout: "/repo",
    prompt: "fix the hat",
    take: "greet",
    intent: null,
    budgetUsd: 2,
    maxTurns: 60,
    minutes: 30,
    model: null,
    status: "running",
    started: "2026-10-12T15:00:00.000Z",
    ended: null,
    startHead: "abc",
    endHead: null,
    session: null,
    turns: null,
    costUsd: null,
    stopReason: null,
    result: null,
    files: [],
    gate: { refusals: 0, last: null },
    endCheck: null,
    review: null,
    record: null,
    ...patch,
  };
}

describe("the background runs", () => {
  test("start, watch the live lines, stop, and open the pack at the end", async () => {
    const { dock, calls, emit } = fakeDock(
      {
        "loops.list": () => [],
        "loops.start": () => loopInfo(),
        "loops.stop": () => null,
      },
      { "rv:REVIEW.md": "# Review of greet\n\nThe hat stays on the head." },
    );
    const wrapper = mount(BackgroundRuns, { props: { dock }, attachTo: document.body });
    await flushPromises();
    await wrapper.get("[data-testid=loop-prompt]").setValue("fix the hat");
    await wrapper.get("[data-testid=loop-budget]").setValue("0.5");
    await wrapper.get("[data-testid=loop-start]").trigger("submit");
    await flushPromises();
    expect(calls.find((call) => call.type === "loops.start")?.params).toEqual({
      prompt: "fix the hat",
      sequence: "greet",
      intent: null,
      budgetUsd: 0.5,
      maxTurns: 60,
      minutes: 30,
      model: null,
      worktree: false,
    });
    emit("loops.progress", { loop: "bg-1", line: "tool Edit: families/wave.ts" });
    await flushPromises();
    expect(wrapper.get("[data-testid=loop-lines]").text()).toContain("tool Edit: families/wave.ts");
    await wrapper.get("[data-testid=loop-stop]").trigger("click");
    expect(calls.some((call) => call.type === "loops.stop")).toBe(true);

    const end = loopInfo({
      status: "done",
      ended: "2026-10-12T15:30:00.000Z",
      endHead: "abc",
      costUsd: 0.4321,
      turns: 22,
      files: ["src/families/wave.ts"],
      review: { run: "rv", status: "passed", outDir: "/repo/out" },
    });
    emit("loops.state", { loop: end });
    await flushPromises();
    expect(wrapper.get("[data-testid=loop-cost]").text()).toBe("about $0.4321 of $2 · 22 turns");
    expect(wrapper.get("[data-testid=loop-head]").text()).toContain("no commit");
    expect(wrapper.find("[data-testid=loop-stop]").exists()).toBe(false);
    await wrapper.get("[data-testid=loop-open-pack]").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid=loop-pack]").text()).toContain("The hat stays on the head.");
    wrapper.unmount();
  });

  test("a run that ended at its turn limit shows the gate check of the host with the failures", async () => {
    const ended = loopInfo({
      status: "failed",
      ended: "2026-10-12T15:30:00.000Z",
      stopReason: "error_max_turns",
      endCheck: {
        end: "ended at the turn limit",
        pass: false,
        summary: "FAIL ik.reachError (ada) 0.084 m at 9000 ms\nFAIL hands.toTarget 0.079 m",
        at: "2026-10-12T15:31:00.000Z",
      },
    });
    const { dock } = fakeDock({ "loops.list": () => [ended] });
    const wrapper = mount(BackgroundRuns, { props: { dock } });
    await flushPromises();
    await wrapper.get("[data-testid=loop-bg-1]").trigger("click");
    expect(wrapper.get("[data-testid=loop-end-check-line]").text()).toBe(
      "ended at the turn limit; gate: fail: FAIL ik.reachError (ada) 0.084 m at 9000 ms",
    );
    expect(wrapper.get("[data-testid=loop-end-check-failures]").text()).toContain("hands.toTarget");
    const passed = loopInfo({ ...ended, endCheck: { ...ended.endCheck!, pass: true, summary: "9 pass" } });
    const second = fakeDock({ "loops.list": () => [passed] });
    const other = mount(BackgroundRuns, { props: { dock: second.dock } });
    await flushPromises();
    await other.get("[data-testid=loop-bg-1]").trigger("click");
    expect(other.get("[data-testid=loop-end-check-line]").text()).toBe("ended at the turn limit; gate: pass");
    expect(other.find("[data-testid=loop-end-check-failures]").exists()).toBe(false);
  });

  test("the Sessions tab switches between its parts", async () => {
    const { dock } = fakeDock({
      "agent.sessions": () => ({ sessions: [] }),
      "loops.list": () => [loopInfo({ prompt: "an earlier run" })],
      "experiments.search": () => [],
      "checkout.settings": () => ({ blender: false, blenderFound: false, intent: null }),
    });
    const wrapper = mount(SessionsTabs, { props: { dock } });
    await flushPromises();
    expect(wrapper.find("[data-testid=dock-sessions-tab]").exists()).toBe(true);
    await wrapper.get("[data-testid=sessions-part-background]").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid=background-runs]").text()).toContain("an earlier run");
    await wrapper.get("[data-testid=sessions-part-log]").trigger("click");
    expect(wrapper.find("[data-testid=experiment-log]").exists()).toBe(true);
    await wrapper.get("[data-testid=sessions-part-settings]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=options-no-blender]").exists()).toBe(true);
  });
});

describe("the experiment log and the settings", () => {
  test("a search by take sends only the filled fields and lists the runs", async () => {
    const { dock, calls } = fakeDock({
      "experiments.search": () => [
        {
          id: "r1",
          kind: "run",
          checkout: "/repo",
          intent: null,
          at: "2026-10-05T10:00:00.000Z",
          ended: null,
          command: "labs motion",
          args: ["greet"],
          take: "greet",
          status: "passed",
          code: 0,
          summary: "take greet: 9 pass",
          outDir: null,
        },
      ],
    });
    const wrapper = mount(ExperimentLog, { props: { dock } });
    await flushPromises();
    await wrapper.get("[data-testid=log-take]").setValue("greet");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(calls.at(-1)?.params).toEqual({ take: "greet", limit: 100 });
    expect(wrapper.findAll("[data-testid=log-entry]")).toHaveLength(1);
    expect(wrapper.text()).toContain("take greet: 9 pass");
  });

  test("the Blender option turns on when the owner has a server", async () => {
    let blender = false;
    const { dock, calls } = fakeDock({
      "checkout.settings": (params) => {
        const patch = params as { blender?: boolean };
        if (patch.blender !== undefined) blender = patch.blender;
        return { blender, blenderFound: true, intent: null };
      },
    });
    const wrapper = mount(CheckoutOptions, { props: { dock } });
    await flushPromises();
    const box = wrapper.get("[data-testid=options-blender]");
    expect((box.element as HTMLInputElement).disabled).toBe(false);
    await box.setValue(true);
    await flushPromises();
    expect(calls.at(-1)?.params).toEqual({ blender: true });
    expect((wrapper.get("[data-testid=options-blender]").element as HTMLInputElement).checked).toBe(true);
  });

  test("the built lab option sends the setting of the visible lab frame", async () => {
    let builtLab = false;
    const { dock, calls } = fakeDock({
      "checkout.settings": (params) => {
        const patch = params as { builtLab?: boolean };
        if (patch.builtLab !== undefined) builtLab = patch.builtLab;
        return { blender: false, blenderFound: false, intent: null, builtLab };
      },
    });
    const wrapper = mount(CheckoutOptions, { props: { dock } });
    await flushPromises();
    await wrapper.get("[data-testid=options-built-lab]").setValue(true);
    await flushPromises();
    expect(calls.at(-1)?.params).toEqual({ builtLab: true });
    expect((wrapper.get("[data-testid=options-built-lab]").element as HTMLInputElement).checked).toBe(true);
  });
});

describe("the picker", () => {
  const known: PickCandidate[] = [
    { id: "defaults", label: "Defaults", kind: "tune", tune: "" },
    { id: "lab", label: "The lab now", kind: "tune", tune: "wave.hand.y:0.02" },
    { id: "bg-1", label: "lower hand", kind: "worktree", path: "/wt" },
  ];

  test("the sheets fill the tiles; key 2 picks; S skips", async () => {
    const { dock, calls, emit } = fakeDock(
      {
        "picker.candidates": () => known,
        "picker.sheets": () => ({ job: "j1" }),
        "picker.pick": (params) => ({
          file: "/repo/apps/editor/intents/wave-left/labels.jsonl",
          labels: (params as { winner: string | null }).winner === null ? 0 : 3,
        }),
      },
      { "s1:/wt/out/sheet.png": "png" },
    );
    const files = useRunFiles(dock);
    const wrapper = mount(Picker, { props: { dock, files }, attachTo: document.body });
    await flushPromises();
    for (const id of ["defaults", "lab", "bg-1"]) await wrapper.get(`[data-testid=picker-choose-${id}]`).setValue(true);
    await wrapper.get("[data-testid=picker-tune]").setValue("wave.hand.y:0.04");
    await wrapper.get("[data-testid=picker-add]").trigger("click");
    await wrapper.get("[data-testid=picker-intent]").setValue("wave-left");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const sent = calls.find((call) => call.type === "picker.sheets")?.params as {
      window: unknown;
      candidates: PickCandidate[];
    };
    expect(sent.window).toEqual({ take: "greet", from: 6000, to: 8000, step: 500, cameras: ["overview"] });
    expect(sent.candidates.map((item) => item.id)).toEqual(["defaults", "lab", "bg-1", "own-1"]);
    expect(wrapper.findAll("[data-testid=picker-tile]")).toHaveLength(4);

    // A tune sheet is an ID of the picture store. The page shows it as an object URL.
    const pictures = fakePictures();
    const [first, old] = [pictureIdOf("a"), pictureIdOf("b")];
    const base = { job: "j1", mime: "image/webp", run: null, image: null, error: null };
    emit("picker.sheet", { sheet: { ...base, candidate: "defaults", picture: first } });
    emit("picker.sheet", {
      sheet: { ...base, candidate: "bg-1", picture: null, run: "s1", image: "/wt/out/sheet.png" },
    });
    emit("picker.sheet", { sheet: { ...base, candidate: "lab", picture: null, error: "no frame" } });
    emit("picker.sheet", { sheet: { ...base, job: "old", candidate: "own-1", picture: old } });
    await flushPromises();
    const images = wrapper.findAll("img").map((img) => img.attributes("src"));
    expect(images).toEqual([`blob:picture-${first}`, "blob:test-0"]);
    expect(wrapper.html()).not.toContain("data:image");
    pictures.stop();
    expect(wrapper.text()).toContain("no frame");

    await wrapper.get("[data-testid=picker-why]").setValue("less bounce");
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    await flushPromises();
    expect(calls.at(-1)).toMatchObject({
      type: "picker.pick",
      params: { intent: "wave-left", winner: "lab", why: "less bounce" },
    });
    expect(wrapper.get("[data-testid=picker-notice]").text()).toContain("3 labels for lab");
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    await flushPromises();
    expect(calls.at(-1)).toMatchObject({ type: "picker.pick", params: { winner: null } });
    wrapper.unmount();
  });
});

describe("the asset run and the new window", () => {
  test("the dry plan runs at once; the real asset run needs the confirmation", async () => {
    const start = vi.fn(() => Promise.resolve("r1"));
    const wrapper = mount(AssetRun, { props: { runs: { start } } });
    await wrapper.get("[data-testid=asset-id]").setValue("prop_lamp");
    await wrapper.get("form").trigger("submit");
    expect(start).toHaveBeenLastCalledWith("asset", ["prop_lamp", "--dry"]);
    await wrapper.get("[data-testid=asset-real]").trigger("click");
    expect(start).toHaveBeenCalledTimes(1);
    await wrapper.get("[data-testid=asset-confirm-run]").trigger("click");
    expect(start).toHaveBeenLastCalledWith("asset", ["prop_lamp"], true);
  });

  test("the app calls open_window; a browser opens a tab on the second host", async () => {
    const invoke = vi.fn(() => Promise.resolve(null));
    const request = vi.fn();
    const app = { location: { href: "tauri://localhost/" }, open: vi.fn(), __TAURI_INTERNALS__: { invoke } };
    expect(await openNewWindow("/repo-b", request as never, app)).toBe("tauri");
    expect(invoke).toHaveBeenCalledWith("open_window", { checkout: "/repo-b" });
    expect(request).not.toHaveBeenCalled();

    const token = "d".repeat(64);
    const ask = vi.fn(() => Promise.resolve({ origin: "http://127.0.0.1:4200", token, checkout: "/repo-b" }));
    const open = vi.fn();
    const browser = { location: { href: "http://127.0.0.1:5300/?host=http://127.0.0.1:4100" }, open };
    expect(await openNewWindow("/repo-b", ask as never, browser)).toBe("browser");
    expect(ask).toHaveBeenCalledWith("windows.open", { path: "/repo-b" });
    expect(open).toHaveBeenCalledWith(
      pageUrlFor(browser.location.href, "http://127.0.0.1:4200", token),
      "_blank",
      "noopener",
    );
    expect(pageUrlFor(browser.location.href, "http://127.0.0.1:4200", token)).toBe(
      `http://127.0.0.1:5300/?host=http%3A%2F%2F127.0.0.1%3A4200#token=${token}`,
    );
  });
});
