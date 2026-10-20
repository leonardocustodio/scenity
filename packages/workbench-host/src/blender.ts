// SPDX-License-Identifier: Apache-2.0
/**
 * The Blender MCP server of the owner next to the workbench server, and the settings
 * of a checkout. When the setting `blender` of a checkout is on and the owner's user settings have a server named
 * `blender` (`~/.claude.json` `mcpServers`, its entry for the checkout under `projects`, or
 * `~/.claude/settings.json` `mcpServers`), the generated MCP config of the terminal and of the background runs adds it.
 *
 * The host never copies a secret: it takes the type, the command and the arguments of a stdio server (or the URL of
 * an HTTP server) and leaves out `env` and `headers`. The server process then gets the environment of the CLI.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isIntentId, isRecord, parseJson, type CheckoutSettings } from "./protocol";
import { readJsonObject, writeJsonAtomic } from "./state";

/** The name of the server in the MCP config. */
export const BLENDER_SERVER = "blender";

function readJson(path: string): Record<string, unknown> {
  try {
    const value = parseJson(readFileSync(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** The entry without its secrets: the type, the command and the arguments, or the type and the URL. */
export function safeServer(entry: unknown): Record<string, unknown> | null {
  if (!isRecord(entry)) return null;
  const type = typeof entry.type === "string" ? entry.type : "stdio";
  if (type === "stdio") {
    if (typeof entry.command !== "string" || entry.command === "") return null;
    const args = Array.isArray(entry.args) ? entry.args.filter((arg) => typeof arg === "string") : [];
    return { type, command: entry.command, args };
  }
  if ((type === "http" || type === "sse") && typeof entry.url === "string") return { type, url: entry.url };
  return null;
}

function serverOf(file: Record<string, unknown>): unknown {
  return isRecord(file.mcpServers) ? file.mcpServers[BLENDER_SERVER] : undefined;
}

/**
 * The Blender server of the owner's user settings, without secrets, or null. The project entry of the checkout comes
 * first, then the user entry of `~/.claude.json`, then `~/.claude/settings.json`.
 */
export function findBlenderServer(checkout: string, home: string = homedir()): Record<string, unknown> | null {
  const user = readJson(join(home, ".claude.json"));
  const projects = isRecord(user.projects) ? user.projects : {};
  const project = projects[checkout];
  const candidates = [
    isRecord(project) ? serverOf(project) : undefined,
    serverOf(user),
    serverOf(readJson(join(home, ".claude", "settings.json"))),
  ];
  for (const candidate of candidates) {
    const safe = safeServer(candidate);
    if (safe !== null) return safe;
  }
  return null;
}

/** The settings file of the checkouts in the state folder. */
export const SETTINGS_FILE = "checkout-settings.json";

/** The settings of the checkouts of a host: the Blender option (default off) and the intent of the runs. */
export class CheckoutSettingsStore {
  readonly #path: string;
  readonly #home: string;
  readonly #listeners = new Set<(checkout: string) => void>();

  constructor(stateDir: string, home: string = homedir()) {
    this.#path = join(stateDir, SETTINGS_FILE);
    this.#home = home;
  }

  #raw(checkout: string): Record<string, unknown> {
    const all = readJsonObject(this.#path);
    const value = all[checkout];
    return isRecord(value) ? value : {};
  }

  /** The settings of a checkout. */
  get(checkout: string): CheckoutSettings {
    const raw = this.#raw(checkout);
    return {
      blender: raw.blender === true,
      blenderFound: findBlenderServer(checkout, this.#home) !== null,
      intent: isIntentId(raw.intent) ? raw.intent : null,
      builtLab: raw.builtLab === true,
    };
  }

  /** Change the settings of a checkout. A field that is absent stays as it is. */
  set(checkout: string, patch: { blender?: unknown; intent?: unknown; builtLab?: unknown }): CheckoutSettings {
    const raw = this.#raw(checkout);
    if (patch.builtLab !== undefined) {
      if (typeof patch.builtLab !== "boolean") throw new Error('The parameter "builtLab" must be true or false.');
      raw.builtLab = patch.builtLab;
    }
    if (patch.blender !== undefined) {
      if (typeof patch.blender !== "boolean") throw new Error('The parameter "blender" must be true or false.');
      raw.blender = patch.blender;
    }
    if (patch.intent !== undefined) {
      if (patch.intent !== null && patch.intent !== "" && !isIntentId(patch.intent)) {
        throw new Error('The parameter "intent" is not an intent ID (a-z, 0-9 and -).');
      }
      raw.intent = patch.intent === "" ? null : patch.intent;
    }
    writeJsonAtomic(this.#path, { ...readJsonObject(this.#path), [checkout]: raw });
    for (const listener of this.#listeners) listener(checkout);
    return this.get(checkout);
  }

  /** Call the listener after each change of the settings of a checkout. */
  onChange(listener: (checkout: string) => void): void {
    this.#listeners.add(listener);
  }

  /** The extra MCP servers of a checkout: the Blender server when the setting is on and the owner has one. */
  extraServers(checkout: string): Record<string, unknown> {
    if (!this.get(checkout).blender) return {};
    const server = findBlenderServer(checkout, this.#home);
    return server === null ? {} : { [BLENDER_SERVER]: server };
  }
}
