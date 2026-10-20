<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The folder dialog of the studio: the folders under the allowed roots of the host, with Up, the roots, a new folder
 * and the mark of the project folders. In the mode "open", it opens a project folder, makes a plain folder a project,
 * or clones a Git repository. In the mode "choose", it gives a folder (the place of a new project).
 */
import { ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog, Select } from "@scenity/ui";
import { ArrowUp, Box, Folder, FolderPlus, GitBranch } from "lucide-vue-next";
import CloneForm from "./CloneForm.vue";
import type { FolderListing } from "./studioApi";
import type { Hub } from "./useHub";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ hub: Hub; mode: "open" | "choose"; start?: string | undefined }>();
/** `make` is true when the person makes a plain folder a project. */
const emit = defineEmits<{ chosen: [dir: string, make: boolean] }>();
const { $t } = useI18n();
const listing = ref<FolderListing | null>(null);
const error = ref("");
const newFolder = ref<string | null>(null);
const cloning = ref(false);

async function go(path?: string): Promise<void> {
  try {
    listing.value = await props.hub.api.folders(path);
    error.value = "";
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

async function makeFolder(): Promise<void> {
  if (listing.value === null || newFolder.value === null || newFolder.value.trim() === "") return;
  try {
    const path = await props.hub.api.makeFolder(listing.value.path, newFolder.value.trim());
    newFolder.value = null;
    await go(path);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

/** The last part of a path, the label of a root. */
const baseName = (path: string): string =>
  path
    .split(/[\\/]/)
    .filter((part) => part !== "")
    .at(-1) ?? path;

function choose(make: boolean): void {
  if (listing.value === null) return;
  emit("chosen", listing.value.path, make);
  open.value = false;
}

watch(open, (now) => {
  if (now) void go(props.start);
});
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="$t(props.mode === 'open' ? 'hub-open-title' : 'hub-folder-title')"
    class="max-w-2xl"
  >
    <div v-if="listing !== null" class="flex flex-col gap-3" data-testid="folder-dialog">
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          :disabled="listing.parent === null"
          :aria-label="$t('hub-folder-up')"
          @click="go(listing.parent ?? undefined)"
        >
          <ArrowUp class="size-icon-sm" aria-hidden="true" />
        </Button>
        <Select
          v-if="listing.roots.length > 1"
          :model-value="listing.roots.find((root) => listing?.path.startsWith(root)) ?? ''"
          :options="listing.roots.map((root) => ({ value: root, label: baseName(root) }))"
          translate="no"
          :aria-label="$t('hub-folder-title')"
          class="w-40 shrink-0"
          @update:model-value="go"
        />
        <code
          class="min-w-0 flex-1 truncate text-caption"
          :title="listing.path"
          translate="no"
          data-testid="folder-path"
          >{{ listing.path }}</code
        >
        <Button size="sm" variant="ghost" @click="newFolder = ''">
          <FolderPlus class="size-icon-sm" aria-hidden="true" />{{ $t("hub-folder-new") }}
        </Button>
        <Button
          v-if="props.mode === 'open'"
          size="sm"
          variant="ghost"
          data-testid="clone-toggle"
          @click="cloning = !cloning"
        >
          <GitBranch class="size-icon-sm" aria-hidden="true" />{{ $t("hub-clone") }}
        </Button>
      </div>
      <CloneForm
        v-if="cloning"
        :hub="props.hub"
        :parent="listing.path"
        @cloned="
          (dir) => {
            cloning = false;
            void go(dir);
          }
        "
      />
      <form v-if="newFolder !== null" class="flex gap-2" @submit.prevent="makeFolder">
        <input
          v-model="newFolder"
          :aria-label="$t('hub-folder-new-name')"
          :placeholder="$t('hub-folder-new-name')"
          class="min-h-10 flex-1 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
        />
        <Button type="submit">{{ $t("hub-folder-make") }}</Button>
      </form>
      <ul
        class="flex max-h-80 flex-col overflow-auto rounded-control border border-border-subtle"
        :aria-label="$t('hub-folder-list', { path: listing.path })"
      >
        <li v-for="folder in listing.folders" :key="folder.path">
          <button
            type="button"
            class="flex min-h-9 w-full items-center gap-2 px-3 text-left hover:bg-surface-raised"
            :data-folder="folder.name"
            @click="go(folder.path)"
          >
            <component :is="folder.project ? Box : Folder" class="size-icon-sm shrink-0" aria-hidden="true" />
            <span class="truncate" translate="no">{{ folder.name }}</span>
            <span v-if="folder.project" class="ml-auto text-caption text-text-secondary">{{
              $t("hub-folder-project")
            }}</span>
          </button>
        </li>
        <li v-if="listing.folders.length === 0" class="p-3 text-text-secondary">{{ $t("hub-folder-empty") }}</li>
      </ul>
    </div>
    <p v-if="error !== ''" role="alert" class="text-status-negative">{{ $t("hub-error", { error }) }}</p>
    <template #footer>
      <Button @click="open = false">{{ $t("hub-cancel") }}</Button>
      <template v-if="props.mode === 'open'">
        <Button v-if="listing?.project" variant="primary" data-testid="folder-open-project" @click="choose(false)">
          {{ $t("hub-folder-open-project") }}
        </Button>
        <Button v-else :disabled="listing === null" data-testid="folder-make-project" @click="choose(true)">
          {{ $t("hub-folder-make-project") }}
        </Button>
      </template>
      <Button v-else variant="primary" :disabled="listing === null" data-testid="folder-choose" @click="choose(false)">
        {{ $t("hub-folder-choose") }}
      </Button>
    </template>
  </Dialog>
</template>
