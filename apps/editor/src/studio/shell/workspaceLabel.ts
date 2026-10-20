// SPDX-License-Identifier: Apache-2.0
/** The label of a workspace in the tabs and the menus: a built-in title, or the name that the person gave. */
import type { WorkspaceEntry } from "./workspaceState";

export function workspaceLabel(
  entry: Pick<WorkspaceEntry, "title" | "name">,
  translate: (message: string) => string,
): string {
  return entry.title === null ? (entry.name ?? "") : translate(entry.title);
}
