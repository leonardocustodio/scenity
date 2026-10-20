// SPDX-License-Identifier: Apache-2.0
/**
 * The roles of the workbench. A token of the host gives one role. The host refuses each
 * request above the role of its page, and the page hides the controls of those requests. The module is pure (no
 * `node:` or `bun:` import), so the page gets it through `@scenity/workbench-host/protocol`.
 *
 * - `viewer`: sees the surfaces, the changes, the runs and the sessions. It cannot open a terminal, start or drive an
 *   agent, start a run, write a file or use a Git write.
 * - `editor`: all that a viewer can do, and the terminal of Claude, the chat, the runs, the Git writes and the edits.
 *   It cannot open a shell terminal, use the mode "all" (`bypassPermissions`) or start a background run (a background
 *   run always has `bypassPermissions`).
 * - `admin`: all that the local mode can do. The launch token of the host is an admin token. In the remote mode the
 *   host still refuses a shell terminal and the mode "all" for every role.
 */
import type { RequestType } from "./protocol";

/** The kinds of the auth provider of the host (authProvider.ts). */
export type AuthProviderKind = "none" | "token" | "oidc";

/** The roles from low to high. */
export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** True for a role name. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True when `role` is `least` or higher. */
export function roleAtLeast(role: Role, least: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(least);
}

/**
 * The lowest role of each request that changes something. A request that is not in the table is a read: every role
 * may send it. `surface.report` and `checkout.settings` have a rule for their parameters (`requestRefusal`).
 */
export const REQUEST_ROLES: Readonly<Partial<Record<RequestType, Role>>> = {
  "checkouts.create": "admin",
  "checkouts.open": "editor",
  "host.restart": "admin",
  "terminal.open": "editor",
  "terminal.input": "editor",
  "terminal.resize": "editor",
  "terminal.close": "editor",
  "terminal.export": "editor",
  "agent.start": "editor",
  "agent.prompt": "editor",
  "agent.interrupt": "editor",
  "agent.answer": "editor",
  "agent.setMode": "editor",
  "agent.setModel": "editor",
  "agent.setEffort": "editor",
  "agent.resume": "editor",
  "agent.close": "editor",
  "agent.setStopGate": "editor",
  "git.keepTurn": "editor",
  "git.undoTurn": "editor",
  "git.commit": "editor",
  "runs.start": "editor",
  "runs.cancel": "editor",
  "tunes.apply": "editor",
  // A save writes a scene file of the project.
  "scene.save": "editor",
  // A create writes a new scene file and can list it in the project file.
  "scene.create": "editor",
  // A promote writes the asset files and a scene file of the project.
  "asset.promote": "editor",
  "loops.start": "admin",
  "loops.stop": "editor",
  "picker.sheets": "editor",
  "picker.pick": "editor",
  "windows.open": "editor",
};

/**
 * The bridge events of a frame that start a run, write a file or give Claude a prompt (sceneEdit.ts, imports.ts). A
 * viewer page cannot relay them.
 */
export const ACTING_BRIDGE_EVENTS: readonly string[] = [
  "ask",
  "placement",
  "camera",
  "layout",
  "variants",
  "import",
  "scratch",
  "promote",
];

/** The error of a request above the role of the page. */
export function roleRefusalText(role: Role, what: string): string {
  return `The role ${role} cannot ${what}. Ask an admin of this workbench for a token with more access.`;
}

function hasMode(params: Record<string, unknown>): boolean {
  return params.mode === "bypassPermissions";
}

/** The rules of the parameters: a shell terminal, the mode "all", an acting frame event, a settings write. */
function paramRefusal(role: Role, type: RequestType, params: Record<string, unknown>): string | null {
  if (type === "terminal.open" && params.kind === "shell" && role !== "admin") {
    return roleRefusalText(role, "open a shell terminal");
  }
  if ((type === "agent.start" || type === "agent.resume" || type === "agent.setMode") && hasMode(params)) {
    if (role !== "admin") return roleRefusalText(role, 'use the mode "all" (bypassPermissions)');
  }
  if (type === "surface.report" && role === "viewer") {
    const event = params.event as { event?: unknown } | null | undefined;
    if (typeof event?.event === "string" && ACTING_BRIDGE_EVENTS.includes(event.event)) {
      return roleRefusalText(role, `relay the frame event "${event.event}"`);
    }
  }
  if (type === "checkout.settings" && role === "viewer" && Object.keys(params).length > 0) {
    return roleRefusalText(role, "change the checkout settings");
  }
  return null;
}

/** The reason to refuse a request of a page with this role, or null when the role may send it. */
export function requestRefusal(role: Role, type: RequestType, params: Record<string, unknown> = {}): string | null {
  const least = REQUEST_ROLES[type];
  if (least !== undefined && !roleAtLeast(role, least)) return roleRefusalText(role, `send "${type}"`);
  return paramRefusal(role, type, params);
}

/** True when a page with this role may send the request (the page hides the controls of the others). */
export function roleCan(role: Role, type: RequestType, params: Record<string, unknown> = {}): boolean {
  return requestRefusal(role, type, params) === null;
}
