<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The new project wizard of the Hub: a template, a name, a place, the Git option and the packages (the links of the
 * checkout or the published packages) on one page. "Make" runs `scenity create` as a job with its log. A failed job
 * shows the log and Retry. At the end, the editor opens the new project. The templates of the person and of the
 * plugins come after the built-in templates (their title and description are data).
 *
 * With agents, "Describe what you want to make" starts from a prompt. The agent chooses the template and the name
 * (`/api/agent/choose-template`), and the steps make the project. Then the editor window opens with the words of the
 * person (`prompt` of the URL). The words go to a new session in review mode: the first scene waits as a change set.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog, RadioGroup, Switch } from "@scenity/ui";
import { Box, LoaderCircle } from "lucide-vue-next";
import FolderDialog from "./FolderDialog.vue";
import { makeNewProject, PROJECT_NAME } from "./makeProject";
import { agentsAvailable, chooseTemplate, type DataTemplate } from "./studioApi";
import { HUB_TEMPLATES } from "./templates";
import type { Hub } from "./useHub";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ hub: Hub; template: string }>();
const { $t } = useI18n();
const hub = props.hub;
const template = ref(props.template);
const name = ref("my-scene");
const parent = ref("");
const git = ref(true);
const packages = ref<"linked" | "npm">("linked");
const phase = ref<"form" | "choosing" | "making" | "failed">("form");
/** The words of "Start from a prompt", and true when the studio has agents. */
const words = ref("");
const agents = ref(false);
const jobs = ref<string[]>([]);
const choosing = ref(false);

const studio = computed(() => hub.state.studio);
const valid = computed(() => PROJECT_NAME.test(name.value) && parent.value !== "");
const log = computed(() => jobs.value.map((id) => hub.state.logs[id] ?? "").join(""));
/** A sample links the packages of the checkout; only a studio in a checkout can link. */
const linkOnly = computed(() => template.value.startsWith("sample:"));
const packageOptions = () =>
  (["linked", "npm"] as const).map((value) => ({
    value,
    label: $t(`hub-wizard-packages-${value}`),
    disabled: value === "npm" && linkOnly.value,
  }));
const data = ref<readonly DataTemplate[]>([]);
/** The tiles of the wizard: the built-in templates (Fluent texts), then the templates of the person and the plugins. */
const templates = computed(() => [
  ...HUB_TEMPLATES.map((item) => ({
    id: item.id,
    title: $t(`hub-template-${item.text}`),
    about: $t(`hub-template-${item.text}-about`),
    picture: item.picture,
    usable: !item.checkoutOnly || studio.value?.checkout === true,
    data: false,
  })),
  ...data.value.map((item) => ({
    id: item.id,
    title: item.title,
    about: item.description,
    picture: item.picture ? `/api/templates/picture?id=${encodeURIComponent(item.id)}` : null,
    usable: true,
    data: true,
  })),
]);

watch(open, (now) => {
  if (!now) return;
  template.value = props.template;
  phase.value = "form";
  jobs.value = [];
  if (parent.value === "") parent.value = studio.value?.roots[0] ?? "";
  void agentsAvailable().then((available) => (agents.value = available));
  void hub.api.templates().then(
    (list) => (data.value = list),
    () => (data.value = []),
  );
});

/** The URL of the editor window with the words of the person. */
const withPrompt = (url: string, prompt: string): string =>
  `${url}${url.includes("?") ? "&" : "?"}prompt=${encodeURIComponent(prompt)}`;

/** The agent chooses the template and the name for the words. Then the steps make the project. */
async function startFromWords(): Promise<void> {
  const prompt = words.value.trim();
  if (prompt === "" || parent.value === "") return;
  phase.value = "choosing";
  try {
    const offered = templates.value.filter((item) => item.usable).map(({ id, title, about }) => ({ id, title, about }));
    const choice = await chooseTemplate(prompt, offered);
    template.value = choice.template;
    name.value = choice.name;
  } catch (error) {
    hub.raw.logs.wizard = error instanceof Error ? error.message : String(error);
    jobs.value = ["wizard"];
    phase.value = "failed";
    return;
  }
  await make(prompt);
}

/** The title of the template of the form. */
const chosen = computed(() => templates.value.find((item) => item.id === template.value)?.title ?? template.value);

async function make(prompt?: string): Promise<void> {
  if (!valid.value) return;
  phase.value = "making";
  jobs.value = [];
  try {
    const result = await makeNewProject(
      { api: hub.api, finished: hub.finished, started: (job) => jobs.value.push(job.id) },
      {
        name: name.value,
        template: template.value,
        parent: parent.value,
        git: git.value,
        packages: studio.value?.checkout === true && (linkOnly.value || packages.value === "linked") ? "linked" : "npm",
      },
    );
    if (result.kind === "failed") phase.value = "failed";
    else location.assign(prompt === undefined ? result.url : withPrompt(result.url, prompt));
  } catch (error) {
    hub.raw.logs.wizard = error instanceof Error ? error.message : String(error);
    jobs.value.push("wizard");
    phase.value = "failed";
  }
}
</script>

