// SPDX-License-Identifier: Apache-2.0
/**
 * The start of the agent panel. When the studio host serves the window, the panel gets its store and joins the
 * default layout. The agent commands are then available: `agent.focus` (⌘L: show the panel and put the focus in the
 * composer), `agent.new` (⌘T), `agent.send` (⌘↩), `agent.stop` (⌘.), and `agent.rename`, `agent.fork`, `agent.export`
 * and `agent.close` (the ⋯ menu of the panel).
 */
import { defineAsyncComponent, watch } from "vue";
import type { ProposalMode } from "@scenity/editor-core";
import { studioHost } from "../../studio/shell/panels";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { servedByStudio } from "../projects/noProject";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";
import { agentClient } from "./agentClient";
import AgentPanel from "./AgentPanel.vue";
import InstructionsPanel from "./InstructionsPanel.vue";
import NoAgentPanel from "./NoAgentPanel.vue";
import { terminalClient } from "../terminal/terminalClient";
import { createAgentStore, exportText, type AgentStore } from "./agentStore";
import { agentContextPort, inlineSources, type AgentWindowParts } from "./agentWindow";
import { focusSubject, openInlinePrompt, pickPoint, type InlineSources } from "./inlinePrompt";
import { askParams, fillRecipe, localRecipe, PLUGIN_RECIPES, recipeCommands } from "./recipes";
import { startFromPrompt } from "./startFromPrompt";
import { openReview, shareDialog } from "./reviewLink";
import { startPluginToolCommands } from "./pluginToolCommands";
import { startTurnFileMarks } from "./turnFileMarks";
import { noteCommand } from "./noteTasks";
import { startTasks } from "./tasks";
import { pageConsole, type ConsoleStore } from "../console/consoleStore";
import type { RecipeInfo } from "./agentClient";
import { startFollowView } from "./followView";
import "./agent.css";

/** The terminal panel loads xterm.js only when the panel opens. */
const TerminalPanel = defineAsyncComponent(() => import("../terminal/TerminalPanel.vue"));

/** The key context of the agent panel. */
const AGENT_CONTEXT = "agent";

/** Put the focus in the composer of the panel (after the panel shows). */
function focusComposer(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>('[data-testid="agent-composer"]')?.focus();
  });
}

