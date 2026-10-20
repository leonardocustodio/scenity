<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Hub of Scenity Studio: the side navigation (Projects, Learn, Agents, Settings), the actions New project and
 * Open, the section, and the first run. It needs no project.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { BookOpen, Bot, FolderOpen, FolderTree, Plus, Settings, X } from "lucide-vue-next";
import AgentsView from "./AgentsView.vue";
import FirstRun from "./FirstRun.vue";
import FolderDialog from "./FolderDialog.vue";
import LearnView from "./LearnView.vue";
import NewProjectDialog from "./NewProjectDialog.vue";
import ProjectList from "./ProjectList.vue";
import SettingsView from "./SettingsView.vue";
import type { Hub, HubSection } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const hub = props.hub;
const creating = ref(false);
const opening = ref(false);
const template = ref("empty");

const sections: { id: HubSection; icon: typeof Plus }[] = [
  { id: "projects", icon: FolderTree },
  { id: "learn", icon: BookOpen },
  { id: "agents", icon: Bot },
  { id: "settings", icon: Settings },
];
const studio = computed(() => hub.state.studio);
const firstRun = computed(() => studio.value !== null && !studio.value.preferences.firstRunDone);
/** The state of the built-in agent (the Claude check of the doctor) for the foot of the navigation. */
const agentState = computed(() => hub.state.checks?.find((check) => check.id === "claude")?.state ?? "checking");

function newProject(from = "empty"): void {
  template.value = from;
  creating.value = true;
}

/** Open a project in the editor. The result is the address of its window, or null. */
async function openInEditor(dir: string): Promise<string | null> {
  const opened = await hub.attempt(() => hub.api.openProject(dir));
  return opened?.url ?? null;
}

async function openFolder(dir: string, make: boolean): Promise<void> {
  const opened = await hub.attempt(() => (make ? hub.api.makeProject(dir) : hub.api.openProject(dir)));
  if (opened !== undefined) location.assign(opened.url);
}

onMounted(() => void hub.checkMachine());
onBeforeUnmount(() => hub.stop());
</script>

<template>
  <div class="flex h-dvh overflow-hidden bg-surface-base text-text-primary" data-testid="hub">
    <nav
      :aria-label="$t('hub-nav-label')"
      class="flex w-56 shrink-0 flex-col gap-1 border-r border-border-subtle bg-surface-sunken p-3"
    >
      <p class="px-2 pb-3 text-title font-semibold">{{ $t("hub-title") }}</p>
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        :aria-current="hub.state.section === section.id ? 'page' : undefined"
        :data-testid="`hub-nav-${section.id}`"
        class="flex min-h-10 items-center gap-2 rounded-control px-2 text-left text-label hover:bg-surface-overlay aria-[current=page]:bg-surface-raised aria-[current=page]:font-semibold"
        @click="hub.show(section.id)"
      >
        <component :is="section.icon" class="size-icon-sm" aria-hidden="true" />
        {{ $t(`hub-nav-${section.id}`) }}
      </button>
      <div class="mt-auto flex flex-col gap-2">
        <p v-if="studio?.safe" class="rounded-control bg-status-caution-subtle p-2 text-caption" role="status">
          {{ $t("hub-safe") }}
        </p>
        <!-- The role of a session that is not the owner, with the actions that it cannot do. -->
        <p
          v-if="studio?.role === 'viewer' || studio?.role === 'editor'"
          class="rounded-control bg-surface-raised p-2 text-caption"
          role="status"
          data-testid="hub-role"
        >
          {{ $t(`hub-role-${studio.role}`) }}
        </p>
        <button
          type="button"
          class="flex min-h-10 items-center gap-2 rounded-control px-2 text-left text-caption text-text-secondary hover:bg-surface-overlay"
          :data-state="agentState"
          data-testid="hub-agent-state"
          @click="hub.show('agents')"
        >
          <Bot class="size-icon-sm shrink-0" aria-hidden="true" />{{ $t(`hub-agent-state-${agentState}`) }}
        </button>
      </div>
    </nav>
    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex flex-wrap items-center gap-2 border-b border-border-subtle px-6 py-4">
        <h1 class="mr-auto text-title">{{ $t(`hub-nav-${hub.state.section}`) }}</h1>
        <Button variant="secondary" data-testid="hub-open" @click="opening = true">
          <FolderOpen class="size-icon-sm" aria-hidden="true" />{{ $t("hub-open") }}
        </Button>
        <Button variant="primary" data-testid="hub-new-project" @click="newProject()">
          <Plus class="size-icon-sm" aria-hidden="true" />{{ $t("hub-new-project") }}
        </Button>
      </header>
      <p v-if="hub.state.error !== ''" role="alert" class="m-6 rounded-control bg-status-negative-subtle p-3">
        {{ $t("hub-state-error", { error: hub.state.error }) }}
      </p>
      <div
        v-if="hub.state.notice !== ''"
        role="alert"
        class="mx-6 mt-4 flex items-center gap-2 rounded-control bg-status-negative-subtle p-3"
        data-testid="hub-notice"
      >
        <span class="flex-1">{{ $t("hub-error", { error: hub.state.notice }) }}</span>
        <Button size="icon" variant="ghost" :aria-label="$t('hub-close')" @click="hub.raw.notice = ''">
          <X class="size-icon-sm" aria-hidden="true" />
        </Button>
      </div>
      <section class="min-h-0 flex-1 overflow-auto p-6">
        <ProjectList
          v-if="hub.state.section === 'projects'"
          :hub="hub"
          @new-project="newProject()"
          @open="opening = true"
        />
        <LearnView
          v-else-if="hub.state.section === 'learn'"
          :projects="hub.state.studio?.projects ?? []"
          :open="openInEditor"
          @copy="newProject"
        />
        <AgentsView v-else-if="hub.state.section === 'agents'" :hub="hub" />
        <SettingsView v-else :hub="hub" />
      </section>
    </main>
    <NewProjectDialog v-model:open="creating" :hub="hub" :template="template" />
    <FolderDialog v-model:open="opening" :hub="hub" mode="open" @chosen="openFolder" />
    <FirstRun v-if="firstRun" :hub="hub" />
  </div>
</template>
