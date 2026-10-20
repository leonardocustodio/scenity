// SPDX-License-Identifier: Apache-2.0
/**
 * The empty states of the panels. For each panel, there is a text that tells what to do next when the panel has
 * nothing to show. There is also a prompt for the agent. The Fluent IDs are `empty-<panel>` and `empty-prompt-<panel>`
 * (the panel ID in kebab case). A panel with no content yet shows its empty state (DockPanel.vue), and a panel with no
 * items shows `EmptyState.vue` with its own panel ID. A test checks that each panel has both texts.
 */
import { messageIdOf } from "../../texts";

/** The Fluent IDs of the empty state of a panel. */
export function emptyStateOf(panel: string): { readonly text: string; readonly prompt: string } {
  return { text: messageIdOf("empty", panel), prompt: messageIdOf("empty-prompt", panel) };
}
