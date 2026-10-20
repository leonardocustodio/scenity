<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The projects of the Hub: cards or a list with the picture, the name, the folder, the last open, the Git state and
 * the marks (pinned, restricted, newer format, folder not found). It also has the search, the sort and the actions of
 * each project. A remove only removes the project from the list. "Save as a template" keeps a copy of a project as a
 * template of the person.
 */
import { ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog, Menu, Select, type MenuEntry } from "@scenity/ui";
import { Box, FolderX, LayoutGrid, List, MoreHorizontal, Pin, ShieldAlert } from "lucide-vue-next";
import FolderDialog from "./FolderDialog.vue";
import SaveTemplateDialog from "./SaveTemplateDialog.vue";
import type { DataTemplate, ProjectInfo } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const emit = defineEmits<{ "new-project": []; open: [] }>();
const { $t } = useI18n();
const hub = props.hub;
const renaming = ref<ProjectInfo | null>(null);
const newName = ref("");
const locating = ref<ProjectInfo | null>(null);
const busy = ref("");
const templating = ref<ProjectInfo | null>(null);
const savedTemplate = ref<DataTemplate | null>(null);

const sorts = () => [
  { value: "recent", label: $t("hub-sort-recent") },
  { value: "name", label: $t("hub-sort-name") },
];
const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function menu(project: ProjectInfo): MenuEntry[] {
  // Only the owner trusts or removes a project (the role line of the Hub gives the reason).
  const owner = (hub.state.studio?.role ?? "admin") === "admin";
  return [
    { value: "open", label: $t("hub-project-open"), disabled: !project.exists || project.newer },
    { value: "window", label: $t("hub-project-open-window"), disabled: !project.exists || project.newer },
    { value: "reveal", label: $t("hub-project-reveal"), disabled: !project.exists },
    { value: "rename", label: $t("hub-project-rename"), disabled: !project.exists },
    { value: "pin", label: $t(project.pinned ? "hub-project-unpin" : "hub-project-pin") },
    { value: "trust", label: $t("hub-project-trust"), disabled: !owner || !project.runsCode || project.trusted },
    { value: "template", label: $t("hub-project-template"), disabled: !project.exists },
    { value: "remove", label: $t("hub-project-remove"), separated: true, disabled: !owner },
  ];
}

async function open(project: ProjectInfo, inWindow = false): Promise<void> {
  busy.value = project.key;
  const opened = await hub.attempt(() => hub.api.openProject(project.dir));
  busy.value = "";
  if (opened === undefined) return;
  if (inWindow) window.open(opened.url, "_blank");
  else location.assign(opened.url);
}

async function act(project: ProjectInfo, action: string): Promise<void> {
  if (action === "open" || action === "window") return open(project, action === "window");
  if (action === "template") {
    templating.value = project;
    return;
  }
  if (action === "rename") {
    renaming.value = project;
    newName.value = project.name;
    return;
  }
  await hub.attempt(async () => {
    if (action === "pin") await hub.api.pinProject(project.key, !project.pinned);
    else if (action === "reveal" || action === "trust" || action === "remove")
      await hub.api.projectAction(action, project.key);
  });
  await hub.load();
}

async function rename(): Promise<void> {
  const project = renaming.value;
  if (project === null || newName.value.trim() === "") return;
  renaming.value = null;
  await hub.attempt(() => hub.api.renameProject(project.key, newName.value.trim()));
  await hub.load();
}

/** A missing folder at a new place: open the new folder and remove the old entry from the list. */
async function located(dir: string): Promise<void> {
  const old = locating.value;
  locating.value = null;
  const opened = await hub.attempt(async () => {
    const answer = await hub.api.openProject(dir);
    if (old !== null) await hub.api.projectAction("remove", old.key);
    return answer;
  });
  if (opened !== undefined) location.assign(opened.url);
}

