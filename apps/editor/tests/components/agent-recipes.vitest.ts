// SPDX-License-Identifier: Apache-2.0
// The recipes in the editor window: a command for each recipe, `/` in the composer, and the fill of the parameters and
// their dialogs (a cancel runs nothing).
import { describe, expect, it } from "vitest";
import type { RecipeInfo } from "../../src/scene/agent/agentClient";
import { askParams, fillRecipe, recipeChips, recipeCommandId, recipeCommands } from "../../src/scene/agent/recipes";
import { WindowNotices } from "../../src/studio/shell/dialogs";

const LIGHT: RecipeInfo = {
  id: "product-light",
  title: "Light for a product shot",
  prompt: "Light {subject} with a {mood} key light.",
  params: [
    { name: "subject", label: "Subject", default: "the selection" },
    { name: "mood", label: "Mood", default: "warm", choices: ["warm", "cool"] },
  ],
  source: "studio",
};

describe("the recipes", () => {
  it("are commands and chips of / in the composer", () => {
    expect(recipeCommandId("product-light")).toBe("recipe.productLight");
    const [command] = recipeCommands([LIGHT], () => undefined);
    expect(command).toMatchObject({
      id: "recipe.productLight",
      title: "Light for a product shot",
      menu: "agent/recipes",
    });
    expect(recipeChips([LIGHT], "light").map((chip) => chip.key)).toEqual(["recipe:product-light"]);
    expect(recipeChips([LIGHT], "chairs")).toEqual([]);
    expect(fillRecipe(LIGHT, { mood: "cool" })).toBe("Light the selection with a cool key light.");
  });

  it("asks each parameter with its default; a cancel gives null", async () => {
    const notices = new WindowNotices();
    const asked = askParams(notices, LIGHT);
    await Promise.resolve();
    expect(notices.state.dialog?.request.input?.value).toBe("the selection");
    notices.answer("go", "the vase");
    await Promise.resolve();
    await Promise.resolve();
    expect(notices.state.dialog?.request.text).toBe("Choices: warm, cool");
    notices.answer("go", "cool");
    expect(await asked).toEqual({ subject: "the vase", mood: "cool" });
    const cancelled = askParams(notices, LIGHT);
    await Promise.resolve();
    notices.answer("cancel");
    expect(await cancelled).toBeNull();
  });
});
