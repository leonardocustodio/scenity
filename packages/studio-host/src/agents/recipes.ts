// SPDX-License-Identifier: Apache-2.0
/**
 * The recipes of the agents: saved prompts with parameters. A recipe comes from the studio (the recipes here), from
 * the person (`recipes.json` of the studio state folder) or from the project (one file per recipe in
 * `.scenity/recipes/`). A later recipe with the same ID wins. The editor makes a command of each recipe (the search
 * box, the Agent menu, `/` in the composer). A run asks for the parameters and sends the prompt with each `{name}`
 * filled.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const paramSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1).max(80),
  default: z.string().max(200).optional(),
  choices: z.array(z.string().min(1).max(80)).max(12).optional(),
});

export const recipeSchema = z.object({
  format: z.literal("scenity.recipe/1"),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  params: z.array(paramSchema).max(8).default([]),
});

/** A recipe with its source. */
export type Recipe = z.infer<typeof recipeSchema> & { readonly source: "studio" | "user" | "project" };

/** The recipes of the studio. */
export const STUDIO_RECIPES: readonly Recipe[] = [
  {
    format: "scenity.recipe/1",
    id: "product-light",
    title: "Light for a product shot",
    prompt:
      "Light {subject} for a product shot: a {mood} key light, a soft fill light and a rim light. Keep the other " +
      "lights as they are.",
    params: [
      { name: "subject", label: "Subject", default: "the selection" },
      { name: "mood", label: "Mood of the key light", default: "warm", choices: ["warm", "neutral", "cool"] },
    ],
    source: "studio",
  },
  {
    format: "scenity.recipe/1",
    id: "tidy-names",
    title: "Tidy the names of the entities",
    prompt: "Give each entity of the scene a short and clear name; change no other value.",
    params: [],
    source: "studio",
  },
];

/** The good recipes of a JSON value (a list, or one recipe), with their source. */
function recipesOf(value: unknown, source: Recipe["source"]): Recipe[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((item) => {
    const parsed = recipeSchema.safeParse(item);
    return parsed.success ? [{ ...parsed.data, source }] : [];
  });
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The recipes of the studio, of the person (`stateDir`) and of a project (`dir`). A later recipe with an ID wins. */
export function readRecipes(stateDir: string | null, dir: string | null): Recipe[] {
  const user = stateDir === null ? [] : recipesOf(readJson(join(stateDir, "recipes.json")) ?? [], "user");
  const folder = dir === null ? null : join(dir, ".scenity", "recipes");
  const project =
    folder === null || !existsSync(folder)
      ? []
      : readdirSync(folder)
          .filter((file) => file.endsWith(".json"))
          .sort()
          .flatMap((file) => recipesOf(readJson(join(folder, file)), "project"));
  const byId = new Map<string, Recipe>();
  for (const recipe of [...STUDIO_RECIPES, ...user, ...project]) byId.set(recipe.id, recipe);
  return [...byId.values()];
}

/**
 * Write the recipes of the person (`recipes.json` of the studio state folder). Each recipe must pass the
 * schema, and each ID is there one time. The result is the reason of a refusal, or null.
 */
export function writeUserRecipes(stateDir: string, list: unknown): string | null {
  if (!Array.isArray(list)) return "the recipes are a list";
  const recipes: unknown[] = [];
  for (const item of list) {
    const parsed = recipeSchema.safeParse(item);
    if (!parsed.success) return `a recipe is not valid: ${parsed.error.issues[0]?.message ?? "?"}`;
    recipes.push(parsed.data);
  }
  const ids = recipes.map((recipe) => (recipe as { id: string }).id);
  if (new Set(ids).size !== ids.length) return "two recipes have the same ID";
  writeFileSync(join(stateDir, "recipes.json"), `${JSON.stringify(recipes, null, 2)}\n`);
  return null;
}

/** The prompt of a recipe with its parameters (a missing value takes the default). */
export function fillRecipe(
  recipe: Pick<Recipe, "prompt" | "params">,
  values: Readonly<Record<string, string>>,
): string {
  let text = recipe.prompt;
  for (const param of recipe.params)
    text = text.replaceAll(`{${param.name}}`, values[param.name] ?? param.default ?? "");
  return text;
}
