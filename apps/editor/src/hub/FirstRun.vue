<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The first run of the studio: three short steps (the look and the language, an agent, the check of this machine). The
 * person can skip each step. The end sets `firstRunDone`.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog, RadioGroup, Select } from "@scenity/ui";
import DoctorList from "./DoctorList.vue";
import { changeLanguage, languageOptions, THEMES } from "./look";
import type { Preferences } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const open = ref(true);
const step = ref(1);
const agent = ref("claude");
const TOTAL = 3;
const preferences = computed(() => props.hub.state.studio?.preferences ?? null);
const themes = () => THEMES.map((value) => ({ value, label: $t(`hub-theme-${value}`) }));
const agents = () =>
  (["claude", "key", "external", "none"] as const).map((value) => ({ value, label: $t(`hub-first-agent-${value}`) }));

/** End the first run. After the last step, the Hub shows the agents when the person chose one. A skip shows no view. */
async function finish(skipped: boolean): Promise<void> {
  await props.hub.savePreferences({ firstRunDone: true });
  if (!skipped && agent.value !== "none") props.hub.show("agents");
  open.value = false;
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="$t('hub-first-title')"
    :description="$t('hub-first-body')"
    :dismissible="false"
    class="max-w-2xl"
  >
    <div class="flex flex-col gap-4" data-testid="first-run" :data-step="step">
      <p class="text-caption text-text-secondary">{{ $t("hub-first-step", { n: step, total: TOTAL }) }}</p>
      <section v-if="step === 1 && preferences !== null" class="flex flex-col gap-2">
        <h3 class="text-subtitle">{{ $t("hub-first-look") }}</h3>
        <div class="flex flex-wrap gap-3">
          <Select
            :model-value="preferences.theme"
            :options="themes()"
            :aria-label="$t('hub-settings-theme')"
            class="w-48"
            @update:model-value="props.hub.savePreferences({ theme: $event as Preferences['theme'] })"
          />
          <Select
            :model-value="preferences.locale"
            :options="languageOptions()"
            :aria-label="$t('hub-settings-language')"
            translate="no"
            class="w-48"
            @update:model-value="changeLanguage(props.hub, $event)"
          />
        </div>
      </section>
      <section v-else-if="step === 2" class="flex flex-col gap-2">
        <h3 class="text-subtitle">{{ $t("hub-first-agent") }}</h3>
        <RadioGroup v-model="agent" :options="agents()" />
        <p class="text-caption text-text-secondary">{{ $t("hub-first-agent-later") }}</p>
      </section>
      <DoctorList v-else :hub="props.hub" />
    </div>
    <template #footer>
      <Button variant="ghost" data-testid="first-skip" @click="finish(true)">{{ $t("hub-first-skip") }}</Button>
      <Button v-if="step > 1" @click="step -= 1">{{ $t("hub-first-back") }}</Button>
      <Button v-if="step < TOTAL" variant="primary" data-testid="first-next" @click="step += 1">{{
        $t("hub-first-next")
      }}</Button>
      <Button v-else variant="primary" data-testid="first-done" @click="finish(false)">{{
        $t("hub-first-done")
      }}</Button>
    </template>
  </Dialog>
</template>
