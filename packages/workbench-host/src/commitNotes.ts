// SPDX-License-Identifier: Apache-2.0
/**
 * The notes of the commit message proposal: the reasons of the owner to save a placement while a layout check fails.
 * "Save placement" with an override (sceneEdit.ts `runPlacement`) keeps its reason here when the real apply passes.
 * The proposal of the Changes tab (`git.turns`, turns.ts `proposal`) then ends with the reasons. Thus the commit of
 * the owner says why the layout checks failed. A commit clears the notes.
 *
 * The state of each checkout is `<state>/commit-notes/<hash of the checkout>.json`. A commit message is one subject
 * line of at most 200 characters (git.ts), so the reasons go in brackets at its end and the line stops at that length.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkoutHash, readJsonObject, writeJsonAtomic } from "./state";

/** The longest commit subject (git.ts `checkMessage`). */
export const SUBJECT_MAX = 200;
/** The most reasons that the store keeps per checkout. */
const MAX_REASONS = 5;
/** The proposal of a placement without a turn of Claude. */
export const PLACEMENT_SUBJECT = "Save the placement of the scene editor";

/** One line of a reason: no line breaks, no sequences of spaces. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The commit message proposal with the reasons of the overrides: `<message> (layout checks overridden: <reasons>)`,
 * at most SUBJECT_MAX characters. A message without a turn gets PLACEMENT_SUBJECT.
 */
export function withOverrides(message: string, reasons: readonly string[]): string {
  if (reasons.length === 0) return message;
  const base = message.trim() === "" ? PLACEMENT_SUBJECT : message.trim();
  const text = `${base} (layout checks overridden: ${reasons.map(oneLine).join("; ")})`;
  return text.length <= SUBJECT_MAX ? text : `${text.slice(0, SUBJECT_MAX - 2).trimEnd()}…)`;
}

/** The reasons of the overrides of each checkout, in the state folder of the host. */
export class CommitNotes {
  readonly #root: string;

  constructor(stateDir: string) {
    this.#root = join(stateDir, "commit-notes");
  }

  #file(checkout: string): string {
    return join(this.#root, `${checkoutHash(checkout)}.json`);
  }

  /** The reasons of a checkout, the oldest first. */
  reasons(checkout: string): string[] {
    const value = readJsonObject(this.#file(checkout)).reasons;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  /** Keep a reason of an override (a reason that the list has already stays once). */
  add(checkout: string, reason: string): void {
    const line = oneLine(reason);
    if (line === "") return;
    const reasons = [...this.reasons(checkout).filter((item) => item !== line), line].slice(-MAX_REASONS);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    writeJsonAtomic(this.#file(checkout), { reasons });
  }

  /** Remove the reasons of a checkout (after a commit). */
  clear(checkout: string): void {
    if (this.reasons(checkout).length === 0) return;
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    writeJsonAtomic(this.#file(checkout), { reasons: [] });
  }
}
