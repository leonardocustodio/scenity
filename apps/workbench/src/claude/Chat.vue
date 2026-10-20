<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The chat tab of the Claude panel: Claude Code through the Agent SDK in the host. The transcript streams the text,
 * folds the tool calls and shows the pictures of the tool results. The cards of the approvals and the questions wait
 * above the prompt box. The bar has the mode, the model, the effort, the cost and Interrupt. The host adds the context
 * packet to every prompt.
 *
 * Enter sends the prompt; Shift+Enter makes a new line. Reduced motion: the transcript does not scroll by itself.
 */
import type { AgentSessionInfo } from "@scenity/workbench-host/protocol";
import { computed, nextTick, ref, watch } from "vue";
import { button, cn, field } from "../layout/ui";
import ApprovalCard from "./ApprovalCard.vue";
import ChatBar from "./ChatBar.vue";
import ChatMessage from "./ChatMessage.vue";
import ChatStart from "./ChatStart.vue";
import QuestionCard from "./QuestionCard.vue";
import { useChat, type ChatClient } from "./useChat";

defineOptions({ name: "ClaudeChat" });
const props = defineProps<{
  readonly client: ChatClient;
  readonly checkout: string;
}>();

const chat = useChat(props.client, props.checkout);
const { view, sessions, current, error, busy, context, credential } = chat;
const text = ref("");
const scroller = ref<HTMLElement | null>(null);
const info = computed(() => view.value?.info ?? null);
const stopped = computed(() => info.value?.state === "error" || info.value?.state === "ended");

async function send(): Promise<void> {
  const prompt = text.value;
  if (prompt.trim() === "" || stopped.value) return;
  if (await chat.send(prompt)) text.value = "";
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
}

function resume(session: AgentSessionInfo): void {
  if (session.sdkSessionId === null) return;
  void chat.resume(session.sdkSessionId, {
    mode: session.mode,
    credential: session.credential,
    ...(session.model === null ? {} : { model: session.model }),
    ...(session.effort === null ? {} : { effort: session.effort }),
    ...(session.maxBudgetUsd === null ? {} : { maxBudgetUsd: session.maxBudgetUsd }),
    ...(session.maxTurns === null ? {} : { maxTurns: session.maxTurns }),
  });
}

function reducedMotion(): boolean {
  try {
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// The transcript changes in place. Its length, its last entry and the streamed text show a change.
watch(
  () => [
    view.value?.transcript.entries.length,
    view.value?.transcript.entries.at(-1),
    view.value?.transcript.streaming,
    view.value?.asks.length,
  ],
  async () => {
    if (reducedMotion()) return;
    await nextTick();
    const element = scroller.value;
    if (element !== null) element.scrollTop = element.scrollHeight;
  },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="chat">
    <ChatStart v-if="info === null" :busy="busy" :credential="credential" @start="chat.start" />
    <template v-else>
      <select
        v-if="sessions.length > 1"
        v-model="current"
        :class="cn(field, 'm-2 w-auto')"
        aria-label="Chat session"
        data-testid="chat-session"
      >
        <option v-for="item in sessions" :key="item.session" :value="item.session">
          {{ item.session }} · {{ item.sdkSessionId?.slice(0, 8) ?? "new" }} · {{ item.state }}
        </option>
      </select>
      <ChatBar
        :info="info"
        :context="context"
        :busy="busy"
        @mode="chat.setMode"
        @model="chat.setModel"
        @effort="chat.setEffort"
        @interrupt="chat.interrupt"
        @end="chat.close"
        @resume="resume(info)"
      />
      <div
        ref="scroller"
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 text-body"
        aria-live="polite"
        data-testid="chat-transcript"
      >
        <ChatMessage v-for="entry in view?.transcript.entries ?? []" :key="entry.id" :entry="entry" />
        <p v-if="view?.transcript.streaming" class="whitespace-pre-wrap" data-testid="chat-streaming">
          {{ view.transcript.streaming }}
        </p>
        <template v-for="ask in view?.asks ?? []" :key="ask.ask">
          <QuestionCard v-if="ask.kind === 'question'" :ask="ask" :disabled="busy" @answer="chat.answer" />
          <ApprovalCard v-else :ask="ask" :disabled="busy" @answer="chat.answer" />
        </template>
      </div>
      <form class="flex gap-1 border-t border-border-subtle p-2" @submit.prevent="send">
        <textarea
          v-model="text"
          :class="cn(field, 'min-h-16 resize-y py-1')"
          :disabled="stopped"
          aria-label="Prompt"
          placeholder="Ask Claude. The context of the lab goes with the prompt."
          data-testid="chat-input"
          @keydown="onKey"
        />
        <button type="submit" :class="button" :disabled="busy || stopped || text.trim() === ''" data-testid="chat-send">
          Send
        </button>
      </form>
    </template>
    <p v-if="error" class="px-3 pb-2 text-caption text-status-negative" role="alert" data-testid="chat-request-error">
      {{ error }}
    </p>
  </div>
</template>
