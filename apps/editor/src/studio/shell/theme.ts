// SPDX-License-Identifier: Apache-2.0
/**
 * The theme of the studio pages: dark (the default), light and navy, each with the standard or the high contrast. The
 * theme goes on the body, so the dialogs and the menus that open in the body also get it. The contrast goes on the
 * root element: the token rules are `[data-contrast="more"] [data-theme="…"]`. The browser keeps the choice. In the
 * studio, the preferences of the host also keep it.
 */
import { markRaw, shallowRef } from "vue";
import { patchHostPreferences } from "./hostPreferences";

export const THEMES = ["dark", "light", "navy"] as const;
export type ThemeName = (typeof THEMES)[number];
export type Contrast = "standard" | "more";

export interface ThemeChoice {
  readonly theme: ThemeName;
  readonly contrast: Contrast;
}

/** The storage key of the choice in the browser. */
export const THEME_KEY = "scenity.studio.theme";
export const DEFAULT_THEME: ThemeChoice = { theme: "dark", contrast: "standard" };

/** A choice of a stored or a host value, else the default. */
export function themeChoice(value: unknown): ThemeChoice {
  const item = value as Partial<ThemeChoice> | null | undefined;
  const theme = THEMES.find((name) => name === item?.theme) ?? DEFAULT_THEME.theme;
  return { theme, contrast: item?.contrast === "more" ? "more" : "standard" };
}

/** Put a choice on the page. */
export function applyTheme(
  choice: ThemeChoice,
  body: HTMLElement = document.body,
  root: HTMLElement = document.documentElement,
): void {
  body.dataset.theme = choice.theme;
  root.dataset.contrast = choice.contrast;
  root.style.colorScheme = choice.theme === "light" ? "light" : "dark";
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface Preferences {
  readonly theme?: unknown;
  readonly contrast?: unknown;
}

/** The theme of the page: the current choice, a change, and the copy of the host preferences in the studio. */
export class PageTheme {
  readonly choice = shallowRef<ThemeChoice>(DEFAULT_THEME);
  readonly #storage: () => Storage;
  #host: { readonly fetcher: Fetcher; preferences: Preferences } | null = null;

  constructor(storage: () => Storage = () => localStorage) {
    this.#storage = storage;
    markRaw(this);
  }

  /** The choice of the browser, on the page at once. */
  start(): ThemeChoice {
    let stored: unknown = null;
    try {
      const text = this.#storage().getItem(THEME_KEY);
      stored = text === null ? null : JSON.parse(text);
    } catch {
      // No storage: the default theme.
    }
    this.#show(themeChoice(stored));
    return this.choice.value;
  }

  /** In the studio: the theme of the host preferences wins (the Hub and the editor share it). */
  async useHost(fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<void> {
    const answer = await fetcher("/api/user/preferences").catch(() => null);
    if (!answer?.ok) return;
    const preferences = (await answer.json()) as Preferences;
    this.#host = { fetcher, preferences };
    this.#show(themeChoice(preferences));
    this.#keep();
  }

  /** Take a new choice: the page, the browser and the host. */
  async set(change: Partial<ThemeChoice>): Promise<void> {
    this.#show({ ...this.choice.value, ...change });
    this.#keep();
    const host = this.#host;
    if (host === null) return;
    host.preferences = { ...host.preferences, ...this.choice.value };
    // The change goes over the current preferences of the host, not over an old copy.
    await patchHostPreferences(host.fetcher, this.choice.value);
  }

  #show(choice: ThemeChoice): void {
    this.choice.value = choice;
    applyTheme(choice);
  }

  #keep(): void {
    try {
      this.#storage().setItem(THEME_KEY, JSON.stringify(this.choice.value));
    } catch {
      // No storage: the choice stays for this page.
    }
  }
}

let current: PageTheme | null = null;

/** The theme of this page. */
export function pageTheme(): PageTheme {
  current ??= new PageTheme();
  return current;
}
