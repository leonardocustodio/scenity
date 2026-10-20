// SPDX-License-Identifier: Apache-2.0
/**
 * The questions of an agent: the tool `ask_person` puts a question card in the transcript with 2 to 4 choices and
 * "Other" (a text of the person). The session waits (a dot on its tab, a toast and the bell) until the person answers
 * in the panel. A stop of the turn ends the question with no answer.
 */
import { defineTool, type ToolDef, type ToolResult } from "@scenity/agent-tools";
import { z } from "zod";
import type { AgentItem } from "./protocol";

const askInput = z.object({
  question: z.string().min(1).max(500).describe("The question, in one or two sentences."),
  options: z.array(z.string().min(1).max(120)).min(2).max(4).describe("2 to 4 choices; the person can also write."),
});

/** The question tool. The studio host runs it. The handler here only gives the listing. */
export const QUESTION_TOOLS: readonly ToolDef[] = [
  defineTool({
    name: "ask_person",
    description:
      "Ask the person a question with 2 to 4 choices (the person can also write an answer) and wait for the answer. " +
      "Use it when a choice of the person changes the work.",
    input: askInput,
    alwaysLoad: true,
    handler: () => {
      throw new Error("the studio host runs this tool");
    },
  }),
];

/** The questions that wait, by ID. Each one ends with the answer of the person, or null (a stop). */
export class Questions {
  readonly #waiting = new Map<
    string,
    { readonly session: string; readonly resolve: (answer: string | null) => void }
  >();
  #next = 1;

  open(session: string): { id: string; answer: Promise<string | null> } {
    const id = `q${String(this.#next++)}`;
    const answer = new Promise<string | null>((resolve) => this.#waiting.set(id, { session, resolve }));
    return { id, answer };
  }

  /** The answer of the person. False when no question of the session has the ID. */
  answer(session: string, id: string, text: string): boolean {
    const waiting = this.#waiting.get(id);
    if (waiting?.session !== session) return false;
    this.#waiting.delete(id);
    waiting.resolve(text);
    return true;
  }

  /** End each question of a session with no answer (a stop, a close). */
  endAll(session: string): void {
    for (const [id, waiting] of this.#waiting) {
      if (waiting.session !== session) continue;
      this.#waiting.delete(id);
      waiting.resolve(null);
    }
  }
}

/** What the question tool reads of its session. */
export interface QuestionParts {
  readonly session: string;
  readonly questions: Questions;
  nextId(): number;
  item(item: AgentItem): void;
  waiting(on: boolean): void;
}

/** Run `ask_person`: the card, the wait, and the answer for the agent. */
export async function runQuestion(parts: QuestionParts, input: unknown): Promise<ToolResult> {
  const parsed = askInput.safeParse(input);
  if (!parsed.success) {
    return { content: [{ type: "text", text: "ask_person: give the question and 2 to 4 options." }], isError: true };
  }
  const { question, options } = parsed.data;
  const { id, answer } = parts.questions.open(parts.session);
  const item = parts.nextId();
  parts.item({ id: item, kind: "question", question: id, text: question, options, answer: null });
  parts.waiting(true);
  const given = await answer;
  parts.waiting(false);
  parts.item({ id: item, kind: "question", question: id, text: question, options, answer: given ?? "" });
  const text = given === null ? "The person did not answer (the turn stopped)." : `The person answered: ${given}`;
  return { content: [{ type: "text", text }] };
}
