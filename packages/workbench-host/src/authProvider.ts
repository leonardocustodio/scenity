// SPDX-License-Identifier: Apache-2.0
/**
 * The auth providers of the host. A provider gives the caller of a credential:
 * the token of the header `x-workbench-token`, or the `token` parameter of the WebSocket. The launch token of the
 * host is always an admin token, so the processes of the host (the MCP proxy, the hooks, a background run) keep their
 * access.
 *
 * - `none`: the launch token only (the default; the local mode on the loopback).
 * - `token`: the launch token and the role tokens of `SCENITY_WORKBENCH_ROLES` (`viewer:<64 hex>,editor:<64 hex>`).
 *   The gateway of the remote mode reads the same variable.
 * - `oidc`: the launch token and a verifier that the embedder gives in code (for example a check of an ID token that
 *   a sign-in proxy in front of the gateway adds). The host has no OIDC code of its own.
 */
import { isRole, type AuthProviderKind, type Role } from "./roleProtocol";
import { sameToken } from "./token";
import { envValue } from "@scenity/labs-platform/envNames";

export type { AuthProviderKind } from "./roleProtocol";

/** The caller of a request: its role and, when the provider knows one, the person. */
export interface Caller {
  readonly role: Role;
  readonly user: string | null;
}

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  /** The caller of a credential, or null to refuse the request (401). */
  caller(credential: string | null, request: Request): Caller | null | Promise<Caller | null>;
  /** An access token for the update server of the desktop shell, or null. */
  accessToken?(): Promise<string | null>;
}

/** The variable of the role tokens (the provider `token`; the gateway reads it too). */
export const ROLES_ENV = "SCENITY_WORKBENCH_ROLES";

/** One role token. */
export interface RoleToken {
  readonly role: Role;
  readonly token: string;
}

const ADMIN: Caller = { role: "admin", user: null };
const TOKEN = /^[0-9a-f]{64}$/;

/**
 * Read the role tokens: a comma list of `<role>:<64 lowercase hex>`. Throw an error for a bad entry, so a host does
 * not start with a token that it cannot check.
 */
export function parseRoleTokens(text: string): RoleToken[] {
  const tokens: RoleToken[] = [];
  for (const part of text.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const [role, token, ...rest] = entry.split(":");
    if (!isRole(role) || token === undefined || !TOKEN.test(token) || rest.length > 0) {
      throw new Error(`${ROLES_ENV} needs <viewer|editor|admin>:<64 lowercase hex> entries.`);
    }
    tokens.push({ role, token });
  }
  return tokens;
}

/** The provider `none`: the launch token gives the role admin; every other credential is refused. */
export function noneProvider(launch: string): AuthProvider {
  return { kind: "none", caller: (credential) => (sameToken(credential, launch) ? ADMIN : null) };
}

/** The provider `token`: the launch token (admin) and the role tokens. */
export function tokenProvider(launch: string, tokens: readonly RoleToken[]): AuthProvider {
  return {
    kind: "token",
    caller(credential) {
      if (sameToken(credential, launch)) return ADMIN;
      // Each token gets a compare, so the time does not show which entry matched.
      let found: Role | null = null;
      for (const entry of tokens) if (sameToken(credential, entry.token) && found === null) found = entry.role;
      return found === null ? null : { role: found, user: null };
    },
  };
}

/** The verifier of the provider `oidc`: the caller of a credential that is not the launch token, or null. */
export type OidcVerifier = (credential: string | null, request: Request) => Promise<Caller | null>;

/** The provider `oidc`: the launch token (admin), then the verifier of the embedder. */
export function oidcProvider(
  launch: string,
  verify: OidcVerifier,
  accessToken?: () => Promise<string | null>,
): AuthProvider {
  return {
    kind: "oidc",
    caller: (credential, request) => (sameToken(credential, launch) ? ADMIN : verify(credential, request)),
    ...(accessToken === undefined ? {} : { accessToken }),
  };
}

/** The settings of a provider that `startHost` builds with the launch token. */
export type AuthSetup =
  | { readonly kind: "none" }
  | { readonly kind: "token"; readonly tokens: readonly RoleToken[] }
  | { readonly kind: "oidc"; readonly verify: OidcVerifier; readonly accessToken?: () => Promise<string | null> };

/** The settings of the command line: `token` when `SCENITY_WORKBENCH_ROLES` has entries, else `none`. */
export function authFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): AuthSetup {
  const tokens = parseRoleTokens(envValue(ROLES_ENV, env) ?? "");
  return tokens.length === 0 ? { kind: "none" } : { kind: "token", tokens };
}

/** The provider of the settings with the launch token. */
export function makeProvider(setup: AuthSetup | undefined, launch: string): AuthProvider {
  if (setup === undefined || setup.kind === "none") return noneProvider(launch);
  if (setup.kind === "token") return tokenProvider(launch, setup.tokens);
  return oidcProvider(launch, setup.verify, setup.accessToken);
}
