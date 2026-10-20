// SPDX-License-Identifier: Apache-2.0
/**
 * The chat panel state: the chat sessions of the host for the open checkout, the transcript of each one
 * (transcript.ts), the approvals and questions that wait, and the requests of the panel. The host keeps the state. At
 * the start and after a new connection, the panel reads `agent.live`. Thus a reload of the page loses nothing.
 */
import type {
  AgentAsk,
  AgentContextUsage,
  AgentCredential,
  AgentDecision,
  AgentEffort,
  AgentLive,
  AgentMode,
  AgentSessionInfo,
  AgentStartParams,
} from "@scenity/workbench-host/protocol";
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowReactive,
  shallowRef,
  type ComputedRef,
  type Ref,
} from "vue";
import type { HostClient } from "../host/hostClient";
import { appendMessage, foldMessages, type LiveTranscript, type Transcript } from "./transcript";

/** The client parts of the chat. */
export type ChatClient = Pick<HostClient, "request" | "on" | "onHello">;

export interface ChatSessionView {
  readonly info: AgentSessionInfo;
  readonly transcript: Transcript;
  readonly asks: readonly AgentAsk[];
}

/** The view of a session in the store: its transcript changes in place. */
interface StoreView extends ChatSessionView {
  readonly transcript: LiveTranscript;
}

/**
 * A transcript in shallow reactive objects. A new message adds to the list (or replaces one tool entry). Vue renders
 * only the new entries, and the entries (texts, picture IDs) are not deep proxies.
 */
function liveTranscript(messages: readonly unknown[] = []): LiveTranscript {
  const folded = foldMessages(messages);
  return shallowReactive({ entries: shallowReactive(folded.entries), streaming: folded.streaming });
}

export interface ChatApi {
  /** The sessions of the checkout, the oldest first. */
  readonly sessions: ComputedRef<readonly AgentSessionInfo[]>;
  readonly current: Ref<string | null>;
  readonly view: ComputedRef<ChatSessionView | null>;
  /** The error of the last request, or null. */
  readonly error: Ref<string | null>;
  readonly busy: Ref<boolean>;
  readonly context: Ref<AgentContextUsage | null>;
  /** The credential choice that the host remembers for the checkout: the start form begins on it. */
  readonly credential: Ref<AgentCredential>;
  start(params: AgentStartParams): Promise<void>;
  send(text: string): Promise<boolean>;
  interrupt(): Promise<void>;
  answer(ask: string, decision: AgentDecision): Promise<void>;
  setMode(mode: AgentMode): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: AgentEffort): Promise<void>;
  resume(sessionId: string, params: AgentStartParams, fork?: boolean): Promise<void>;
  close(): Promise<void>;
  reload(): Promise<void>;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * The sessions of the host and their transcripts, in Vue refs (one store per panel). The record of the views changes
 * only for a session state or an ask. A message changes its transcript in place, not the record.
 */
class ChatStore {
  readonly views = shallowRef<Record<string, StoreView>>({});
  readonly current = ref<string | null>(null);
  readonly context = ref<AgentContextUsage | null>(null);
  readonly sessions: ComputedRef<readonly AgentSessionInfo[]>;
  readonly view: ComputedRef<ChatSessionView | null>;
  readonly #checkout: string;
  #seq = 0;

  constructor(checkout: string) {
    this.#checkout = checkout;
    this.sessions = computed(() =>
      Object.values(this.views.value)
        .map((view) => view.info)
        .filter((info) => info.checkout === checkout),
    );
    this.view = computed(() => (this.current.value === null ? null : (this.views.value[this.current.value] ?? null)));
  }

