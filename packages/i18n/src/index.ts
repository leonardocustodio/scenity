// SPDX-License-Identifier: Apache-2.0
/**
 * @scenity/i18n — the UI text of Scenity.
 *
 * - Locales: SUPPORTED_LOCALES, the pseudo-locale en-XA and negotiateUiLocale().
 * - Resources: collectResources() reads the result of `import.meta.glob` over the `.ftl` files.
 * - Runtime: createI18n() makes the fluent-vue plugin with the fallback chain (locale, then en-US).
 *   Components call `const { $t } = useI18n()`. With the `load` option, the app loads the texts of a
 *   group on demand (requireGroups, changeLocale).
 * - Intl helpers for numbers, dates, relative time, lists and durations.
 *
 * The shared key registry of the contract enums is in the plugin. This package imports no contract.
 *
 * The app sets `<html lang>` from `i18n.locale`; this package does not change the document.
 */
export {
  SUPPORTED_LOCALES,
  SOURCE_LOCALE,
  PSEUDO_LOCALE,
  isUiLocale,
  isDisplayLocale,
  negotiateUiLocale,
  sourceLocales,
  type UiLocale,
  type DisplayLocale,
} from "./locales";
export { collectResources, resourcePath, isLocaleTag, type FtlResource } from "./resources";
export { createI18n, FALLBACK_MARKS, type I18n, type I18nOptions } from "./runtime";
export { pseudoLocalize, pseudoText } from "./pseudo";
export {
  formatNumber,
  formatDecimal,
  formatPercent,
  formatDate,
  formatList,
  formatRelativeTime,
  formatDurationMs,
  formatClockMs,
  type DurationOptions,
  type DurationStyle,
} from "./format";
export { useFluent as useI18n } from "fluent-vue";
