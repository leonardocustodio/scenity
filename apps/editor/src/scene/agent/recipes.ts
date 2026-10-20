// SPDX-License-Identifier: Apache-2.0
/**
 * The recipes in the editor window. Each recipe of the studio host is a command `recipe.<id>` (`recipeCommandId`). The
 * search box finds it, the Agent ▸ Recipes menu has it, and `/` in the composer lists it. A run asks for each
 * parameter (its default is in the field) and fills the prompt. Then it sends the prompt with the chips of the
 * composer to the active agent session, or to a new session with the name of the recipe. A recipe of the studio host
 * shows its title and the labels of its parameters in the language of the window (`localRecipe`). The prompt stays in
 * English, for the agent.
 */
import type { WindowNotices } from "../../studio/shell/dialogs";
import { t } from "../../texts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import type { RecipeInfo } from "./agentClient";
import type { AgentChip } from "./agentContext";
import { shallowReactive } from "vue";

/** The Fluent messages of the title and of the parameter labels of each recipe of the studio (source `studio`). */
const STUDIO_RECIPE_TEXTS: Readonly<Record<string, { title: string; params: Readonly<Record<string, string>> }>> = {
  "product-light": {
    title: "recipe-product-light",
    params: { subject: "recipe-product-light-subject", mood: "recipe-product-light-mood" },
  },
  "tidy-names": { title: "recipe-tidy-names", params: {} },
};

/** A recipe with the texts of the language of the window: a recipe of the studio takes its Fluent texts. */
export function localRecipe(recipe: RecipeInfo): RecipeInfo {
  const texts = recipe.source === "studio" ? STUDIO_RECIPE_TEXTS[recipe.id] : undefined;
  if (texts === undefined) return recipe;
  const params = recipe.params.map((param) => {
    const label = texts.params[param.name];
    return label === undefined ? param : { ...param, label: t(label) };
  });
  return { ...recipe, title: t(texts.title), params };
}

/** The prompt of a recipe with its parameters (a missing value takes the default). */
export function fillRecipe(
  recipe: Pick<RecipeInfo, "prompt" | "params">,
  values: Readonly<Record<string, string>>,
): string {
  let text = recipe.prompt;
  for (const param of recipe.params)
    text = text.replaceAll(`{${param.name}}`, values[param.name] ?? param.default ?? "");
  return text;
}

/** Ask the person for each parameter of a recipe. Return null when the person cancels. */
export async function askParams(
  notices: Pick<WindowNotices, "ask">,
  recipe: RecipeInfo,
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const param of recipe.params) {
    const choices = param.choices === undefined ? "" : t("recipe-choices", { list: param.choices.join(", ") });
    const answer = await notices.ask({
      spec: "prompt.recipe",
      title: recipe.title,
      text: choices,
      input: { label: param.label, testId: "command-prompt-input", value: param.default ?? "" },
      actions: [
        { id: "go", label: t("command-prompt-go"), testId: "command-prompt-go", tone: "primary", needsText: true },
        { id: "cancel", label: t("command-prompt-cancel") },
      ],
      dismiss: "cancel",
    });
    if (answer?.action !== "go") return null;
    values[param.name] = answer.text;
  }
  return values;
}

/** The command ID of a recipe: `recipe.<id>` with the ID in camel case (a command ID has no hyphen). */
export function recipeCommandId(id: string): string {
  return `recipe.${id.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())}`;
}

/** The commands of the recipes. */
export function recipeCommands(
  recipes: readonly RecipeInfo[],
  run: (recipe: RecipeInfo) => unknown,
): PageKeyCommandSpec[] {
  return recipes.map((recipe) => ({
    id: recipeCommandId(recipe.id),
    title: recipe.title,
    description: recipe.prompt,
    category: "recipe",
    menu: "agent/recipes",
    run: () => run(recipe),
  }));
}

/** The recipe chips of `/` in the composer for a text. */
export function recipeChips(recipes: readonly RecipeInfo[], query: string): AgentChip[] {
  const words = query.toLowerCase();
  return recipes
    .filter((recipe) => recipe.title.toLowerCase().includes(words) || recipe.id.includes(words))
    .map((recipe) => ({ key: `recipe:${recipe.id}`, kind: "recipe", label: recipe.title, text: recipe.prompt }));
}

/** The recipes of the plugins (the `recipes` point of a studio face), after the recipes of the host. */
export const PLUGIN_RECIPES = shallowReactive<RecipeInfo[]>([]);

/** Add the recipes of a plugin. The returned function removes them. */
export function addPluginRecipes(recipes: readonly RecipeInfo[]): () => void {
  PLUGIN_RECIPES.push(...recipes);
  return () => {
    for (const recipe of recipes) {
      const at = PLUGIN_RECIPES.indexOf(recipe);
      if (at >= 0) PLUGIN_RECIPES.splice(at, 1);
    }
  };
}
