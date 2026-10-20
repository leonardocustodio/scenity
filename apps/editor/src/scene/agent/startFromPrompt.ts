// SPDX-License-Identifier: Apache-2.0
/**
 * Start from a prompt: the Hub opens the editor window of a new project with the words of the person (`prompt` of the
 * URL). The window starts a session in review mode and sends the prompt. Thus the first scene of the agent waits in
 * the window as a change set. The window first removes the parameter from the URL, so a reload does not send it again.
 */
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import type { AgentStore } from "./agentStore";

/** The prompt of the first turn (for the agent, in English). */
export function firstScenePrompt(words: string): string {
  return `Build the first scene of this new project for these words of the person: ${words}`;
}

/** Send the prompt of the URL to a new session in review mode. Do nothing when the URL has no prompt. */
export async function startFromPrompt(
  store: Pick<AgentStore, "create" | "send">,
  shell: Pick<StudioShell, "showPanel">,
  href: string = location.href,
): Promise<boolean> {
  const url = new URL(href);
  const words = url.searchParams.get("prompt")?.trim() ?? "";
  if (words === "") return false;
  url.searchParams.delete("prompt");
  history.replaceState(history.state, "", url);
  await store.create({ name: t("agent-start-session"), mode: "review" });
  shell.showPanel("agent");
  await store.send(firstScenePrompt(words));
  return true;
}
