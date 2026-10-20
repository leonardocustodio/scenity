// SPDX-License-Identifier: Apache-2.0
// The sessions of the Claude terminal: the recorded sessions of the host, "Resume" with the session of this terminal,
// and "Export transcript" into a folder of the checkout.
import type { TerminalSessionInfo } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TerminalSessions from "../../src/claude/TerminalSessions.vue";

const SESSIONS: TerminalSessionInfo[] = [
  {
    ...{ session: "1c6d3e4f-2222-4333-9444-a55566667777", terminal: "claude-new", checkout: "/repo" },
    ...{ started: "2026-10-12T22:30:00.000Z", seen: "2026-10-12T22:31:00.000Z", source: "launch" },
    ...{ live: false, transcript: true },
  },
  {
    ...{ session: "0b5c2d3e-1111-4222-8333-944455556666", terminal: "claude-this", checkout: "/repo" },
    ...{ started: "2026-10-12T22:09:00.000Z", seen: "2026-10-12T22:27:00.000Z", source: "hook" },
    ...{ live: true, transcript: true },
  },
];

function client(fail = false) {
  const requests: { type: string; params: unknown }[] = [];
  return {
    requests,
    request: (type: string, params: Record<string, unknown>) => {
      requests.push({ type, params });
      if (type === "terminal.sessions") return Promise.resolve({ sessions: SESSIONS });
      if (fail) return Promise.reject(new Error("The folder must be in the checkout: ../x"));
      return Promise.resolve({ path: `/repo/${String(params.folder)}/transcript-0b5c2d3e.md`, messages: 12 });
    },
  };
}

async function open(fail = false) {
  const fake = client(fail);
  const wrapper = mount(TerminalSessions, {
    props: { client: fake as never, terminal: "claude-this" },
  });
  const details = wrapper.find('[data-testid="terminal-sessions"]');
  (details.element as HTMLDetailsElement).open = true;
  await details.trigger("toggle");
  await flushPromises();
  return { wrapper, fake };
}

describe("the sessions of the Claude terminal", () => {
  it("lists the sessions and resumes the session of this terminal", async () => {
    const { wrapper } = await open();
    const options = wrapper.findAll('[data-testid="terminal-session-pick"] option');
    expect(options).toHaveLength(3);
    expect(options[0]?.text()).toContain("0b5c2d3e");
    expect(options[0]?.text()).toContain("this terminal");
    await wrapper.find('[data-testid="terminal-resume"]').trigger("click");
    expect(wrapper.emitted("resume")).toEqual([["0b5c2d3e-1111-4222-8333-944455556666"]]);
    await wrapper.find('[data-testid="terminal-session-pick"]').setValue(SESSIONS[0]?.session);
    await wrapper.find('[data-testid="terminal-resume"]').trigger("click");
    expect(wrapper.emitted("resume")?.[1]).toEqual(["1c6d3e4f-2222-4333-9444-a55566667777"]);
  });

  it("exports the transcript into the folder and says where; an error shows", async () => {
    const { wrapper, fake } = await open();
    await wrapper.find('[data-testid="terminal-export-folder"]').setValue("records/first-loop");
    await wrapper.find('[data-testid="terminal-export"]').trigger("click");
    await flushPromises();
    expect(fake.requests.at(-1)).toEqual({
      type: "terminal.export",
      params: { session: "0b5c2d3e-1111-4222-8333-944455556666", folder: "records/first-loop" },
    });
    expect(wrapper.find('[data-testid="terminal-sessions-status"]').text()).toContain("(12 messages)");
    const failing = await open(true);
    await failing.wrapper.find('[data-testid="terminal-export"]').trigger("click");
    await flushPromises();
    expect(failing.wrapper.find('[data-testid="terminal-sessions-status"]').text()).toContain(
      "must be in the checkout",
    );
  });
});
