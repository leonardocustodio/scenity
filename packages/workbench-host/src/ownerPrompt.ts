// SPDX-License-Identifier: Apache-2.0
/**
 * The prompts of the owner. Claude Code also sends the `UserPromptSubmit`
 * hook for a message that the owner did not type: a message of another Claude session (`<cross-session-message …>`),
 * the notice of a background task, the output of a local command. Such a message must not start a new turn: the
 * before and after and the undo of the turn of the owner stay with that turn.
 *
 * Claude Code wraps each of these messages in one element with a tag name of more than one word. A prompt of the owner
 * is plain text (a slash command is also plain text).
 */

/** The tags of the messages that Claude Code makes. A prompt that starts with one of them is not a prompt of the owner. */
export const MACHINE_TAGS = [
  "cross-session-message",
  "task-notification",
  "system-reminder",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "channel-message",
  "teammate-message",
  "peer-message",
] as const;

/** One element with a tag name of two or more words, and nothing else. */
const WHOLE_ELEMENT = /^<([a-z]+(?:-[a-z]+)+)(?:\s[^>]*)?>[\s\S]*<\/\1>$/;

/** The tag name at the start of a text (`<name` then a space, `>` or `/`), or null. */
function leadingTag(text: string): string | null {
  return /^<([a-z][a-z-]*)[\s>/]/.exec(text)?.[1] ?? null;
}

/** True when the owner typed the prompt; false for a message that Claude Code made (another session, a task). */
export function isOwnerPrompt(prompt: string): boolean {
  const text = prompt.trim();
  const tag = leadingTag(text);
  if (tag !== null && (MACHINE_TAGS as readonly string[]).includes(tag)) return false;
  return !WHOLE_ELEMENT.test(text);
}
