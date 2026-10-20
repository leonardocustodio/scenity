// SPDX-License-Identifier: Apache-2.0
/**
 * The render cost of a long chat transcript: 400 messages of the host, each with a render after it, as a long chat
 * session gives them. The test prints the total time and the time of the last 50 messages. It checks that the cost of
 * one message does not increase with the length of the transcript (append-only updates, no copy of the full list for
 * each message).
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { nextTick } from "vue";
import Chat from "../../src/claude/Chat.vue";
import { CHECKOUT, fakeChatClient, sessionInfo } from "./fakeChat";
import { fakePictures } from "./fakePictures";

/** The count of messages of the run. */
const MESSAGES = 400;

/** The picture block of a tool result: a picture ID of the host picture store. */
function pictureBlock(index: number): Record<string, unknown> {
  return { type: "image", picture: { id: index.toString(16).padStart(32, "0"), mime: "image/webp" } };
}

/** Message `index` of a scripted session: a tool call, its result with a picture, then texts, in a cycle of four. */
function scripted(index: number): Record<string, unknown> {
  const kind = index % 4;
  const tool = `tool-${String(Math.floor(index / 4))}`;
  if (kind === 0) {
    return {
      type: "assistant",
      uuid: `a${String(index)}`,
      message: { content: [{ type: "tool_use", id: tool, name: "mcp__workbench__lab_frame", input: { t: index } }] },
    };
  }
  if (kind === 1) {
    return {
      type: "user",
      uuid: `u${String(index)}`,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: tool,
            content: [{ type: "text", text: `Frame at ${String(index)} ms` }, pictureBlock(index)],
          },
        ],
      },
    };
  }
  const text = `Message ${String(index)}: the hands of ada stay on the parcel; **the walk** goes on.`;
  return { type: "assistant", uuid: `t${String(index)}`, message: { content: [{ type: "text", text }] } };
}

describe("Chat transcript render", () => {
  test(`${String(MESSAGES)} messages render with a flat cost per message`, async () => {
    const fake = fakeChatClient({
      "agent.live": () => ({ sessions: [{ info: sessionInfo(), messages: [], asks: [] }], credential: "subscription" }),
    });
    const pictures = fakePictures();
    const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
    await flushPromises();
    const times: number[] = [];
    const start = performance.now();
    for (let index = 0; index < MESSAGES; index += 1) {
      const begin = performance.now();
      fake.emit("agent.message", { session: "chat-1", message: scripted(index) });
      await nextTick();
      times.push(performance.now() - begin);
    }
    const total = performance.now() - start;
    const mean = (list: readonly number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length;
    const first = mean(times.slice(10, 60));
    const last = mean(times.slice(-50));
    process.stderr.write(
      `chat render: ${String(MESSAGES)} messages in ${total.toFixed(0)} ms; ` +
        `per message ${first.toFixed(2)} ms (messages 10-60) → ${last.toFixed(2)} ms (the last 50)\n`,
    );
    expect(wrapper.findAll("[data-testid=chat-tool]")).toHaveLength(MESSAGES / 4);
    expect(wrapper.findAll("[data-testid=chat-tool-image]")).toHaveLength(MESSAGES / 4);
    // The pictures are object URLs of the picture source, never data URLs.
    expect(wrapper.html()).not.toContain("data:image");
    expect(wrapper.get("[data-testid=chat-tool-image]").attributes("src")).toMatch(/^blob:picture-/);
    // Append-only: the last messages cost approximately the same as the first ones.
    // The limit is loose for a busy machine.
    expect(last).toBeLessThan(Math.max(first * 4, 4));
    await flushPromises();
    wrapper.unmount();
    // Each picture view released its picture.
    expect(pictures.held.size).toBe(0);
    pictures.stop();
  });
});
