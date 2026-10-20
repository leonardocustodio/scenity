// SPDX-License-Identifier: Apache-2.0
/**
 * Component tests of the chat tab, with a fake host client: the start form, the transcript with the text stream, the
 * tool call and its picture, the cost, the prompt keys, Interrupt, the error and Resume, the approval card and the
 * question card.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Chat from "../../src/claude/Chat.vue";
import { CHECKOUT, fakeChatClient, sessionInfo } from "./fakeChat";
import { fakePictures, pictureIdOf } from "./fakePictures";

// The pictures of the chat come from the picture source of the page (object URLs).
let pictures: ReturnType<typeof fakePictures>;
beforeEach(() => {
  pictures = fakePictures();
});
afterEach(() => {
  pictures.stop();
});

async function started(answers: Parameters<typeof fakeChatClient>[0] = {}) {
  const fake = fakeChatClient({
    "agent.live": () => ({ sessions: [{ info: sessionInfo(), messages: [], asks: [] }], credential: "subscription" }),
    ...answers,
  });
  const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
  await flushPromises();
  return { ...fake, wrapper };
}

describe("Chat", () => {
  test("without a session it shows the start form; Start sends the mode ask by default", async () => {
    const fake = fakeChatClient({
      "agent.start": () => ({ session: "chat-1", info: sessionInfo({ state: "starting" }) }),
    });
    const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
    await flushPromises();
    expect(wrapper.find("[data-testid=chat-start]").exists()).toBe(true);
    await wrapper.get("[data-testid=chat-start]").trigger("submit");
    await flushPromises();
    expect(fake.of("agent.start")[0]?.params).toEqual({ mode: "default" });
    expect(wrapper.get("[data-testid=chat-state]").text()).toBe("starting");
  });

  test("the credential picker starts on the subscription; the API key is the second, explicit choice", async () => {
    const fake = fakeChatClient({
      "agent.start": () => {
        throw new Error("The API key option needs ANTHROPIC_API_KEY in the .env file of the checkout root (mode 600).");
      },
    });
    const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
    await flushPromises();
    const picker = wrapper.get<HTMLSelectElement>("[data-testid=chat-start-credential]");
    expect(picker.findAll("option").map((option) => option.text())).toEqual(["Subscription", "API key (.env)"]);
    expect(picker.element.value).toBe("subscription");
    await picker.setValue("api-key");
    await wrapper.get("[data-testid=chat-start]").trigger("submit");
    await flushPromises();
    expect(fake.of("agent.start")[0]?.params).toEqual({ mode: "default", credential: "api-key" });
    expect(wrapper.get("[data-testid=chat-request-error]").text()).toContain("ANTHROPIC_API_KEY");
  });

  test("the picker starts on the choice that the host remembers for the checkout", async () => {
    const fake = fakeChatClient({ "agent.live": () => ({ sessions: [], credential: "api-key" }) });
    const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>("[data-testid=chat-start-credential]").element.value).toBe("api-key");
  });

  test("after a start with the API key and an End, the start form begins on the API key", async () => {
    const fake = fakeChatClient({
      "agent.start": () => ({
        session: "chat-1",
        info: sessionInfo({ state: "starting", credential: "api-key", keyFrom: ".env" }),
      }),
    });
    const wrapper = mount(Chat, { props: { client: fake.client, checkout: CHECKOUT } });
    await flushPromises();
    await wrapper.get("[data-testid=chat-start-credential]").setValue("api-key");
    await wrapper.get("[data-testid=chat-start]").trigger("submit");
    await flushPromises();
    await wrapper.get("[data-testid=chat-end]").trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>("[data-testid=chat-start-credential]").element.value).toBe("api-key");
  });

  test("the bar names the credential of the session", async () => {
    const { wrapper } = await started();
    expect(wrapper.get("[data-testid=chat-credential]").text()).toContain("subscription (claude.ai login)");
    const keyed = await started({
      "agent.live": () => ({
        sessions: [
          {
            info: sessionInfo({ credential: "api-key", keyFrom: ".env", apiKeySource: "ANTHROPIC_API_KEY" }),
            messages: [],
            asks: [],
          },
        ],
        credential: "api-key",
      }),
    });
    expect(keyed.wrapper.get("[data-testid=chat-credential]").text()).toContain(
      "API key (.env) · apiKeySource ANTHROPIC_API_KEY",
    );
  });

  test("streams the text, shows the tool call with its picture and the cost of the result", async () => {
    const { wrapper, emit } = await started();
    const message = (value: unknown): void => emit("agent.message", { session: "chat-1", message: value });
    message({ type: "user", workbenchPrompt: true, message: { role: "user", content: "show the hands" } });
    message({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Look" } },
    });
    message({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "ing" } },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid=chat-prompt]").text()).toBe("show the hands");
    expect(wrapper.get("[data-testid=chat-streaming]").text()).toBe("Looking");
    message({
      type: "assistant",
      uuid: "a1",
      message: {
        content: [
          { type: "text", text: "I look at **the frame**." },
          { type: "tool_use", id: "tu-1", name: "mcp__workbench__lab_frame", input: { t: 6350, camera: "top" } },
        ],
      },
    });
    message({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: [
              { type: "text", text: "Frame at 6350 ms" },
              // The host sends the ID of the picture, not base64.
              { type: "image", picture: { id: pictureIdOf("frame"), mime: "image/webp" } },
            ],
          },
        ],
      },
    });
    message({ type: "result", subtype: "success", total_cost_usd: 0.0123, duration_ms: 2100, num_turns: 2 });
    await flushPromises();
    expect(wrapper.find("[data-testid=chat-streaming]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=chat-text]").find("strong").text()).toBe("the frame");
    expect(wrapper.get("[data-testid=chat-tool]").text()).toContain("workbench · lab_frame");
    expect(wrapper.get("[data-testid=chat-tool-image]").attributes("src")).toBe(`blob:picture-${pictureIdOf("frame")}`);
    expect(wrapper.html()).not.toContain("data:image");
    expect(wrapper.get("[data-testid=chat-result]").text()).toContain("$0.0123 (estimate)");
  });

  test("Enter sends the prompt, Shift+Enter does not; Interrupt stops a running turn", async () => {
    const { wrapper, of, emit } = await started();
    const input = wrapper.get("[data-testid=chat-input]");
    await input.setValue("fix the hat");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(of("agent.prompt")).toHaveLength(0);
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(of("agent.prompt")[0]?.params).toEqual({ session: "chat-1", text: "fix the hat" });
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    emit("agent.status", { info: sessionInfo({ state: "running" }) });
    await flushPromises();
    await wrapper.get("[data-testid=chat-interrupt]").trigger("click");
    await flushPromises();
    expect(of("agent.interrupt")[0]?.params).toEqual({ session: "chat-1" });
  });

  test("a session error shows the error and Resume by the SDK session ID", async () => {
    const { wrapper, of, emit } = await started({
      "agent.resume": () => ({ session: "chat-2", info: sessionInfo({ session: "chat-2" }) }),
    });
    emit("agent.status", { info: sessionInfo({ state: "error", error: "Claude Code returned an error result" }) });
    await flushPromises();
    expect(wrapper.get("[data-testid=chat-error]").text()).toContain("error result");
    expect(wrapper.get("[data-testid=chat-input]").attributes("disabled")).toBeDefined();
    await wrapper.get("[data-testid=chat-resume]").trigger("click");
    await flushPromises();
    expect(of("agent.resume")[0]?.params).toMatchObject({ sessionId: "s-1", mode: "default", fork: false });
  });

  test("the mode picker sends agent.setMode", async () => {
    const { wrapper, of } = await started();
    await wrapper.get("[data-testid=chat-mode]").setValue("acceptEdits");
    await flushPromises();
    expect(of("agent.setMode")[0]?.params).toEqual({ session: "chat-1", mode: "acceptEdits" });
  });
});

describe("approvals and questions", () => {
  test("an Edit approval shows the diff; Allow and Deny with a reason answer", async () => {
    const { wrapper, of, emit } = await started();
    const edit = { file_path: "/repo/families/wave.ts", old_string: "y: 0.01", new_string: "y: 0.006" };
    emit("agent.ask", {
      session: "chat-1",
      ask: "ask-1",
      kind: "tool",
      tool: "Edit",
      input: edit,
      reason: null,
      canRemember: false,
    });
    await flushPromises();
    const card = wrapper.get("[data-testid=approval-card]");
    expect(card.find("[data-kind=del]").text()).toBe("-y: 0.01");
    expect(card.find("[data-kind=add]").text()).toBe("+y: 0.006");
    expect(card.find("[data-testid=approval-allow-session]").exists()).toBe(false);
    await card.get("[data-testid=approval-allow]").trigger("click");
    await flushPromises();
    expect(of("agent.answer")[0]?.params).toEqual({
      session: "chat-1",
      ask: "ask-1",
      decision: { behavior: "allow", scope: "once" },
    });
    emit("agent.askDone", { session: "chat-1", ask: "ask-1" });
    emit("agent.ask", {
      session: "chat-1",
      ask: "ask-2",
      kind: "tool",
      tool: "Bash",
      input: { command: "git status" },
      reason: null,
      canRemember: true,
    });
    await flushPromises();
    expect(wrapper.findAll("[data-testid=approval-card]")).toHaveLength(1);
    expect(wrapper.get("[data-testid=approval-command]").text()).toBe("git status");
    await wrapper.get("[data-testid=approval-deny]").trigger("click");
    await wrapper.get("input[aria-label='Reason for Claude']").setValue("Use the Changes tab.");
    await wrapper.get("[data-testid=approval-deny-send]").trigger("submit");
    await flushPromises();
    expect(of("agent.answer")[1]?.params).toMatchObject({
      ask: "ask-2",
      decision: { behavior: "deny", message: "Use the Changes tab." },
    });
  });

  test("Allow for the session sends the scope session", async () => {
    const { wrapper, of, emit } = await started();
    emit("agent.ask", {
      session: "chat-1",
      ask: "ask-3",
      kind: "tool",
      tool: "Bash",
      input: { command: "bun test" },
      reason: null,
      canRemember: true,
    });
    await flushPromises();
    await wrapper.get("[data-testid=approval-allow-session]").trigger("click");
    await flushPromises();
    expect(of("agent.answer")[0]?.params).toMatchObject({ decision: { behavior: "allow", scope: "session" } });
  });

  test("a question card returns the picked label and the Other text", async () => {
    const { wrapper, of, emit } = await started();
    const questions = [
      {
        question: "Which hand?",
        header: "Hand",
        options: [
          { label: "Left", description: "" },
          { label: "Right", description: "" },
        ],
        multiSelect: false,
      },
      {
        question: "Which checks?",
        header: "Checks",
        options: [
          { label: "wave", description: "" },
          { label: "reach", description: "" },
        ],
        multiSelect: true,
      },
    ];
    emit("agent.ask", {
      session: "chat-1",
      ask: "ask-4",
      kind: "question",
      tool: "AskUserQuestion",
      input: { questions },
      reason: null,
    });
    await flushPromises();
    const card = wrapper.get("[data-testid=question-card]");
    expect(card.get("[data-testid=question-send]").attributes("disabled")).toBeDefined();
    const radios = card.findAll("input[type=radio]");
    await radios[1]?.trigger("change");
    const boxes = card.findAll("input[type=checkbox]");
    await boxes[0]?.trigger("change");
    await boxes[1]?.trigger("change");
    await card.get("input[aria-label='Other answer to Which checks?']").setValue("grip");
    await card.trigger("submit");
    await flushPromises();
    expect(of("agent.answer")[0]?.params).toEqual({
      session: "chat-1",
      ask: "ask-4",
      decision: { behavior: "answer", answers: { "Which hand?": "Right", "Which checks?": "wave, reach, grip" } },
    });
  });
});
