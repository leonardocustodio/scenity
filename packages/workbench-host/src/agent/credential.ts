// SPDX-License-Identifier: Apache-2.0
/**
 * The credential of a chat session.
 *
 * - `subscription` (the default): the SDK gets the environment of the host without `ANTHROPIC_API_KEY` and
 *   `ANTHROPIC_AUTH_TOKEN`, so the bundled Claude Code uses the claude.ai login of the machine.
 * - `api-key`: the host reads `ANTHROPIC_API_KEY` from `<checkout>/.env` at the start of the session (the file must
 *   have the mode 600), else from the environment of the host. The file is at the checkout root. The project manifest
 *   can name another file (`workbench.credentialFile`). The key goes only into the `env` option of
 *   that session. The host never writes it into a file, an event, a log line or an error text.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
import type { AgentCredential, AgentKeyFrom } from "../agentProtocol";

/** The variable of the API key. */
export const API_KEY_ENV = "ANTHROPIC_API_KEY";
/** The variable of a gateway token. The SDK never gets it. */
export const AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
/** The file of the key, relative to the checkout (the checkout root; Git ignores it). */
export const ENV_FILE = ".env";

/** The credential of a session after the host resolved it. `key` is null for the subscription. */
export interface ResolvedCredential {
  readonly credential: AgentCredential;
  readonly keyFrom: AgentKeyFrom | null;
  readonly key: string | null;
}

/** The refusal of an `api-key` session without a key. It never holds the key. */
export const NO_KEY_MESSAGE =
  "The API key option needs ANTHROPIC_API_KEY in the .env file of the checkout root (mode 600) or in the environment of " +
  "the host. Neither has it. Use the subscription option, or add the key and start again.";

/** Remove one pair of matching quotes around a value. */
function unquote(value: string): string {
  const first = value.at(0);
  if (value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first) return value.slice(1, -1);
  return value;
}

/**
 * Find the value of `ANTHROPIC_API_KEY` in the text of a `.env` file: the line `ANTHROPIC_API_KEY=...` (an
 * `export ` prefix is permitted), with the quotes removed. Give null when the file has no such line or the value is
 * empty.
 */
export function parseEnvKey(text: string): string | null {
  let found: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line.startsWith(`${API_KEY_ENV}=`)) continue;
    const value = unquote(line.slice(API_KEY_ENV.length + 1).trim());
    found = value === "" ? null : value;
  }
  return found;
}

/**
 * Read the key of a credential file: the `.env` file of a checkout folder, or the path of a file. Null when
 * the file is absent. Throws when the mode is not 600.
 */
export function readEnvFileKey(checkoutOrFile: string): string | null {
  const path = isDirectory(checkoutOrFile) ? join(checkoutOrFile, ENV_FILE) : checkoutOrFile;
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    return null;
  }
  if (mode !== 0o600) {
    throw new Error(
      `${basename(path)} of the project has the mode ${mode.toString(8)}, not 600. The host does not read a key ` +
        `from a file that other users can read. Run chmod 600 ${basename(path)}, then start again.`,
    );
  }
  return parseEnvKey(readFileSync(path, "utf8"));
}

/**
 * Resolve the credential of a new session. `checkoutOrFile` is the checkout folder or the credential file. Throws with
 * a reason (never the key) when an `api-key` has no key.
 */
export function resolveCredential(
  credential: AgentCredential,
  checkoutOrFile: string,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedCredential {
  if (credential === "subscription") return { credential, keyFrom: null, key: null };
  const fromFile = readEnvFileKey(checkoutOrFile);
  if (fromFile !== null) return { credential, keyFrom: ".env", key: fromFile };
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return { credential, keyFrom: "environment", key: fromEnv };
  throw new Error(NO_KEY_MESSAGE);
}

/** Put the credential into the environment of a session: no key variable for the subscription, the key otherwise. */
export function withCredential(
  env: Readonly<Record<string, string>>,
  resolved: ResolvedCredential,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (name !== API_KEY_ENV && name !== AUTH_TOKEN_ENV) out[name] = value;
  }
  if (resolved.key !== null) out[API_KEY_ENV] = resolved.key;
  return out;
}

/** Replace each copy of the key in a text. The error texts of a session go through it. */
export function redactKey(text: string, key: string | null): string {
  return key === null || key === "" ? text : text.replaceAll(key, "[ANTHROPIC_API_KEY]");
}
