// SPDX-License-Identifier: Apache-2.0
/**
 * The preferences of the person on the studio host: the language, the number of recent projects, autosave and the
 * defaults of new agent sessions. The Hub and the editor window share them. Outside the studio, the page has no host
 * preferences (`value` stays null).
 *
 * A change reads the preferences of the host again and writes the change over them. Thus two parts of the page (the
 * theme and Preferences) do not write an old copy over a new value. In the studio, the language of the host
 * preferences is the language of the editor, unless the URL parameter `locale` gives a language.
 */
import { isDisplayLocale } from "@scenity/i18n";
import { markRaw, shallowRef } from "vue";
import { csrfValue, type Preferences } from "../../hub/studioApi";
import { editorI18n, t } from "../../texts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const PATH = "/api/user/preferences";

/** Write a change over the preferences of the host immediately. The answer is the new preferences, or null. */
export async function patchHostPreferences(fetcher: Fetcher, change: object): Promise<Preferences | null> {
  const now = await fetcher(PATH).catch(() => null);
  if (!now?.ok) return null;
  const next = { ...((await now.json()) as Preferences), ...change };
  const answer = await fetcher(PATH, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
    body: JSON.stringify(next),
  }).catch(() => null);
  return answer?.ok === true ? ((await answer.json()) as Preferences) : null;
}

/** The host preferences of the page. */
export class HostPreferences {
  readonly value = shallowRef<Preferences | null>(null);
  #fetcher: Fetcher | null = null;

  constructor() {
    markRaw(this);
  }

  /** In the studio, read the host preferences, and use their language when the URL gives no language. */
  async use(fetcher: Fetcher = (input, init) => fetch(input, init), search = location.search): Promise<void> {
    const answer = await fetcher(PATH).catch(() => null);
    if (!answer?.ok) return;
    this.#fetcher = fetcher;
    this.value.value = (await answer.json()) as Preferences;
    const locale = this.value.value.locale;
    if (!new URLSearchParams(search).has("locale") && isDisplayLocale(locale)) editorI18n().setLocale(locale);
  }

  /** Write a change. The answer is null, or the reason of a failure. */
  async save(change: Partial<Preferences>): Promise<string | null> {
    if (this.#fetcher === null) return t("settings-host-none");
    const next = await patchHostPreferences(this.#fetcher, change);
    if (next === null) return t("settings-host-failed");
    this.value.value = next;
    return null;
  }
}

let shared: HostPreferences | null = null;

/** The host preferences of this page. */
export function hostPreferences(): HostPreferences {
  shared ??= new HostPreferences();
  return shared;
}
