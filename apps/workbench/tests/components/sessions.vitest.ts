// SPDX-License-Identifier: Apache-2.0
/**
 * Component tests of the Sessions tab: the list of the sessions of the checkout, and Resume and Fork with the kept
 * options of the session or with the options of the pickers.
 */
import type { AgentSessionEntry } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Sessions from "../../src/dock/Sessions.vue";
import { fakeChatClient } from "./fakeChat";

const ENTRY: AgentSessionEntry = {
  sessionId: "0f3c9a51-aaaa",
  title: "Fix the hat",
  firstPrompt: "the hat lifts off",
  lastModified: Date.parse("2026-10-11T15:00:00Z"),
  createdAt: null,
  gitBranch: "lc/room3d-sdk",
  costUsd: 0.21,
  workbench: true,
  live: null,
  options: { mode: "acceptEdits", credential: "api-key", model: "claude-haiku-5-5", maxBudgetUsd: 0.25 },
  kept: true,
};

describe("Sessions", () => {
  test("lists the sessions with the cost, and resumes or forks one", async () => {
    const fake = fakeChatClient({
      "agent.sessions": () => ({ sessions: [ENTRY] }),
      "agent.resume": () => ({ session: "chat-3", info: {} }),
    });
    const wrapper = mount(Sessions, { props: { dock: { request: fake.client.request } } });
    await flushPromises();
    const row = wrapper.get("[data-testid=session-row]");
    expect(row.text()).toContain("Fix the hat");
    expect(row.text()).toContain("$0.2100 (estimate)");
    expect(row.text()).toContain("the hat lifts off");
    // The row shows the model and the credential of the session. A fork without the pickers sends no option.
    const options = row.get("[data-testid=session-options]").text();
    expect(options).toContain("model claude-haiku-5-5");
    expect(options).toContain("API key (.env)");
    expect(options).toContain("budget $0.25");
    expect(options).not.toContain("defaults of the start form");
    await row.get("[data-testid=session-fork]").trigger("click");
    await flushPromises();
    expect(fake.of("agent.resume")[0]?.params).toEqual({ sessionId: ENTRY.sessionId, fork: true });
    expect(wrapper.get("[data-testid=sessions-notice]").text()).toContain("chat-3");
  });

  test("the pickers of a row start on the options of the session and their choice goes with the resume", async () => {
    const fake = fakeChatClient({
      "agent.sessions": () => ({ sessions: [ENTRY] }),
      "agent.resume": () => ({ session: "chat-4", info: {} }),
    });
    const wrapper = mount(Sessions, { props: { dock: { request: fake.client.request } } });
    await flushPromises();
    const row = wrapper.get("[data-testid=session-row]");
    expect(row.find("[data-testid=session-pickers]").exists()).toBe(false);
    await row.get("[data-testid=session-edit]").trigger("click");
    const credential = row.get<HTMLSelectElement>("[data-testid=session-credential]");
    const model = row.get<HTMLInputElement>("[data-testid=session-model]");
    expect(credential.element.value).toBe("api-key");
    expect(row.get<HTMLSelectElement>("[data-testid=session-mode]").element.value).toBe("acceptEdits");
    expect(model.element.value).toBe("claude-haiku-5-5");
    await credential.setValue("subscription");
    await model.setValue("claude-sonnet-5-5");
    await row.get("[data-testid=session-effort]").setValue("low");
    await row.get("[data-testid=session-resume]").trigger("click");
    await flushPromises();
    expect(fake.of("agent.resume")[0]?.params).toEqual({
      sessionId: ENTRY.sessionId,
      fork: false,
      credential: "subscription",
      mode: "acceptEdits",
      model: "claude-sonnet-5-5",
      effort: "low",
    });
    expect(row.find("[data-testid=session-pickers]").exists()).toBe(false);
  });

  test("a session without kept options shows the defaults of the start form", async () => {
    const entry: AgentSessionEntry = {
      ...ENTRY,
      workbench: false,
      options: { mode: "default", credential: "subscription" },
      kept: false,
    };
    const fake = fakeChatClient({ "agent.sessions": () => ({ sessions: [entry] }) });
    const wrapper = mount(Sessions, { props: { dock: { request: fake.client.request } } });
    await flushPromises();
    const options = wrapper.get("[data-testid=session-options]").text();
    expect(options).toContain("model the default of the account");
    expect(options).toContain("Subscription");
    expect(options).toContain("(the defaults of the start form)");
  });

  test("shows the error of the host", async () => {
    const fake = fakeChatClient({
      "agent.sessions": () => {
        throw new Error("No sessions.");
      },
    });
    const wrapper = mount(Sessions, { props: { dock: { request: fake.client.request } } });
    await flushPromises();
    expect(wrapper.get("[data-testid=sessions-error]").text()).toBe("No sessions.");
  });
});
