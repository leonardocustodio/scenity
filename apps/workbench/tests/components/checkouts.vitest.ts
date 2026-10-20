// SPDX-License-Identifier: Apache-2.0
/**
 * The start screen: the list of worktrees, the open action, and a new worktree from a branch.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Checkouts from "../../src/start/Checkouts.vue";
import { fakeDock } from "./fakeDock";
import { CHECKOUT, fakeHost, type Answers } from "./fakeHost";

const OTHER = {
  path: "/Users/leo/Development/Snowpine/scenity-lc-wave",
  branch: null,
  head: "1234567890ab",
  changed: 0,
  open: false,
};

function mountScreen(answers: Answers, current: string | null = CHECKOUT.path) {
  const { host, calls } = fakeHost({ answers });
  const wrapper = mount(Checkouts, {
    props: { request: host.request, openCheckout: (path: string) => host.openCheckout(path), current },
  });
  return { wrapper, calls, host };
}

describe("Checkouts", () => {
  test("lists the worktrees with the branch, the path and the changed files", async () => {
    const { wrapper } = mountScreen({ "checkouts.list": () => [CHECKOUT, OTHER] });
    await flushPromises();
    const rows = wrapper.findAll("[data-testid=checkout-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain("lc/room3d-sdk");
    expect(rows[0]?.text()).toContain("3 changed files");
    expect(rows[0]?.text()).toContain("open here");
    expect(rows[1]?.text()).toContain("detached at 12345678");
    expect(rows[1]?.text()).toContain("0 changed files");
  });

  test("opens another checkout and closes the screen", async () => {
    const { wrapper, calls, host } = mountScreen({
      "checkouts.list": () => [CHECKOUT, OTHER],
      "checkouts.open": () => ({ checkout: { ...OTHER, open: true }, surfaces: [] }),
    });
    await flushPromises();
    await wrapper.get("[data-testid=open-scenity-lc-wave]").trigger("click");
    await flushPromises();
    expect(calls.at(-1)).toEqual({ type: "checkouts.open", params: { path: OTHER.path } });
    expect(host.checkout.value?.path).toBe(OTHER.path);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("shows the error of the host", async () => {
    const { wrapper } = mountScreen({
      "checkouts.list": () => [OTHER],
      "checkouts.open": () => {
        throw new Error("The worktree has no package.json.");
      },
    });
    await flushPromises();
    await wrapper.get("[data-testid=open-scenity-lc-wave]").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid=checkouts-error]").text()).toBe("The worktree has no package.json.");
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  test("makes a worktree from a branch and lists it", async () => {
    let list = [CHECKOUT];
    const made = { ...OTHER, branch: "lc/wave" };
    const { wrapper, calls } = mountScreen({
      "checkouts.list": () => list,
      "checkouts.create": () => {
        list = [CHECKOUT, made];
        return made;
      },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid=checkout-create-submit]").attributes("disabled")).toBeDefined();
    await wrapper.get("input[name=branch]").setValue(" lc/wave ");
    await wrapper.get("input[name=base]").setValue("develop");
    await wrapper.get("[data-testid=checkout-create]").trigger("submit");
    await flushPromises();
    expect(calls.find((call) => call.type === "checkouts.create")?.params).toEqual({
      branch: "lc/wave",
      base: "develop",
    });
    expect(wrapper.findAll("[data-testid=checkout-row]")).toHaveLength(2);
    expect(wrapper.findAll("[data-testid=checkout-row]")[1]?.classes()).toContain("bg-accent-brand/10");
  });

  test("a new worktree is preparing with the output of its setup run, then opens", async () => {
    // The host runs `bun install` and `bun run generate` in a new worktree. The lab needs both.
    const made = { ...OTHER, branch: "lc/wave" };
    let list = [CHECKOUT];
    const { host } = fakeHost({
      answers: {
        "checkouts.list": () => list,
        "checkouts.create": () => {
          list = [CHECKOUT, { ...made, setup: { state: "preparing", run: "su-1" } }];
          return list[1]!;
        },
      },
    });
    const events = fakeDock();
    const wrapper = mount(Checkouts, {
      props: {
        request: host.request,
        openCheckout: () => Promise.resolve(),
        current: CHECKOUT.path,
        on: events.dock.on.bind(events.dock),
      },
    });
    await flushPromises();
    await wrapper.get("input[name=branch]").setValue("lc/wave");
    // The first line comes before the answer of checkouts.create.
    events.emit("runs.output", { run: "su-1", stream: "stdout", data: "$ bun install --frozen-lockfile\n" });
    await wrapper.get("[data-testid=checkout-create]").trigger("submit");
    await flushPromises();
    events.emit("runs.output", { run: "su-1", stream: "stdout", data: "\u001b[32m1820 packages installed\u001b[0m\n" });
    await flushPromises();
    expect(wrapper.get("[data-testid=preparing-scenity-lc-wave]").text()).toBe("preparing");
    expect(wrapper.get("[data-testid=open-scenity-lc-wave]").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-testid=window-scenity-lc-wave]").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-testid=setup-output-scenity-lc-wave]").text()).toBe(
      "$ bun install --frozen-lockfile\n1820 packages installed",
    );
    list = [CHECKOUT, made];
    events.emit("runs.done", { run: "su-1", code: 0, summary: "", outDir: null, images: [] });
    await flushPromises();
    expect(wrapper.find("[data-testid=preparing-scenity-lc-wave]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=open-scenity-lc-wave]").attributes("disabled")).toBeUndefined();
    list = [CHECKOUT, { ...made, setup: { state: "failed", run: "su-1" } }];
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid=setup-failed-scenity-lc-wave]").text()).toContain("setup failed");
    wrapper.unmount();
  });

  test("the open checkout row returns to it", async () => {
    const { wrapper, calls } = mountScreen({ "checkouts.list": () => [CHECKOUT] });
    await flushPromises();
    await wrapper.get("[data-testid=open-scenity]").trigger("click");
    expect(calls.map((call) => call.type)).toEqual(["checkouts.list"]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
