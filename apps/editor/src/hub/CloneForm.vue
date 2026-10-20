<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * "Clone from Git" of the open dialog of the Hub: a `git.clone` job into a new folder of the folder that the dialog
 * shows. The host accepts only HTTPS, SSH and file URLs. At the end, the dialog shows the new folder. Then the person
 * opens it, or makes it a project.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { LoaderCircle } from "lucide-vue-next";
import { childPath } from "./makeProject";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub; parent: string }>();
const emit = defineEmits<{ cloned: [dir: string] }>();
const { $t } = useI18n();
const url = ref("");
const folder = ref("");
const state = ref<"" | "running" | "failed">("");
const job = ref("");

/** The folder name of a repository URL: its last part with no `.git`. */
const repoName = (address: string): string =>
  (
    address
      .trim()
      .split(/[/:]/)
      .filter((part) => part !== "")
      .at(-1) ?? ""
  ).replace(/\.git$/, "");
const name = computed(() => (folder.value.trim() === "" ? repoName(url.value) : folder.value.trim()));

async function clone(): Promise<void> {
  if (url.value.trim() === "" || name.value === "") return;
  state.value = "running";
  const started = await props.hub.attempt(() =>
    props.hub.api.startJob({
      command: "git.clone",
      args: { url: url.value.trim(), folder: name.value },
      cwd: props.parent,
    }),
  );
  if (started === undefined) {
    state.value = "";
    return;
  }
  job.value = started.id;
  const end = await props.hub.finished(started.id);
  if (end.state !== "done") {
    state.value = "failed";
    return;
  }
  state.value = "";
  emit("cloned", childPath(props.parent, name.value));
}
</script>

<template>
  <form
    class="flex flex-col gap-2 rounded-control border border-border-subtle p-3"
    data-testid="clone-form"
    @submit.prevent="clone"
  >
    <div class="flex flex-wrap gap-2">
      <input
        v-model="url"
        :aria-label="$t('hub-clone-url')"
        :placeholder="$t('hub-clone-url')"
        class="min-h-10 min-w-64 flex-[2] rounded-control border border-border-strong bg-surface-raised px-3 text-body"
        data-testid="clone-url"
      />
      <input
        v-model="folder"
        :aria-label="$t('hub-clone-folder')"
        :placeholder="repoName(url) || $t('hub-clone-folder')"
        class="min-h-10 min-w-32 flex-1 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
      />
      <Button type="submit" :disabled="state === 'running' || name === ''" data-testid="clone-start">
        <LoaderCircle
          v-if="state === 'running'"
          class="size-icon-sm animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {{ $t(state === "running" ? "hub-clone-running" : "hub-clone-start") }}
      </Button>
    </div>
    <template v-if="state === 'failed'">
      <p role="alert" class="text-status-negative">{{ $t("hub-clone-failed") }}</p>
      <pre class="max-h-40 overflow-auto rounded-control bg-surface-sunken p-2 text-caption">{{
        props.hub.state.logs[job] ?? ""
      }}</pre>
    </template>
  </form>
</template>
