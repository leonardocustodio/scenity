<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The workspace tabs of the title bar of the editor window: a tab for each workspace (the built-in ones and the ones
 * of the person). A press shows the workspace with its layout (the command `workspace.switch`).
 */
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { useI18n } from "@scenity/i18n";
import type { Dock } from "./dock";
import { runShellCommand, type ShellCommandSpec } from "./dockCommands";
import { workspaceLabel } from "./workspaceLabel";

const props = defineProps<{ dock: Dock; commands: readonly ShellCommandSpec[] }>();
const { $t } = useI18n();
const workspaces = props.dock.workspaces;
const entries = shallowRef(workspaces.list());
const active = ref(workspaces.active());
const stop = workspaces.listen(() => {
  entries.value = workspaces.list();
  active.value = workspaces.active();
});
onBeforeUnmount(stop);
</script>

<template>
  <div class="studio-workspaces" role="tablist" :aria-label="$t('workspace-label')" data-testid="workspaces">
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      role="tab"
      class="studio-workspace"
      :aria-selected="entry.id === active"
      :data-testid="`workspace-${entry.id}`"
      data-command="workspace.switch"
      :data-command-args="JSON.stringify({ workspace: entry.id })"
      @click="runShellCommand(props.commands, 'workspace.switch', { workspace: entry.id })"
    >
      {{ workspaceLabel(entry, $t) }}
    </button>
  </div>
</template>
