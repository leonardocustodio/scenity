// SPDX-License-Identifier: Apache-2.0
// Start from a prompt (src/agents/chooseTemplate.ts): the agent chooses the template and the name of a new project
// with one tool. A choice of a template that the Hub did not offer, or of a bad name, is a tool error. With no valid
// choice, the result is null.
import { describe, expect, test } from "bun:test";
import { chooseTemplate, chooseTemplateApi, type TemplateOffer } from "../src/agents/chooseTemplate";
import { scriptDriver } from "../src/agents/driver";

const TEMPLATES: readonly TemplateOffer[] = [
  { id: "empty", title: "Empty", about: "A floor, a box, two lights and a camera." },
  { id: "showroom", title: "Showroom", about: "Six furniture models, an HDR sky and three scenes." },
];

const signal = new AbortController().signal;

describe("the choice of a template", () => {
  test("gives the template and the name of the tool call of the agent", async () => {
    const driver = scriptDriver({
      turns: [[{ tool: "choose_template", input: { template: "showroom", name: "chair-shop" } }]],
    });
    expect(await chooseTemplate(driver, "a shop of chairs", TEMPLATES, signal)).toEqual({
      template: "showroom",
      name: "chair-shop",
    });
  });

  test("refuses a template that the Hub did not offer and a bad name", async () => {
    const driver = scriptDriver({
      turns: [
        [
          { tool: "choose_template", input: { template: "sample:spin", name: "spin" } },
          { tool: "choose_template", input: { template: "empty", name: "a bad name" } },
        ],
      ],
    });
    expect(await chooseTemplate(driver, "anything", TEMPLATES, signal)).toBeNull();
  });

  test("the route gives the choice, and 422 with no choice", async () => {
    const request = (body: unknown) =>
      new Request("http://127.0.0.1/api/agent/choose-template", { method: "POST", body: JSON.stringify(body) });
    const chosen = scriptDriver({ turns: [[{ tool: "choose_template", input: { template: "empty", name: "box" } }]] });
    const answer = await chooseTemplateApi(chosen, request({ prompt: "a box", templates: TEMPLATES }));
    expect(await answer.json()).toEqual({ template: "empty", name: "box" });
    const silent = scriptDriver({ turns: [[{ say: "I do not know." }]] });
    expect((await chooseTemplateApi(silent, request({ prompt: "a box", templates: TEMPLATES }))).status).toBe(422);
    expect((await chooseTemplateApi(silent, request({ prompt: "" }))).status).toBe(400);
  });
});
