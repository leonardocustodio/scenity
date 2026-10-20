<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The recipes of the agents in the Hub: the recipes of the studio and of the person. The person makes, changes and
 * removes their own recipes (a title and a prompt). Each `{name}` of the prompt is a field that the run asks for.
 * "Run in…" opens a project in the editor with the recipe. The editor asks for the fields and sends the prompt to its
 * agent.
 */
import { Button } from "@scenity/ui";
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { saveUserRecipes, type HubRecipe, type ProjectInfo, type UserRecipe } from "./studioApi";

const props = defineProps<{
  recipes: readonly HubRecipe[];
  projects: readonly ProjectInfo[];
  /** Open a project in the editor; the result is the address of its window. */
  open: (dir: string) => Promise<string | null>;
}>();
const emit = defineEmits<{ changed: [] }>();
const { $t } = useI18n();

const mine = computed(() => props.recipes.filter((recipe) => recipe.source === "user"));
/** The recipe of the form: its ID (null: a new recipe), its title and its prompt; null when the form is closed. */
const form = ref<{ id: string | null; title: string; prompt: string } | null>(null);
const error = ref<string | null>(null);
const project = ref("");
const field = "min-h-9 rounded-control border border-border-strong bg-surface-raised px-2 text-body";

/** The ID of a title: lower-case words with hyphens. */
const idOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([^a-z])/, "r-$1") || "recipe";

/** The fields of a prompt: each `{name}` once. */
function paramsOf(prompt: string): UserRecipe["params"] {
  const names = [...new Set(Array.from(prompt.matchAll(/\{([a-z][a-z0-9-]*)\}/g), (match) => match[1] ?? ""))];
  return names.map((name) => ({ name, label: name }));
}

const asUser = (recipe: HubRecipe): UserRecipe => ({
  format: "scenity.recipe/1",
  id: recipe.id,
  title: recipe.title,
  prompt: recipe.prompt,
  params: recipe.params ?? paramsOf(recipe.prompt),
});

async function save(list: readonly UserRecipe[]): Promise<void> {
  error.value = await saveUserRecipes(list);
  if (error.value === null) {
    form.value = null;
    emit("changed");
  }
}

function onSave(): void {
  const now = form.value;
  if (now === null || now.title.trim() === "" || now.prompt.trim() === "") return;
  const recipe: UserRecipe = {
    format: "scenity.recipe/1",
    id: now.id ?? idOf(now.title),
    title: now.title.trim(),
    prompt: now.prompt.trim(),
    params: paramsOf(now.prompt),
  };
  const others = mine.value.filter((each) => each.id !== recipe.id).map(asUser);
  void save([...others, recipe]);
}

function remove(id: string): void {
  void save(mine.value.filter((each) => each.id !== id).map(asUser));
}

async function run(recipe: HubRecipe): Promise<void> {
  const chosen = props.projects.find((each) => each.key === project.value) ?? props.projects[0];
  if (chosen === undefined) return;
  const url = await props.open(chosen.dir);
  if (url === null) return;
  const next = new URL(url, location.href);
  next.searchParams.set("recipe", recipe.id);
  location.assign(next);
}
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="agents-recipes">
    <h2 class="text-subtitle">{{ $t("hub-agents-recipes") }}</h2>
    <p class="text-caption text-text-secondary">{{ $t("hub-agents-recipes-body") }}</p>
    <label v-if="projects.length > 0" class="flex items-center gap-2" for="agents-recipe-project">
      <span class="text-label">{{ $t("hub-recipe-project") }}</span>
      <select id="agents-recipe-project" v-model="project" :class="field" data-testid="agents-recipe-project">
        <option v-for="each in projects" :key="each.key" :value="each.key" translate="no">{{ each.name }}</option>
      </select>
    </label>
    <ul class="flex flex-col gap-1">
      <li v-for="recipe in recipes" :key="recipe.id" class="flex items-center gap-2" data-testid="agents-recipe">
        <span class="min-w-0 flex-1">
          <!-- A recipe is a document: its title is in the language of the recipe. -->
          <strong translate="no">{{ recipe.title }}</strong>
          <span class="text-caption text-text-secondary"> · {{ $t(`hub-agents-recipe-${recipe.source}`) }}</span>
        </span>
        <Button
          v-if="projects.length > 0"
          size="sm"
          variant="secondary"
          :data-testid="`agents-recipe-run-${recipe.id}`"
          @click="run(recipe)"
        >
          {{ $t("hub-recipe-run") }}
        </Button>
        <template v-if="recipe.source === 'user'">
          <Button
            size="sm"
            variant="ghost"
            :data-testid="`agents-recipe-edit-${recipe.id}`"
            @click="form = { id: recipe.id, title: recipe.title, prompt: recipe.prompt }"
          >
            {{ $t("hub-recipe-edit") }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :data-testid="`agents-recipe-remove-${recipe.id}`"
            @click="remove(recipe.id)"
          >
            {{ $t("hub-recipe-remove") }}
          </Button>
        </template>
      </li>
    </ul>
    <Button
      v-if="form === null"
      size="sm"
      variant="secondary"
      class="self-start"
      data-testid="agents-recipe-new"
      @click="form = { id: null, title: '', prompt: '' }"
    >
      {{ $t("hub-recipe-new") }}
    </Button>
    <form v-else class="flex flex-col gap-2" data-testid="agents-recipe-form" @submit.prevent="onSave">
      <label class="flex flex-col gap-1" for="agents-recipe-title">
        <span class="text-label">{{ $t("hub-recipe-title") }}</span>
        <input id="agents-recipe-title" v-model="form.title" :class="field" data-testid="agents-recipe-title" />
      </label>
      <label class="flex flex-col gap-1" for="agents-recipe-prompt">
        <span class="text-label">{{ $t("hub-recipe-prompt") }}</span>
        <textarea
          id="agents-recipe-prompt"
          v-model="form.prompt"
          rows="3"
          :class="field"
          class="py-1"
          data-testid="agents-recipe-prompt"
        />
        <span class="text-caption text-text-secondary">{{ $t("hub-recipe-prompt-hint") }}</span>
      </label>
      <div class="flex gap-2">
        <Button type="submit" size="sm" data-testid="agents-recipe-save">{{ $t("hub-recipe-save") }}</Button>
        <Button type="button" size="sm" variant="ghost" @click="form = null">{{ $t("hub-cancel") }}</Button>
      </div>
    </form>
    <p v-if="error !== null" role="alert" class="text-status-negative">{{ error }}</p>
  </section>
</template>
