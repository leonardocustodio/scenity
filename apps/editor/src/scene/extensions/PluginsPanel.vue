<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Plugins window. It shows the plugins of the project with their faces, their version, the error of an entry that
 * does not resolve, and Remove. Add takes a plugin of the checkout, a package name or a folder path. The window also
 * shows the docs of the plugins. A change writes the project file (scripts/pluginsApi.ts); the window loads the plugins
 * after a reload, so a notice offers Reload.
 */
import { useI18n } from "@scenity/i18n";
import { onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { button, field, selectField } from "../inspector/inspectorUi";
import { DOCS_URL } from "../searchProviders";
import NewPluginForm from "./NewPluginForm.vue";
import { useRoleReason } from "../../studio/extensions/api";
import EmptyState from "../../studio/shell/EmptyState.vue";

interface PluginRow {
  readonly entry: string;
  readonly name: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly faces: readonly string[];
  readonly error: string | null;
}
interface Available {
  readonly entry: string;
  readonly name: string;
  readonly description: string | null;
}

const props = defineProps<{ base: string; reload?: () => void }>();
const { $t } = useI18n();
/** Only the owner changes the plugins of a project. For another role, the changes are disabled with the reason. */
const ownerReason = useRoleReason("owner");
const rows = shallowRef<readonly PluginRow[]>([]);
const available = shallowRef<readonly Available[]>([]);
const picked = ref("");
const typed = ref("");
const error = ref<string | null>(null);
const changed = ref(false);

async function load(): Promise<void> {
  const answer = await fetch(`${props.base}plugins.json`, { cache: "no-store" }).catch(() => null);
  if (answer?.ok !== true) return;
  const data = (await answer.json()) as { plugins: PluginRow[]; available: Available[] };
  rows.value = data.plugins;
  available.value = data.available;
  picked.value = data.available[0]?.entry ?? "";
}
onMounted(() => void load());
const reloadPage = (): void => (props.reload ?? (() => location.reload()))();

async function change(action: "add" | "remove", entry: string): Promise<void> {
  const answer = await fetch(`${props.base}plugins.${action}`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  const data = (await answer.json()) as { ok: boolean; reason?: string };
  error.value = data.ok ? null : (data.reason ?? null);
  if (data.ok) {
    changed.value = true;
    typed.value = "";
  }
  await load();
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-plugins')"
    data-testid="plugins"
  >
    <p v-if="changed" class="flex items-center gap-1 text-status-warning" role="status" data-testid="plugins-restart">
      {{ $t("plugins-restart") }}
      <button type="button" :class="button" data-testid="plugins-reload" @click="reloadPage">
        {{ $t("plugins-reload") }}
      </button>
    </p>
    <p v-if="error !== null" class="text-status-negative" role="alert" data-testid="plugins-error">{{ error }}</p>
    <EmptyState v-if="rows.length === 0" panel="plugins" :text="$t('plugins-none')" />
    <ul class="flex flex-col gap-1" :aria-label="$t('panel-plugins')">
      <li
        v-for="row in rows"
        :key="row.entry"
        class="flex flex-col gap-0.5 border-b border-border-subtle pb-1"
        :data-entry="row.entry"
        :data-testid="`plugin-${row.name ?? row.entry}`"
      >
        <div class="flex items-center gap-1">
          <span class="font-medium" translate="no">{{ row.name ?? row.entry }}</span>
          <span v-if="row.version !== null" class="text-text-secondary" translate="no">{{ row.version }}</span>
          <span v-for="face in row.faces" :key="face" class="rounded-control border border-border-subtle px-1">
            {{ $t(`plugins-face-${face}`) }}
          </span>
          <button
            type="button"
            :class="button"
            class="ml-auto"
            :disabled="ownerReason !== null"
            :title="ownerReason ?? undefined"
            data-testid="plugin-remove"
            @click="change('remove', row.entry)"
          >
            {{ $t("plugins-remove") }}
          </button>
        </div>
        <span class="text-text-secondary" translate="no">{{ row.entry }}</span>
        <span v-if="row.description !== null" class="text-text-secondary">{{ row.description }}</span>
        <span v-if="row.error !== null" class="text-status-negative" translate="no">{{ row.error }}</span>
      </li>
    </ul>
    <h3 class="mt-1 font-semibold">{{ $t("plugins-add") }}</h3>
    <p v-if="ownerReason !== null" class="text-text-secondary" data-testid="plugins-reason">{{ ownerReason }}</p>
    <fieldset
      class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
      :disabled="ownerReason !== null"
      :title="ownerReason ?? undefined"
    >
      <div v-if="available.length > 0" class="flex items-center gap-1">
        <select
          v-model="picked"
          :class="selectField"
          class="max-w-80"
          :aria-label="$t('plugins-checkout')"
          data-testid="plugins-available"
        >
          <option v-for="item in available" :key="item.entry" :value="item.entry" translate="no">
            {{ item.name }}
          </option>
        </select>
        <button
          type="button"
          :class="button"
          :disabled="picked === ''"
          data-testid="plugins-add-picked"
          @click="change('add', picked)"
        >
          {{ $t("plugins-add-button") }}
        </button>
      </div>
      <div class="flex items-center gap-1">
        <input
          v-model="typed"
          :class="field"
          class="max-w-80"
          :placeholder="$t('plugins-entry')"
          :aria-label="$t('plugins-entry')"
          data-testid="plugins-entry"
        />
        <button
          type="button"
          :class="button"
          :disabled="typed.trim() === ''"
          data-testid="plugins-add-entry"
          @click="change('add', typed.trim())"
        >
          {{ $t("plugins-add-button") }}
        </button>
      </div>
      <!-- The new plugin wizard. -->
      <NewPluginForm
        :base="base"
        @made="
          changed = true;
          void load();
        "
      />
    </fieldset>
    <a :href="`${DOCS_URL}plugins.md`" target="_blank" rel="noopener" class="self-start underline">{{
      $t("plugins-docs")
    }}</a>
  </section>
</template>