  /** Replace every session with the live sessions of the host. */
  load(live: readonly AgentLive[]): void {
    const next: Record<string, StoreView> = {};
    for (const entry of live) {
      next[entry.info.session] = { info: entry.info, transcript: liveTranscript(entry.messages), asks: entry.asks };
    }
    this.views.value = next;
    const mine = live.filter((entry) => entry.info.checkout === this.#checkout);
    const now = this.current.value;
    if (now === null || next[now] === undefined) this.current.value = mine.at(-1)?.info.session ?? null;
  }

  /** A new state of a session. A new session of the checkout becomes the current one. */
  status(info: AgentSessionInfo): void {
    const known = this.views.value[info.session];
    const view: StoreView = known ? { ...known, info } : { info, transcript: liveTranscript(), asks: [] };
    this.views.value = { ...this.views.value, [info.session]: view };
    if (known === undefined && info.checkout === this.#checkout) this.current.value = info.session;
  }

  /** Append the message to the transcript of the session, in place. */
  message(session: string, item: unknown): void {
    const view = this.views.value[session];
    if (view !== undefined) appendMessage(view.transcript, item, (this.#seq += 1));
  }

  ask(ask: AgentAsk): void {
    this.#patch(ask.session, (old) => ({ ...old, asks: [...old.asks.filter((item) => item.ask !== ask.ask), ask] }));
  }

  askDone(session: string, ask: string): void {
    this.#patch(session, (old) => ({ ...old, asks: old.asks.filter((item) => item.ask !== ask) }));
  }

  /** Show a session that a request started or resumed. */
  adopt(result: { session: string; info: AgentSessionInfo }): void {
    if (this.views.value[result.session] === undefined) this.status(result.info);
    this.current.value = result.session;
    this.context.value = null;
  }

  remove(id: string): void {
    this.views.value = Object.fromEntries(Object.entries(this.views.value).filter(([key]) => key !== id));
    this.current.value = this.sessions.value.at(-1)?.session ?? null;
  }

  #patch(id: string, change: (old: StoreView) => StoreView): void {
    const old = this.views.value[id];
    if (old !== undefined) this.views.value = { ...this.views.value, [id]: change(old) };
  }
}

/** The request runner of the panel: one request at a time shows `busy`; a failure goes to `error`. */
function makeRunner(error: Ref<string | null>, busy: Ref<boolean>): (work: () => Promise<unknown>) => Promise<boolean> {
  return async (work) => {
    busy.value = true;
    error.value = null;
    try {
      await work();
      return true;
    } catch (reason) {
      error.value = message(reason);
      return false;
    } finally {
      busy.value = false;
    }
  };
}

type ChatActions = Omit<
  ChatApi,
  "sessions" | "current" | "view" | "error" | "busy" | "context" | "credential" | "reload"
>;

/** The requests of the panel. */
function chatActions(client: ChatClient, store: ChatStore, run: ReturnType<typeof makeRunner>): ChatActions {
  const session = (): string => {
    if (store.current.value === null) throw new Error("No chat session.");
    return store.current.value;
  };
  const call = async (work: () => Promise<unknown>): Promise<void> => {
    await run(work);
  };
  return {
    start: (params) => call(async () => store.adopt(await client.request("agent.start", params))),
    send: (text) => run(() => client.request("agent.prompt", { session: session(), text })),
    interrupt: () => call(() => client.request("agent.interrupt", { session: session() })),
    answer: (ask, decision) => call(() => client.request("agent.answer", { session: session(), ask, decision })),
    setMode: (mode) => call(() => client.request("agent.setMode", { session: session(), mode })),
    setModel: (model) => call(() => client.request("agent.setModel", { session: session(), model })),
    setEffort: (effort) => call(() => client.request("agent.setEffort", { session: session(), effort })),
    resume: (sessionId, params, fork = false) =>
      call(async () => store.adopt(await client.request("agent.resume", { ...params, sessionId, fork }))),
    close: () =>
      call(async () => {
        const id = session();
        await client.request("agent.close", { session: id });
        store.remove(id);
      }),
  };
}

export function useChat(client: ChatClient, checkout: string): ChatApi {
  const store = new ChatStore(checkout);
  const error = ref<string | null>(null);
  const busy = ref(false);
  const credential = ref<AgentCredential>("subscription");

  async function reload(): Promise<void> {
    try {
      const live = await client.request("agent.live", {});
      store.load(live.sessions);
      credential.value = live.credential === "api-key" ? "api-key" : "subscription";
    } catch (reason) {
      error.value = message(reason);
    }
  }

  async function refreshContext(session: string): Promise<void> {
    try {
      store.context.value = await client.request("agent.context", { session });
    } catch {
      store.context.value = null;
    }
  }

  const stops = [
    client.on("agent.status", ({ info }) => store.status(info)),
    client.on("agent.message", ({ session, message: item }) => {
      store.message(session, item);
      const result = (item as { type?: unknown }).type === "result";
      if (result && session === store.current.value) void refreshContext(session);
    }),
    client.on("agent.ask", (ask) => store.ask(ask)),
    client.on("agent.askDone", ({ session, ask }) => store.askDone(session, ask)),
    client.onHello(() => void reload()),
  ];
  void reload();
  const actions = chatActions(client, store, makeRunner(error, busy));
  if (getCurrentScope() !== undefined) onScopeDispose(() => stops.forEach((stop) => stop()));

  return {
    sessions: store.sessions,
    current: store.current,
    view: store.view,
    error,
    busy,
    context: store.context,
    credential,
    ...actions,
    // The host records the choice of a start. The next start form begins on it.
    start: async (params) => {
      await actions.start(params);
      if (error.value === null) credential.value = params.credential ?? "subscription";
    },
    reload,
  };
}