const picture = (project: ProjectInfo): string | null =>
  project.picture === null ? null : `/api/projects/${encodeURIComponent(project.key)}/picture`;
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="hub.raw.search"
        type="search"
        :aria-label="$t('hub-search')"
        :placeholder="$t('hub-search')"
        class="min-h-10 min-w-64 flex-1 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
        data-testid="hub-search"
      />
      <Select v-model="hub.raw.sort" :options="sorts()" :aria-label="$t('hub-sort')" class="w-44" />
      <div role="group" :aria-label="$t('hub-view')" class="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          :aria-label="$t('hub-view-cards')"
          :aria-pressed="hub.state.view === 'cards'"
          @click="hub.raw.view = 'cards'"
        >
          <LayoutGrid class="size-icon-sm" aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="$t('hub-view-list')"
          :aria-pressed="hub.state.view === 'list'"
          @click="hub.raw.view = 'list'"
        >
          <List class="size-icon-sm" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div
      v-if="hub.state.loaded && (hub.state.studio?.projects.length ?? 0) === 0"
      class="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-strong p-8"
      data-testid="hub-projects-empty"
    >
      <h2 class="text-subtitle">{{ $t("hub-projects-empty-title") }}</h2>
      <p class="text-text-secondary">{{ $t("hub-projects-empty-body") }}</p>
      <div class="flex gap-2">
        <Button variant="primary" @click="emit('new-project')">{{ $t("hub-new-project") }}</Button>
        <Button @click="emit('open')">{{ $t("hub-open") }}</Button>
      </div>
    </div>
    <p v-else-if="hub.projects.value.length === 0 && hub.state.loaded" class="text-text-secondary">
      {{ $t("hub-projects-none-found") }}
    </p>

    <ul
      :class="
        hub.state.view === 'cards'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4'
          : 'flex flex-col gap-1'
      "
      data-testid="hub-projects"
    >
      <li
        v-for="project in hub.projects.value"
        :key="project.key"
        :data-project="project.key"
        :class="[
          'flex rounded-card border border-border-subtle bg-surface-raised',
          hub.state.view === 'cards' ? 'flex-col overflow-hidden' : 'items-center gap-3 px-3 py-2',
        ]"
      >
        <button
          type="button"
          :disabled="!project.exists || project.newer || busy === project.key"
          :class="[
            hub.state.view === 'cards' ? 'flex flex-col text-left' : 'flex flex-1 items-center gap-3 text-left',
            'min-w-0 disabled:cursor-default',
          ]"
          @click="open(project)"
        >
          <div v-if="hub.state.view === 'cards'" class="grid aspect-video w-full place-items-center bg-surface-sunken">
            <img v-if="picture(project) !== null" :src="picture(project) ?? ''" alt="" class="size-full object-cover" />
            <Box v-else class="size-icon-lg text-text-secondary" aria-hidden="true" />
          </div>
          <div :class="hub.state.view === 'cards' ? 'flex flex-col gap-1 p-3' : 'flex min-w-0 flex-col'">
            <span class="flex items-center gap-1 font-semibold">
              <Pin v-if="project.pinned" class="size-icon-sm" :aria-label="$t('hub-project-pinned')" />
              <span translate="no">{{ project.name }}</span>
            </span>
            <span class="truncate text-caption text-text-secondary" translate="no">{{ project.dir }}</span>
            <span v-if="project.exists" class="text-caption text-text-secondary">
              {{ $t("hub-project-last", { when: when(project.lastOpened) }) }} ·
              {{ $t("hub-project-scenes", { count: project.scenes }) }}
              <template v-if="project.format !== null">
                · {{ $t("hub-project-format", { version: project.format.split("/").at(-1) ?? "" }) }}
              </template>
              <template v-if="project.git !== null">
                · {{ $t("hub-project-git", { branch: project.git.branch, changed: project.git.changed }) }}
              </template>
            </span>
          </div>
        </button>
        <div
          :class="
            hub.state.view === 'cards' ? 'flex flex-wrap items-center gap-2 px-3 pb-3' : 'flex items-center gap-2'
          "
        >
          <span
            v-if="!project.exists"
            class="flex items-center gap-1 text-caption text-status-negative"
            data-testid="hub-project-missing"
          >
            <FolderX class="size-icon-sm" aria-hidden="true" />{{ $t("hub-project-missing") }}
          </span>
          <Button v-if="!project.exists" size="sm" @click="locating = project">{{ $t("hub-project-locate") }}</Button>
          <span v-if="project.newer" class="text-caption text-status-caution">{{ $t("hub-project-newer") }}</span>
          <span
            v-if="project.runsCode && !project.trusted"
            class="flex items-center gap-1 text-caption text-text-secondary"
          >
            <ShieldAlert class="size-icon-sm" aria-hidden="true" />{{ $t("hub-project-restricted") }}
          </span>
          <Menu :items="menu(project)" @select="act(project, $event)">
            <template #trigger>
              <Button
                size="icon"
                variant="ghost"
                class="ml-auto"
                :aria-label="$t('hub-project-menu', { name: project.name })"
              >
                <MoreHorizontal class="size-icon-sm" aria-hidden="true" />
              </Button>
            </template>
          </Menu>
        </div>
      </li>
    </ul>

    <Dialog
      :open="renaming !== null"
      :title="$t('hub-rename-title')"
      @update:open="renaming = $event ? renaming : null"
    >
      <form class="flex flex-col gap-3" @submit.prevent="rename">
        <label for="hub-rename-name" class="flex flex-col gap-1 text-label">
          {{ $t("hub-rename-name") }}
          <input
            id="hub-rename-name"
            v-model="newName"
            class="min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
          />
        </label>
        <div class="flex justify-end gap-2">
          <Button @click="renaming = null">{{ $t("hub-cancel") }}</Button>
          <Button variant="primary" type="submit">{{ $t("hub-rename-save") }}</Button>
        </div>
      </form>
    </Dialog>
    <SaveTemplateDialog v-model:project="templating" :hub="hub" @saved="savedTemplate = $event" />
    <p v-if="savedTemplate !== null" role="status" class="text-caption" data-testid="hub-template-saved">
      {{ $t("hub-template-saved", { title: savedTemplate.title }) }}
    </p>
    <FolderDialog
      :open="locating !== null"
      :hub="hub"
      mode="open"
      @update:open="locating = $event ? locating : null"
      @chosen="located"
    />
  </div>
</template>
