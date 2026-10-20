<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Agents in the Hub: the built-in agent (Claude on this machine, from the doctor), the external agents over MCP, and
 * the defaults of new sessions (the permission mode and the budget). Every feature works with no agent.
 */
import ExternalClients from "./ExternalClients.vue";
import RecipesSection from "./RecipesSection.vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { RadioGroup, Select } from "@scenity/ui";
import { Bot, Cable } from "lucide-vue-next";
import { studioRecipes, studioUsage, type AgentMode, type HubRecipe } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const claude = computed(() => props.hub.state.checks?.find((check) => check.id === "claude") ?? null);
const agent = computed(() => props.hub.state.studio?.preferences.agent ?? null);
const modes = () => (["ask", "review", "auto"] as const).map((value) => ({ value, label: $t(`hub-mode-${value}`) }));

type Kinds = Readonly<Record<string, "allow" | "ask" | "deny">>;

function save(change: Partial<{ mode: AgentMode; budgetUsd: number; kinds: Kinds }>): void {
  if (agent.value === null) return;
  void props.hub.savePreferences({ agent: { ...agent.value, ...change } });
}

// The value of each kind of action; "default" keeps the value of the mode. The stricter value wins.
const KINDS = ["scene", "files", "runs", "imports", "network"] as const;
const kindOptions = () =>
  (["default", "allow", "ask", "deny"] as const).map((value) => ({ value, label: $t(`hub-agents-kind-${value}`) }));

function saveKind(kind: string, value: string): void {
  const others = Object.entries(agent.value?.kinds ?? {}).filter(([key]) => key !== kind);
  const set = value === "allow" || value === "ask" || value === "deny" ? [[kind, value] as const] : [];
  save({ kinds: Object.fromEntries([...others, ...set]) });
}

// The configuration of each external agent: one line to copy into its app or its terminal.
const SERVER = { command: "scenity", args: ["mcp"] };
const SETUPS = [
  { id: "claude-code", text: "claude mcp add scenity -- scenity mcp --name 'Claude Code'" },
  { id: "codex", text: "codex mcp add scenity -- scenity mcp --name Codex" },
  {
    id: "cursor",
    text: JSON.stringify({ mcpServers: { scenity: { ...SERVER, args: ["mcp", "--name", "Cursor"] } } }),
  },
  {
    id: "claude-desktop",
    text: JSON.stringify({ mcpServers: { scenity: { ...SERVER, args: ["mcp", "--name", "Claude Desktop"] } } }),
  },
] as const;
const copied = ref<string | null>(null);

function copySetup(id: string, text: string): void {
  void navigator.clipboard.writeText(text).then(() => (copied.value = id));
}

// The recipes of the studio and of the person.
const recipes = ref<HubRecipe[]>([]);
function loadRecipes(): void {
  void studioRecipes().then((list) => (recipes.value = list));
}
/** Open a project in the editor. The result is the address of its window, or null. */
async function openProject(dir: string): Promise<string | null> {
  const opened = await props.hub.attempt(() => props.hub.api.openProject(dir));
  return opened?.url ?? null;
}
// The use of the agents on the current day.
const usage = ref<{ costUsd: number; tokens: number } | null>(null);

onMounted(() => {
  if (props.hub.state.checks === null) void props.hub.checkMachine();
  loadRecipes();
  void studioUsage().then((today) => (usage.value = today));
});
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6" data-testid="hub-agents">
    <section class="flex gap-3 rounded-card border border-border-subtle bg-surface-raised p-4">
      <Bot class="size-icon-lg shrink-0" aria-hidden="true" />
      <div class="flex flex-col gap-1">
        <h2 class="text-subtitle">{{ $t("hub-agents-claude") }}</h2>
        <p class="text-text-secondary">{{ $t("hub-agents-claude-body") }}</p>
        <p v-if="claude !== null" class="text-caption" :data-state="claude.state" data-testid="agents-claude">
          {{ $t(`hub-doctor-${claude.state}`) }} · {{ claude.detail }}
        </p>
      </div>
    </section>
    <section class="flex gap-3 rounded-card border border-border-subtle bg-surface-raised p-4">
      <Cable class="size-icon-lg shrink-0" aria-hidden="true" />
      <div class="flex flex-col gap-1">
        <h2 class="text-subtitle">{{ $t("hub-agents-external") }}</h2>
        <p class="text-text-secondary">{{ $t("hub-agents-external-body") }}</p>
        <ul class="flex flex-col gap-2" data-testid="agents-setups">
          <li v-for="setup in SETUPS" :key="setup.id" class="flex flex-col gap-1" :data-setup="setup.id">
            <span class="text-label">{{ $t(`hub-agents-setup-${setup.id}`) }}</span>
            <span class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-control bg-surface-sunken px-2 py-1" translate="no">{{
                setup.text
              }}</code>
              <button
                type="button"
                class="rounded-control px-2 py-1 hover:bg-surface-sunken"
                :data-testid="`agents-copy-${setup.id}`"
                @click="copySetup(setup.id, setup.text)"
              >
                {{ copied === setup.id ? $t("hub-agents-copied") : $t("hub-agents-copy") }}
              </button>
            </span>
          </li>
        </ul>
        <!-- The connection requests, the clients and the MCP server over HTTP. -->
        <ExternalClients :hub="hub" />
      </div>
    </section>
    <section v-if="agent !== null" class="flex flex-col gap-3">
      <h2 class="text-subtitle">{{ $t("hub-agents-defaults") }}</h2>
      <fieldset class="flex flex-col gap-2">
        <legend class="pb-1 text-label">{{ $t("hub-agents-mode") }}</legend>
        <RadioGroup
          :model-value="agent.mode"
          :options="modes()"
          @update:model-value="save({ mode: $event as AgentMode })"
        />
      </fieldset>
      <label for="agents-budget" class="flex items-center gap-3 text-label">
        {{ $t("hub-agents-budget") }}
        <input
          id="agents-budget"
          type="number"
          min="0"
          step="0.5"
          :value="agent.budgetUsd"
          class="min-h-10 w-28 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
          @change="save({ budgetUsd: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
        />
      </label>
      <fieldset class="flex flex-col gap-2" data-testid="agents-kinds">
        <legend class="pb-1 text-label">{{ $t("hub-agents-kinds") }}</legend>
        <p class="text-caption text-text-secondary">{{ $t("hub-agents-kinds-body") }}</p>
        <div v-for="kind in KINDS" :key="kind" class="flex items-center gap-3">
          <span class="w-40 text-label">{{ $t(`hub-agents-kind-name-${kind}`) }}</span>
          <Select
            :model-value="agent.kinds?.[kind] ?? 'default'"
            :options="kindOptions()"
            class="w-40"
            :aria-label="$t(`hub-agents-kind-name-${kind}`)"
            :data-testid="`agents-kind-${kind}`"
            @update:model-value="saveKind(kind, $event)"
          />
        </div>
      </fieldset>
      <!-- The recipes, the recipes of the person and a run in a project. -->
      <RecipesSection
        v-if="recipes.length > 0"
        :recipes="recipes"
        :projects="hub.state.studio?.projects ?? []"
        :open="openProject"
        @changed="loadRecipes"
      />
      <p v-if="usage !== null" class="text-label" data-testid="agents-usage">
        {{ $t("hub-agents-usage", { cost: usage.costUsd.toFixed(2), tokens: usage.tokens }) }}
      </p>
      <p class="text-caption text-text-secondary">{{ $t("hub-agents-none") }}</p>
    </section>
  </div>
</template>
