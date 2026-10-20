// SPDX-License-Identifier: Apache-2.0
/**
 * The look of the studio for the settings and the first run of the Hub: the themes, the languages with their own
 * names, and a change of the language. The texts change immediately, and the preferences keep the language.
 */
import { isDisplayLocale, PSEUDO_LOCALE, SUPPORTED_LOCALES } from "@scenity/i18n";
import { editorI18n } from "../texts";
import type { Hub } from "./useHub";

export const THEMES = ["dark", "light", "navy"] as const;

/** Each language of the studio with its name in that language; the pseudo-locale keeps its tag. */
export function languageOptions(): { value: string; label: string }[] {
  return [...SUPPORTED_LOCALES, PSEUDO_LOCALE].map((value) => ({
    value,
    label: value === PSEUDO_LOCALE ? value : (new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value),
  }));
}

/** Show the texts in another language and keep it in the preferences. */
export function changeLanguage(hub: Pick<Hub, "savePreferences">, locale: string): void {
  if (!isDisplayLocale(locale)) return;
  editorI18n().setLocale(locale);
  void hub.savePreferences({ locale });
}
