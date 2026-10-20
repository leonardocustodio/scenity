// SPDX-License-Identifier: Apache-2.0
/**
 * The permissions of the agent sessions. Each action of an agent has a kind: scene edits, file writes, runs, imports,
 * network or Git. The mode of the session gives a value per kind (allow, ask or deny). The preferences of the person
 * and the file `.scenity/agents.json` of the project can give a value per kind, and the stricter value wins. "Ask"
 * puts an approval card in the transcript. Some actions always ask in each mode, for example a write of a package.json
 * or of the project file. These files can change the code that runs. Git is for the owner only. A role limits the
 * modes: a viewer has none, an editor has Ask and Review, and an admin has all three.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMode } from "./protocol";

export type ActionKind = "scene" | "files" | "runs" | "imports" | "network" | "git";
export const ACTION_KINDS: readonly ActionKind[] = ["scene", "files", "runs", "imports", "network", "git"];
export type Permission = "allow" | "ask" | "deny";
export const PERMISSIONS: readonly Permission[] = ["allow", "ask", "deny"];

/** The values per kind of each mode. In Ask mode, the read-only jobs run all the same (`READ_ONLY_JOBS`). */
export const MODE_PERMISSIONS: Readonly<Record<AgentMode, Readonly<Record<ActionKind, Permission>>>> = {
  ask: { scene: "deny", files: "deny", runs: "deny", imports: "deny", network: "deny", git: "deny" },
  review: { scene: "allow", files: "ask", runs: "allow", imports: "ask", network: "ask", git: "deny" },
  auto: { scene: "allow", files: "allow", runs: "allow", imports: "allow", network: "allow", git: "deny" },
};

/** The jobs that only read (a check, a picture): Ask mode runs them. */
export const READ_ONLY_JOBS: ReadonlySet<string> = new Set([
  "check",
  "shot",
  "sheet",
  "assets.missing",
  "assets.used-by",
]);

/** The files whose write always asks: they change the code or the plugins that run. */
const ALWAYS_ASK_FILES = /(^|\/)(package\.json|scenity\.project\.json|bunfig\.toml)$/;

/** The roles of the studio and the modes that each one can choose. */
export type AgentRole = "viewer" | "editor" | "admin";
export const ROLE_MODES: Readonly<Record<AgentRole, readonly AgentMode[]>> = {
  viewer: [],
  editor: ["ask", "review"],
  admin: ["ask", "review", "auto"],
};

/** Values per kind (a part of the kinds). */
export type KindValues = Partial<Record<ActionKind, Permission>>;

const ORDER: Readonly<Record<Permission, number>> = { allow: 0, ask: 1, deny: 2 };

/** The stricter of two values. */
export function stricter(a: Permission, b: Permission): Permission {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/** The value of a kind in a mode with the values of the person and of the project. */
export function permissionOf(mode: AgentMode, kind: ActionKind, ...overrides: readonly KindValues[]): Permission {
  let value = MODE_PERMISSIONS[mode][kind];
  for (const values of overrides) {
    const set = values[kind];
    if (set !== undefined) value = stricter(value, set);
  }
  // Git is for the owner only: an agent never does it.
  return kind === "git" ? "deny" : value;
}

/** The value of a file write: a file that changes the code that runs always asks (but a denied write stays denied). */
export function filePermission(path: string, base: Permission): Permission {
  return ALWAYS_ASK_FILES.test(path) ? stricter(base, "ask") : base;
}

/** True when a role can choose a mode. */
export function roleAllows(role: AgentRole, mode: AgentMode): boolean {
  return ROLE_MODES[role].includes(mode);
}

/** The good values per kind of a JSON value. */
export function readKindValues(value: unknown): KindValues {
  if (typeof value !== "object" || value === null) return {};
  const out: KindValues = {};
  for (const kind of ACTION_KINDS) {
    const set = (value as Record<string, unknown>)[kind];
    if (PERMISSIONS.includes(set as Permission)) out[kind] = set as Permission;
  }
  return out;
}

/** The values per kind of a project: `.scenity/agents.json` (`{ "permissions": { "files": "ask" } }`), or none. */
export function projectKindValues(dir: string | null): KindValues {
  const file = dir === null ? null : join(dir, ".scenity", "agents.json");
  if (file === null || !existsSync(file)) return {};
  try {
    return readKindValues((JSON.parse(readFileSync(file, "utf8")) as { permissions?: unknown }).permissions);
  } catch {
    return {};
  }
}
