// SPDX-License-Identifier: Apache-2.0
// The recipes of the agents: the recipes of the studio, of the person and of the project, and the fill of the
// parameters. A later recipe with the same ID wins, and the list does not include a bad file.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillRecipe, readRecipes, STUDIO_RECIPES, writeUserRecipes } from "../src/agents/recipes";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-recipes-"));
  dirs.push(dir);
  return dir;
}

const recipe = (id: string, title: string) => ({ format: "scenity.recipe/1", id, title, prompt: `Do ${title}.` });

describe("the recipes", () => {
  test("the studio, the person and the project give recipes; a later one with an ID wins", () => {
    const state = folder();
    const project = folder();
    writeFileSync(
      join(state, "recipes.json"),
      JSON.stringify([recipe("mine", "Mine"), recipe("tidy-names", "Tidy mine")]),
    );
    mkdirSync(join(project, ".scenity", "recipes"), { recursive: true });
    writeFileSync(join(project, ".scenity", "recipes", "chairs.json"), JSON.stringify(recipe("chairs", "Chairs")));
    writeFileSync(join(project, ".scenity", "recipes", "bad.json"), "{ not json");
    const list = readRecipes(state, project);
    expect(list.map((item) => [item.id, item.source])).toEqual([
      ["product-light", "studio"],
      ["tidy-names", "user"],
      ["mine", "user"],
      ["chairs", "project"],
    ]);
    expect(readRecipes(null, null)).toHaveLength(STUDIO_RECIPES.length);
  });

  test("a run fills the parameters and their defaults", () => {
    const light = STUDIO_RECIPES.find((item) => item.id === "product-light");
    if (light === undefined) throw new Error("no recipe");
    expect(fillRecipe(light, { mood: "cool" })).toBe(
      "Light the selection for a product shot: a cool key light, a soft fill light and a rim light. Keep the other lights as they are.",
    );
  });
});

describe("the recipes of the person", () => {
  test("writes the list of the person and refuses a recipe that is not valid or an ID twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "scenity-recipes-write-"));
    const recipe = {
      format: "scenity.recipe/1",
      id: "warm-lamp",
      title: "A warm lamp",
      prompt: "Make {what} warm",
      params: [],
    };
    expect(writeUserRecipes(dir, [recipe])).toBeNull();
    expect(readRecipes(dir, null).find((each) => each.id === "warm-lamp")?.source).toBe("user");
    expect(writeUserRecipes(dir, [{ ...recipe, id: "Bad ID" }])).toContain("not valid");
    expect(writeUserRecipes(dir, [recipe, recipe])).toContain("same ID");
    expect(writeUserRecipes(dir, "no list")).toContain("list");
    rmSync(dir, { recursive: true, force: true });
  });
});
