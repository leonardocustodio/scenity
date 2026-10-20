// SPDX-License-Identifier: Apache-2.0
/**
 * The drafts of the scene files in the browser and on the host: a draft storage that keeps each draft in the browser
 * storage and in the project folder of the dev server (scripts/draftsApi.ts). A read gives the newer draft of the two.
 * Thus the unsaved edits stay after a closed tab, a cleared browser storage, or in another browser. A write to the host
 * waits at most 300 ms, and a hide of the page sends the writes that wait immediately.
 */
import type { DraftStorage } from "@scenity/editor-core";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The time of a draft text (ms since 1970), or -1 for a text that is not a draft. */
function draftTime(text: string | null): number {
  if (text === null) return -1;
  try {
    const value = JSON.parse(text) as { savedMs?: unknown };
    return typeof value.savedMs === "number" ? value.savedMs : -1;
  } catch {
    return -1;
  }
}

/** The draft storage of a project: the browser storage and the host. */
export class HostDraftStorage implements DraftStorage {
  readonly #local: DraftStorage | null;
  readonly #base: string;
  readonly #fetcher: Fetcher;
  readonly #host = new Map<string, string>();
  readonly #waiting = new Map<string, string | null>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** True after the load when the host had a draft that the browser did not have. */
  readonly ready: Promise<boolean>;

  constructor(local: DraftStorage | null, base: string, fetcher: Fetcher = (input, init) => fetch(input, init)) {
    this.#local = local;
    this.#base = base;
    this.#fetcher = fetcher;
    this.ready = this.#load();
    // A test or a Bun script has no window: no hide of the page.
    if (typeof window !== "undefined") window.addEventListener("pagehide", () => this.flush(true));
  }

  async #load(): Promise<boolean> {
    try {
      const answer = await this.#fetcher(`${this.#base}drafts.json`, { cache: "no-store" });
      if (!answer.ok) return false;
      const { drafts } = (await answer.json()) as { drafts?: Readonly<Record<string, string>> };
      let newer = false;
      for (const [key, value] of Object.entries(drafts ?? {})) {
        if (this.#waiting.has(key)) continue;
        this.#host.set(key, value);
        if (draftTime(value) > draftTime(this.#localItem(key))) newer = true;
      }
      return newer;
    } catch {
      return false;
    }
  }

  #localItem(key: string): string | null {
    try {
      return this.#local?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  getItem(key: string): string | null {
    const local = this.#localItem(key);
    const host = this.#host.get(key) ?? null;
    return draftTime(host) > draftTime(local) ? host : local;
  }

  setItem(key: string, value: string): void {
    this.#local?.setItem(key, value);
    this.#host.set(key, value);
    this.#send(key, value);
  }

  removeItem(key: string): void {
    this.#local?.removeItem(key);
    this.#host.delete(key);
    this.#send(key, null);
  }

  #send(key: string, value: string | null): void {
    this.#waiting.set(key, value);
    // The first write of a burst starts the timer; the later ones change only the value that waits, so a page that
    // writes the draft often still sends it each 300 ms.
    this.#timer ??= setTimeout(() => this.flush(), 300);
  }

  /** Send the writes that wait now; `leaving`: the page goes away (the request outlives the page). */
  flush(leaving = false): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const [key, value] of this.#waiting) {
      void this.#fetcher(`${this.#base}drafts.write`, {
        method: "POST",
        headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
        keepalive: leaving,
      }).catch(() => null);
    }
    this.#waiting.clear();
  }
}
