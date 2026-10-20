// SPDX-License-Identifier: Apache-2.0
/**
 * The role of the person in a window of the studio: the reason why a viewer changes
 * nothing, or null. The parts of the window that change the project show their controls off with this reason (not
 * hidden).
 *
 * The role and the remote mode of the studio (`/api/state`) give the reasons of the other controls: the actions of the
 * owner (the terminals, the trust, the links, the plugins), the shell terminal, the Auto mode of an agent, and the file
 * writes of an agent in remote mode.
 */
import { shallowRef } from "vue";
import { t } from "../../texts";

/** The reason of the lock of a viewer, or null for a person who changes the project. */
export const viewerReason = shallowRef<string | null>(null);

/** The role of the session of the window and the remote mode of the studio. */
export interface StudioAccessState {
  readonly role: "viewer" | "editor" | "admin";
  readonly remote: boolean;
}

/** The access of the window (`/api/state`); the owner of a local studio until the state comes. */
export const studioAccess = shallowRef<StudioAccessState>({ role: "admin", remote: false });

/**
 * The controls with a reason of the role: `owner`, an action of the owner only; `shell`, a shell terminal; `auto`, the
 * Auto mode of an agent; `files`, a file write of an agent with no question.
 */
export type RoleAction = "owner" | "shell" | "auto" | "files";

/** The reason why the role of the window does not do an action, or null. */
export function roleReason(action: RoleAction, state: StudioAccessState = studioAccess.value): string | null {
  const owner = state.role === "admin" ? null : t("role-owner-only");
  switch (action) {
    case "owner":
      return owner;
    case "shell":
      return owner ?? (state.remote ? t("role-remote-shell") : null);
    case "auto":
      if (state.role === "viewer") return t("notice-viewer-locked");
      return state.role === "editor" ? t("role-editor-auto") : null;
    case "files":
      return state.remote ? t("role-remote-files") : null;
  }
}
