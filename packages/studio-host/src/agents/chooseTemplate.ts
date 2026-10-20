// SPDX-License-Identifier: Apache-2.0
/**
 * Start from a prompt: the agent chooses the template and the name of a new project for the words of the person. The
 * host runs one turn of the driver with one tool, `choose_template`, outside each session (no transcript, no other
 * tool). The Hub then makes the project with the choice. The editor window sends the prompt to a new session in review
 * mode, so the first scene waits as a change set.
 */
import { z } from "zod";
import type { ToolListing, ToolResult } from "@scenity/agent-tools";
import type { AgentDriver } from "./driver";
import { newSessionInfo } from "./session";

/** A template that the Hub offers: its ID, its title and its description. */
export interface TemplateOffer {
  readonly id: string;
  readonly title: string;
  readonly about: string;
}

/** The choice of the agent. */
export interface TemplateChoice {
  readonly template: string;
  readonly name: string;
}

/** The rule of a project name of `scenity create`. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The tool of the choice. */
export const CHOOSE_TEMPLATE_TOOL = "choose_template";

const LISTING: ToolListing = {
  name: CHOOSE_TEMPLATE_TOOL,
  description:
    "Choose the template and the folder name of the new project. The name has 1 to 64 letters, digits, - and _.",
  inputSchema: {
    type: "object",
    properties: {
      template: { type: "string", description: "The ID of one of the templates of the prompt." },
      name: { type: "string", description: "The folder name of the project, for example robot-shop." },
    },
    required: ["template", "name"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({ template: z.string(), name: z.string() });

/** The prompt of the turn: the words of the person and the templates. */
function choicePrompt(prompt: string, templates: readonly TemplateOffer[]): string {
  const lines = templates.map((item) => `- ${item.id}: ${item.title}. ${item.about}`);
  return [
    "A person starts a new Scenity project with these words:",
    "",
    prompt,
    "",
    `Choose the template that fits the words best, and a short folder name. Call ${CHOOSE_TEMPLATE_TOOL} once.`,
    "",
    "The templates:",
    ...lines,
  ].join("\n");
}

const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

/**
 * `POST /api/agent/choose-template` with `{ prompt, templates: [{ id, title, about }] }`: the choice of the agent
 * (`{ template, name }`), or 422 when it made none.
 */
export async function chooseTemplateApi(driver: AgentDriver, request: Request): Promise<Response> {
  const body = z
    .object({
      prompt: z.string().min(1).max(4000),
      templates: z.array(z.object({ id: z.string(), title: z.string(), about: z.string() })).min(1),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "a prompt and the templates" }, { status: 400 });
  const choice = await chooseTemplate(driver, body.data.prompt, body.data.templates, request.signal);
  return choice === null
    ? Response.json({ error: "the agent chose no template" }, { status: 422 })
    : Response.json(choice);
}

/** Run the turn of the choice. Null when the agent made no valid choice. */
export async function chooseTemplate(
  driver: AgentDriver,
  prompt: string,
  templates: readonly TemplateOffer[],
  signal: AbortSignal,
): Promise<TemplateChoice | null> {
  const id = `start-${Date.now().toString(36)}`;
  let choice: TemplateChoice | null = null;
  const run = (name: string, input: unknown): Promise<ToolResult> => {
    const parsed = inputSchema.safeParse(input);
    if (name !== CHOOSE_TEMPLATE_TOOL || !parsed.success) return Promise.resolve(text(`No tool ${name}.`, true));
    const { template, name: folder } = parsed.data;
    if (!templates.some((item) => item.id === template))
      return Promise.resolve(text(`No template "${template}": choose an ID of the list.`, true));
    if (!NAME.test(folder)) return Promise.resolve(text(`The name "${folder}" does not follow the rule.`, true));
    choice = { template, name: folder };
    return Promise.resolve(text(`The project uses the template ${template} and the name ${folder}.`));
  };
  try {
    await driver.turn({
      prompt: choicePrompt(prompt, templates),
      context: [],
      instructions: "",
      session: newSessionInfo(id, "", "Start from a prompt", "agent-1", {}),
      dir: null,
      signal,
      tools: { listings: [LISTING], run },
      say: () => undefined,
      usage: () => undefined,
      files: {
        snapshot: () => {
          throw new Error("the choice of a template writes no file");
        },
        write: () => Promise.reject(new Error("the choice of a template writes no file")),
      },
      permit: () => Promise.resolve({ allowed: false, reason: "the choice of a template has no other action" }),
    });
  } finally {
    driver.close?.(id);
  }
  return choice;
}