/** Give a text to the person as a file. */
function download(name: string, text: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The commands of the ⋯ menu of a session: rename, fork, export and close. */
function sessionCommands(store: AgentStore, shell: Pick<StudioShell, "notices">): PageKeyCommandSpec[] {
  const none = (): string | null => (store.current() === null ? t("agent-no-session") : null);
  return [
    {
      id: "agent.rename",
      menu: "agent",
      title: t("command-agent-rename"),
      category: "agent",
      when: none,
      run: async () => {
        const answer = await shell.notices.ask({
          spec: "prompt.agentRename",
          title: t("command-agent-rename"),
          text: "",
          input: { label: t("agent-name"), testId: "command-prompt-input", value: store.current()?.name ?? "" },
          actions: [
            { id: "go", label: t("command-prompt-go"), testId: "command-prompt-go", tone: "primary", needsText: true },
            { id: "cancel", label: t("command-prompt-cancel") },
          ],
          dismiss: "cancel",
        });
        if (answer?.action === "go") await store.patch({ name: answer.text });
      },
    },
    {
      id: "agent.fork",
      menu: "agent",
      title: t("command-agent-fork"),
      category: "agent",
      when: none,
      run: () => store.fork(),
    },
    {
      id: "agent.export",
      menu: "agent",
      title: t("command-agent-export"),
      category: "agent",
      when: none,
      run: () => {
        const session = store.current();
        if (session !== null) download(`${session.name}.md`, exportText(session, t));
      },
    },
    {
      id: "agent.close",
      menu: "agent",
      title: t("command-agent-close"),
      category: "agent",
      when: none,
      run: async () => {
        const id = store.active.value;
        if (id !== null) await store.close(id);
      },
    },
  ];
}

/** The commands of the agent panel. */
export function agentCommands(
  store: AgentStore,
  shell: Pick<StudioShell, "showPanel" | "notices">,
): PageKeyCommandSpec[] {
  const show = (): void => {
    shell.showPanel("agent");
    focusComposer();
  };
  return [
    {
      id: "agent.focus",
      title: t("panel-agent"),
      keys: ["Mod+L"],
      inText: true,
      category: "agent",
      menu: "agent",
      run: show,
    },
    // A prompt in the composer of the agent panel (the person reads it and sends it).
    {
      id: "agent.ask",
      title: t("command-agent-ask"),
      category: "agent",
      args: { prompt: { type: "string", description: t("command-arg-prompt") } },
      run: (args) => {
        store.draft.value = String(args.prompt ?? "");
        show();
      },
    },
    {
      id: "agent.new",
      menu: "agent",
      title: t("command-agent-new"),
      keys: ["Mod+T"],
      keyContext: AGENT_CONTEXT,
      inText: true,
      category: "agent",
      run: async () => {
        await store.create();
        show();
      },
    },
    {
      id: "agent.send",
      title: t("command-agent-send"),
      keys: ["Mod+Enter"],
      keyContext: AGENT_CONTEXT,
      inText: true,
      category: "agent",
      when: () => (store.draft.value.trim() === "" ? t("agent-empty") : null),
      run: () => store.submit(),
    },
    {
      id: "agent.stop",
      menu: "agent",
      title: t("command-agent-stop"),
      keys: ["Mod+."],
      keyContext: AGENT_CONTEXT,
      inText: true,
      category: "agent",
      when: () => (store.current()?.running === true ? null : t("agent-not-running")),
      run: () => store.stop(),
    },
    ...sessionCommands(store, shell),
  ];
}

/** The last active panel of the dock other than the agent panel (the panel chip), or null. */
export function lastPanel(shell: Pick<StudioShell, "dock">): () => string | null {
  let last: string | null = null;
  const read = (): string | null => {
    const id = shell.dock.api.activePanel?.id ?? null;
    if (id !== null && id !== "agent") last = id;
    return last;
  };
  shell.dock.api.onDidActivePanelChange(read);
  return read;
}

/**
 * The attention of the person: a toast when a turn ends, and a toast and a fact of the bell while a session waits for
 * the person. The panel never takes the focus.
 */
export function watchAttention(store: AgentStore, shell: Pick<StudioShell, "notices" | "status">): void {
  const bells = new Map<string, () => void>();
  watch(store.sessions, (now, old) => {
    for (const session of now) {
      const before = old.find((item) => item.id === session.id);
      if (before?.running === true && !session.running)
        shell.notices.toast(t("agent-turn-ended", { name: session.name }));
      const waits = session.waiting === true;
      if (waits && before?.waiting !== true) {
        shell.notices.toast(t("agent-turn-waits", { name: session.name }));
        bells.set(session.id, shell.status.remember(t("agent-turn-waits", { name: session.name })));
      }
      if (!waits) {
        bells.get(session.id)?.();
        bells.delete(session.id);
      }
    }
  });
}

/** The errors of the agent sessions and of their tools go to the Console panel (source "agent"). */
export function watchAgentErrors(store: Pick<AgentStore, "sessions">, log: ConsoleStore = pageConsole()): void {
  const seen = new Set<string>();
  watch(
    store.sessions,
    (sessions) => {
      for (const session of sessions) {
        for (const item of session.items) {
          const key = `${session.id}:${String(item.id)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (item.kind === "error")
            log.add({ level: "error", source: "agent", text: `${session.name}: ${item.text}` });
          if (item.kind === "tool" && item.isError) {
            const text = `${session.name}: ${item.name}: ${item.result ?? ""}`;
            log.add({ level: "error", source: "agent", text });
          }
        }
      }
    },
    { immediate: true },
  );
}

/** The inline prompt (⌘I) at the place of the focus, or at a point of the view that the person clicks. */
function inlineCommand(store: AgentStore, sources: InlineSources): PageKeyCommandSpec {
  return {
    id: "agent.inline",
    title: t("command-agent-inline"),
    keys: ["Mod+I"],
    inText: true,
    category: "agent",
    menu: "agent",
    run: async () => {
      const found = focusSubject(sources, document.activeElement);
      const subject = found === "point" ? await pickPoint(sources) : found;
      if (subject === null) return;
      openInlinePrompt(subject, (text) => store.sendInline(text, subject.chips, subject.label));
    },
  };
}

/** The recipes of the project as commands. A run asks for the parameters and sends the prompt. */
async function startRecipes(store: AgentStore, shell: StudioShell, project: string): Promise<void> {
  const recipes = (
    await agentClient()
      .recipes(project)
      .catch(() => ({ recipes: [] }))
  ).recipes.map(localRecipe);
  const run = async (recipe: RecipeInfo): Promise<void> => {
    const values = await askParams(shell.notices, recipe);
    if (values === null) return;
    if (store.current() === null) await store.create({ name: recipe.title });
    shell.showPanel("agent");
    await store.send(fillRecipe(recipe, values));
  };
  // The recipes of the plugins join the recipes of the host. A change of these recipes makes the commands again.
  let stop = (): void => undefined;
  const apply = (): void => {
    const all = [...recipes, ...PLUGIN_RECIPES];
    store.recipes.value = all;
    store.runRecipe = (id) => {
      const recipe = all.find((item) => item.id === id);
      if (recipe !== undefined) void run(recipe);
    };
    stop();
    stop = pageKeys().register(recipeCommands(all, (recipe) => run(recipe)));
  };
  apply();
  watch(PLUGIN_RECIPES, apply);
  // Run in… of the Hub opens the window with `recipe=<id>`: the window runs that recipe once.
  const url = new URL(location.href);
  const asked = url.searchParams.get("recipe");
  if (asked !== null) {
    url.searchParams.delete("recipe");
    history.replaceState(history.state, "", url);
    store.runRecipe(asked);
  }
}

/**
 * The studio runs with no agent: the agent panel says how to connect one, and ⌘L and ⌘I show it with a toast.
 * All the other features work as usual.
 */
function startNoAgent(shell: StudioShell): void {
  shell.setPanel("agent", { component: NoAgentPanel });
  studioHost.value = true;
  const tell = (): void => {
    shell.showPanel("agent");
    shell.notices.toast(t("agent-none-title"), t("agent-none-body"));
  };
  pageKeys().register([
    { id: "agent.focus", title: t("panel-agent"), keys: ["Mod+L"], inText: true, category: "agent", run: tell },
    {
      id: "agent.inline",
      title: t("command-agent-inline"),
      keys: ["Mod+I"],
      inText: true,
      category: "agent",
      run: tell,
    },
  ]);
}

/** Start the agent panel of a project when the studio host serves the window. */
export function startAgentPanel(shell: StudioShell, project: string, window: AgentWindowParts): void {
  void servedByStudio().then(async (studio) => {
    if (!studio) return;
    // The terminals work with an agent or with no agent.
    shell.setPanel("terminal", { component: TerminalPanel, props: { client: terminalClient(), project } });
    // The tools of the plugins are commands of the search box, with an agent or with no agent.
    void startPluginToolCommands(project, shell.notices);
    const status = await agentClient()
      .status()
      .catch(() => ({ available: false, driver: null }));
    if (!status.available) {
      startNoAgent(shell);
      return;
    }
    const store = createAgentStore({
      project,
      client: agentClient(),
      setSwitch: (mode: ProposalMode) => globalThis.__scenity?.setProposalMode?.(mode),
      context: agentContextPort(window),
    });
    store.start();
    // The files that the turns of the agents wrote have a mark in the Project window.
    startTurnFileMarks(store, agentClient());
    const run = (command: string): void => void pageKeys().run(command);
    // The Instructions panel.
    shell.setPanel("instructions", { component: InstructionsPanel, props: { client: agentClient(), project } });
    // "Share for review" of a turn gives a review link.
    const share = (turn: number): void => void shareDialog(shell, store, turn);
    shell.setPanel("agent", { component: AgentPanel, props: { store, run, share } });
    studioHost.value = true;
    shell.dock.adopt("agent");
    // "Ask the agent" of the search box sends the text to the agent panel.
    shell.search.ask = (text) => {
      shell.showPanel("agent");
      void store.send(text);
    };
    // The status item of the agents, "Follow the agent" and the attention of the person.
    const follow = startFollowView(shell);
    watchAttention(store, shell);
    watchAgentErrors(store);
    // The recipes as commands, and `/` in the composer.
    void startRecipes(store, shell, project);
    // A new project of "Start from a prompt" sends the words of the person to a session in review mode.
    void startFromPrompt(store, shell);
    // The window of a review link shows the session of the turn and the Notes panel.
    openReview(store, shell);
    pageKeys().register([
      ...agentCommands(store, shell),
      { id: "agent.follow", title: t("command-agent-follow"), category: "agent", menu: "agent", run: () => follow() },
      inlineCommand(store, inlineSources(window)),
      // The background tasks.
      startTasks(store, shell, project, agentClient()),
      // A note as a task of the agent.
      noteCommand(
        store,
        window.editor,
        () => window.selection(),
        () => shell.showPanel("agent"),
      ),
    ]);
  });
}