<template>
  <Dialog v-model:open="open" :title="$t('hub-wizard-title')" :dismissible="phase !== 'making'" class="max-w-4xl">
    <form v-if="phase === 'form'" class="flex flex-col gap-4" data-testid="new-project" @submit.prevent="make()">
      <section v-if="agents" class="flex flex-col gap-2" data-testid="wizard-prompt">
        <label for="wizard-words" class="flex flex-col gap-1 text-label">
          {{ $t("hub-wizard-prompt") }}
          <textarea
            id="wizard-words"
            v-model="words"
            rows="2"
            :placeholder="$t('hub-wizard-prompt-example')"
            class="rounded-control border border-border-strong bg-surface-raised px-3 py-2 text-body"
            data-testid="wizard-words"
          />
        </label>
        <div class="flex items-center gap-2">
          <Button
            variant="primary"
            :disabled="words.trim() === '' || parent === ''"
            data-testid="wizard-start"
            @click="startFromWords"
          >
            {{ $t("hub-wizard-prompt-start") }}
          </Button>
          <span class="text-caption text-text-secondary">{{ $t("hub-wizard-prompt-about") }}</span>
        </div>
      </section>
      <fieldset class="flex flex-col gap-2">
        <legend class="pb-2 text-label">{{ $t("hub-wizard-templates") }}</legend>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
          <button
            v-for="item in templates"
            :key="item.id"
            type="button"
            :aria-pressed="template === item.id"
            :disabled="!item.usable"
            :data-template="item.id"
            class="flex flex-col overflow-hidden rounded-card border border-border-subtle bg-surface-raised text-left disabled:opacity-50 aria-pressed:border-accent-brand aria-pressed:ring-2 aria-pressed:ring-accent-brand"
            @click="template = item.id"
          >
            <span class="grid aspect-video w-full place-items-center bg-surface-sunken">
              <img v-if="item.picture !== null" :src="item.picture" alt="" class="size-full object-cover" />
              <Box v-else class="size-icon-lg text-text-secondary" aria-hidden="true" />
            </span>
            <span class="flex flex-col gap-1 p-2">
              <span class="font-semibold" :translate="item.data ? 'no' : undefined">{{ item.title }}</span>
              <span class="text-caption text-text-secondary" :translate="item.data ? 'no' : undefined">{{
                item.about
              }}</span>
              <span v-if="!item.usable" class="text-caption text-status-caution">{{
                $t("hub-wizard-checkout-only")
              }}</span>
            </span>
          </button>
        </div>
      </fieldset>
      <label for="wizard-name" class="flex flex-col gap-1 text-label">
        {{ $t("hub-wizard-name") }}
        <input
          id="wizard-name"
          v-model="name"
          :aria-invalid="!PROJECT_NAME.test(name) || undefined"
          aria-describedby="wizard-name-rule"
          class="min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
          data-testid="wizard-name"
        />
        <span
          id="wizard-name-rule"
          :class="PROJECT_NAME.test(name) ? 'text-text-secondary' : 'text-status-negative'"
          class="text-caption"
        >
          {{ $t("hub-wizard-name-invalid") }}
        </span>
      </label>
      <div class="flex flex-col gap-1 text-label">
        {{ $t("hub-wizard-place") }}
        <div class="flex items-center gap-2">
          <code
            class="min-w-0 flex-1 truncate rounded-control bg-surface-sunken px-3 py-2 text-caption"
            translate="no"
            data-testid="wizard-place"
          >
            {{ parent }}/{{ name }}
          </code>
          <Button @click="choosing = true">{{ $t("hub-wizard-choose") }}</Button>
        </div>
      </div>
      <div class="flex items-center gap-2 text-label">
        <Switch v-model="git" aria-labelledby="wizard-git" />
        <span id="wizard-git">{{ $t("hub-wizard-git") }}</span>
      </div>
      <fieldset v-if="studio?.checkout" class="flex flex-col gap-1">
        <legend class="pb-1 text-label">{{ $t("hub-wizard-packages") }}</legend>
        <RadioGroup v-model="packages" :options="packageOptions()" orientation="horizontal" />
        <p v-if="linkOnly" class="text-caption text-text-secondary">{{ $t("hub-wizard-packages-sample") }}</p>
      </fieldset>
      <div class="flex justify-end gap-2">
        <Button @click="open = false">{{ $t("hub-cancel") }}</Button>
        <Button variant="primary" type="submit" :disabled="!valid" data-testid="wizard-make">{{
          $t("hub-wizard-make")
        }}</Button>
      </div>
    </form>
    <div v-else class="flex flex-col gap-3" data-testid="wizard-progress">
      <p v-if="phase === 'choosing'" role="status" class="flex items-center gap-2" data-testid="wizard-choosing">
        <LoaderCircle class="size-icon-sm animate-spin motion-reduce:animate-none" aria-hidden="true" />{{
          $t("hub-wizard-choosing")
        }}
      </p>
      <p v-else-if="phase === 'making'" role="status" class="flex items-center gap-2">
        <LoaderCircle class="size-icon-sm animate-spin motion-reduce:animate-none" aria-hidden="true" />{{
          $t("hub-wizard-making")
        }}
      </p>
      <p v-else role="alert" class="text-status-negative">{{ $t("hub-wizard-failed") }}</p>
      <p v-if="phase === 'making' && words.trim() !== ''" class="text-caption" data-testid="wizard-chosen">
        {{ $t("hub-wizard-prompt-chosen", { template: chosen, name }) }}
      </p>
      <details :open="phase === 'failed'">
        <summary class="text-label">{{ $t("hub-wizard-log") }}</summary>
        <pre
          class="max-h-64 overflow-auto rounded-control bg-surface-sunken p-3 text-caption"
          data-testid="wizard-log"
          >{{ log }}</pre>
      </details>
      <div v-if="phase === 'failed'" class="flex justify-end gap-2">
        <Button @click="phase = 'form'">{{ $t("hub-first-back") }}</Button>
        <Button variant="primary" @click="make()">{{ $t("hub-wizard-retry") }}</Button>
      </div>
    </div>
    <FolderDialog
      v-model:open="choosing"
      :hub="hub"
      mode="choose"
      :start="parent || undefined"
      @chosen="(dir) => (parent = dir)"
    />
  </Dialog>
</template>
