// SPDX-License-Identifier: Apache-2.0
/**
 * The state folder of the host. The host writes its state as JSON files, so a restart restores the state: the
 * checkouts, the open surface URLs and the Claude session IDs. A write is atomic:
 * the host writes a temporary file and renames it.
 */
import { APP_ID } from "@scenity/studio-host/store";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { denyFolder } from "./denylist";
import { isRecord, parseJson } from "./protocol";

/** The identifier of the app. */
export { APP_ID };

/** The first 16 hex characters of the SHA-256 of the checkout path. */
export function checkoutHash(checkout: string): string {
  return createHash("sha256").update(checkout, "utf8").digest("hex").slice(0, 16);
}

/**
 * The default state folder of a checkout. On macOS: `~/Library/Application Support/org.scenity.editor/host/<hash>`.
 * On another system: `$XDG_STATE_HOME/org.scenity.editor/host/<hash>` (default `~/.local/state`).
 */
export function defaultStateDir(
  checkout: string,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (env.XDG_STATE_HOME ?? join(home, ".local", "state"));
  return join(base, APP_ID, "host", checkoutHash(checkout));
}

/** Write a value as JSON: first into a temporary file of the same folder, then a rename over the file. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${String(process.pid)}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Read a JSON object. Give an empty object when the file is absent or is not a JSON object. */
export function readJsonObject(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const value = parseJson(text);
  return isRecord(value) ? value : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** The files of the state folder. */
export const STATE_FILES = {
  checkouts: "checkouts.json",
  surfaces: "surfaces.json",
  sessions: "sessions.json",
  chat: "chat.json",
} as const;

/** The state of the host in its state folder. Each change writes its file immediately. */
export class HostState {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // The files of the state folder (the generated settings hold the launch token) are never shown.
    denyFolder(dir);
  }

  #path(name: keyof typeof STATE_FILES): string {
    return join(this.dir, STATE_FILES[name]);
  }

  /** The checkout that the host opened last, or null. */
  currentCheckout(): string | null {
    const value = readJsonObject(this.#path("checkouts")).current;
    return typeof value === "string" ? value : null;
  }

  /** The checkouts that the host opened, the last one first. */
  knownCheckouts(): string[] {
    return stringList(readJsonObject(this.#path("checkouts")).known);
  }

  /** Record the checkout that the host opens. */
  openCheckout(path: string): void {
    const known = [path, ...this.knownCheckouts().filter((item) => item !== path)].slice(0, 20);
    writeJsonAtomic(this.#path("checkouts"), { current: path, known });
  }

  /** The surface URLs of a checkout by surface ID. */
  surfaceUrls(checkout: string): Record<string, string> {
    return stringMap(readJsonObject(this.#path("surfaces"))[checkout]);
  }

  /** Record the URL of a surface of a checkout. Null removes it. */
  setSurfaceUrl(checkout: string, surface: string, url: string | null): void {
    const all = readJsonObject(this.#path("surfaces"));
    const others = Object.entries(stringMap(all[checkout])).filter(([id]) => id !== surface);
    const urls = Object.fromEntries(url === null ? others : [...others, [surface, url]]);
    writeJsonAtomic(this.#path("surfaces"), { ...all, [checkout]: urls });
  }

  /** The Claude session IDs of a checkout, the last one first. */
  sessions(checkout: string): string[] {
    return stringList(readJsonObject(this.#path("sessions"))[checkout]);
  }

  /** The credential choice of the chat mode in a checkout, or null. The file holds the choice, never a key. */
  chatCredential(checkout: string): "subscription" | "api-key" | null {
    const entry = readJsonObject(this.#path("chat"))[checkout];
    const value = isRecord(entry) ? entry.credential : undefined;
    return value === "subscription" || value === "api-key" ? value : null;
  }

  /** Record the credential choice of the chat mode in a checkout. */
  setChatCredential(checkout: string, credential: "subscription" | "api-key"): void {
    const all = readJsonObject(this.#path("chat"));
    writeJsonAtomic(this.#path("chat"), { ...all, [checkout]: { credential } });
  }

  /** Record a Claude session ID of a checkout (for the resume). */
  addSession(checkout: string, session: string): void {
    const all = readJsonObject(this.#path("sessions"));
    const list = [session, ...stringList(all[checkout]).filter((item) => item !== session)].slice(0, 50);
    writeJsonAtomic(this.#path("sessions"), { ...all, [checkout]: list });
  }
}
