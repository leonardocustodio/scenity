// SPDX-License-Identifier: Apache-2.0
/**
 * The hooks of the studio API for the components of panels. The core panels and the panels of the plugins get the
 * services of the shell only from these hooks. A test fails when a core panel imports a part of the shell from a
 * different module (core-panel-api.vitest.ts).
 *
 * - `usePanelState(key, fallback)`: a value that the layout keeps with the panel (a search text, a filter, a fold).
 * - `usePanelVisible()`: true while the tab of the panel shows.
 * - `useAgentAsk()`: true when an agent of the studio can take a prompt, and a function that sends one.
 * - `EmptyState`: the empty state of a panel, with "Ask the agent".
 * - `useViewerReason()`: the reason why a viewer of the studio cannot change the project, or null. A panel shows its
 *   controls that change the project as disabled with this reason (not hidden).
 * - `useRoleReason(action)`: the reason why the role of the window cannot do an action (`owner`, `shell`, `auto`,
 *   `files`), or null. A panel shows the control as disabled with this reason.
 */
import { computed, type ComputedRef } from "vue";
import { studioHost } from "../shell/panels";
import { currentShell } from "../shell/shell";
import { roleReason, studioAccess, viewerReason, type RoleAction } from "../shell/viewerRole";

export type { RoleAction } from "../shell/viewerRole";

export { default as EmptyState } from "../shell/EmptyState.vue";
export { usePanelState, usePanelVisible } from "../shell/panelState";

/** The prompt of the agent of the studio. `can` is true when an agent can accept prompts. */
export interface AgentAsk {
  readonly can: ComputedRef<boolean>;
  /** Send a prompt to the agent panel (nothing happens when `can` is false). */
  ask(prompt: string): void;
}

/** The reason of the lock of a viewer, or null for a person who can change the project. */
export function useViewerReason(): ComputedRef<string | null> {
  return computed(() => viewerReason.value);
}

/** The reason why the role of the window cannot do an action, or null. */
export function useRoleReason(action: RoleAction): ComputedRef<string | null> {
  return computed(() => roleReason(action, studioAccess.value));
}

/** The agent of the studio for a panel. */
export function useAgentAsk(): AgentAsk {
  return {
    can: computed(() => studioHost.value && currentShell()?.search.ask != null),
    ask: (prompt) => currentShell()?.search.ask?.(prompt),
  };
}
