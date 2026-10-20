// SPDX-License-Identifier: Apache-2.0
/**
 * Interface locales and locale negotiation.
 *
 * The interface locale is the language of menus, buttons and help. The content locale of a session (for example
 * the speech of a character or the names of a catalog) comes from the content packs and can be different.
 */
import { negotiateLanguages } from "@fluent/langneg";

/** The interface locales that ship. en-US is the source locale. */
export const SUPPORTED_LOCALES = ["en-US", "pt-BR"] as const;
export type UiLocale = (typeof SUPPORTED_LOCALES)[number];

/** The source locale: translators start from it, and every other locale falls back to it. */
export const SOURCE_LOCALE = "en-US" satisfies UiLocale;

/**
 * The pseudo-locale. It comes from en-US: accented letters, about 35 % longer text, brackets around each
 * message. It finds hard-coded text and truncation. It is never a result of negotiation.
 */
export const PSEUDO_LOCALE = "en-XA";
export type DisplayLocale = UiLocale | typeof PSEUDO_LOCALE;

/** True when the value is a supported interface locale. */
export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** True when the value is a supported interface locale or the pseudo-locale. */
export function isDisplayLocale(value: unknown): value is DisplayLocale {
  return value === PSEUDO_LOCALE || isUiLocale(value);
}

/**
 * Return the best interface locale for a list of requested locales, in order of preference.
 *
 * Give the stored preference first, then `navigator.languages`, then the default of the tenant. The match
 * uses @fluent/langneg (strategy "lookup"), so "pt" and "pt-PT" give pt-BR and "en-GB" gives en-US.
 * Without a match, the result is the fallback (en-US by default).
 */
export function negotiateUiLocale(requested: readonly string[], fallback: UiLocale = SOURCE_LOCALE): UiLocale {
  const valid = requested.filter((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
      return false;
    }
  });
  const [best] = negotiateLanguages(valid, SUPPORTED_LOCALES, { strategy: "lookup", defaultLocale: fallback });
  return isUiLocale(best) ? best : fallback;
}

/**
 * Return the locales of the resources that a display locale uses, in the order of the fallback chain. A
 * supported locale other than en-US gives the locale and en-US. en-US and the pseudo-locale give en-US.
 */
export function sourceLocales(locale: DisplayLocale): UiLocale[] {
  return locale === SOURCE_LOCALE || locale === PSEUDO_LOCALE ? [SOURCE_LOCALE] : [locale, SOURCE_LOCALE];
}
