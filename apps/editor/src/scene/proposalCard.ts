// SPDX-License-Identifier: Apache-2.0
/**
 * The proposal card of the scene page in the edit mode: the edits of Claude that wait for the owner (`scene_command`
 * without the switch "apply"). Each row has the title of the edit, who made it, Accept (the edit applies as one step of
 * the history) and Reject. The card shows only while a proposal waits, at the bottom right of the free area of the edit
 * layout. No Vue: the page makes it with the commands. The texts are Fluent messages of `src/i18n/en-US/scene.ftl`; the
 * title of the edit comes from its command.
 */
import type { Proposal } from "@scenity/editor-core";
import { t } from "../texts";
import { placePart } from "./pageParts";
import type { PageOp, SceneCommands } from "./hierarchy/sceneCommands";

/** A button of the card. */
function button(text: string, testId: string, run: () => void): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  item.dataset.testid = testId;
  item.addEventListener("click", run);
  return item;
}

/** One row of the card: the title, who made the edit, Accept and Reject. */
function row(proposal: Proposal<PageOp>, commands: SceneCommands, failed: (error: unknown) => void): HTMLElement {
  const line = document.createElement("div");
  line.dataset.testid = "scene-proposal";
  line.dataset.proposal = proposal.id;
  const words = document.createElement("span");
  const title = proposal.edit.title;
  words.textContent =
    proposal.by === "claude"
      ? t("scene-proposal-claude", { title })
      : t("scene-proposal-by", { title, by: proposal.by });
  const accept = button(t("scene-proposal-accept"), "scene-proposal-accept", () => {
    try {
      commands.accept(proposal.id);
    } catch (error) {
      failed(error);
    }
  });
  const reject = button(t("scene-proposal-reject"), "scene-proposal-reject", () => commands.reject(proposal.id));
  line.append(words, accept, reject);
  return line;
}

/** Start the proposal card of the commands. The result removes it. */
export function startProposalCard(commands: SceneCommands): () => void {
  const card = document.createElement("section");
  card.id = "scene-proposals";
  card.dataset.testid = "scene-proposals";
  card.setAttribute("aria-label", t("scene-proposals"));
  card.hidden = true;
  placePart(card, "view");
  const failed = (error: unknown): void => {
    card.dataset.error = error instanceof Error ? error.message : String(error);
  };
  const show = (proposals: readonly Proposal<PageOp>[]): void => {
    card.hidden = proposals.length === 0;
    const head = document.createElement("strong");
    head.textContent = t("scene-proposals-count", { count: String(proposals.length) });
    card.replaceChildren(head, ...proposals.map((proposal) => row(proposal, commands, failed)));
  };
  show(commands.proposals());
  const stop = commands.listenProposals(show);
  return () => {
    stop();
    card.remove();
  };
}
