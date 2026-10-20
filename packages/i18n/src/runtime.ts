// SPDX-License-Identifier: Apache-2.0
/**
 * The Fluent runtime of the interface: one FluentBundle per locale. fluent-vue gives the bundles to Vue.
 *
 * The fallback chain is the selected locale, then en-US. With `markFallback` (set it in development
 * builds), a message that comes from en-US in another locale shows between "⟦" and "⟧", and onMissing
 * reports it once. The pseudo-locale en-XA comes from the en-US resources (pseudo.ts).
 *
 * Texts on demand: with the `load` option, the app gives no resources at start. It loads the
 * resources of a text group (for example the shell or one feature) when a route needs them
 * (requireGroups), and changeLocale() loads the required groups of the next locale before the change.
 */
import {
  FluentBundle,
  FluentNumber,
  FluentResource,
  FluentType,
  type FluentFunction,
  type FluentVariable,
} from "@fluent/bundle";
import { createFluentVue } from "fluent-vue";
import { computed, shallowRef, type Plugin, type Ref } from "vue";
import { formatDurationMs, type DurationStyle } from "./format";
import {
  isDisplayLocale,
  PSEUDO_LOCALE,
  SOURCE_LOCALE,
  sourceLocales,
  type DisplayLocale,
  type UiLocale,
} from "./locales";
import { pseudoLocalize } from "./pseudo";
import type { FtlResource } from "./resources";

export interface I18nOptions {
  /** The interface locale at start: a supported locale or the pseudo-locale. */
  readonly locale: DisplayLocale;
  /**
   * The Fluent resources at start (see collectResources). With `load`, give an empty list: the groups
   * add their resources when they load.
   */
  readonly resources: readonly FtlResource[];
  /**
   * Called once for each message ID and locale that has no message: the selected locale when the text
   * comes from the fallback, and every locale of the chain when no locale has the message.
   */
  readonly onMissing?: (id: string, locale: string) => void;
  /** Show fallback text between "⟦" and "⟧" (development builds). False by default. */
  readonly markFallback?: boolean;
  /**
   * Load the resources of one text group in one locale. requireGroups() and changeLocale() call it
   * once for each group and locale. A group is a name that the app gives, for example "shell" or the name of
   * a feature. A group without files gives an empty list.
   */
  readonly load?: (group: string, locale: UiLocale) => Promise<readonly FtlResource[]>;
  /**
   * Put each placeable between the Unicode isolation marks FSI and PDI (the Fluent default, true). An app whose
   * texts hold file paths and IDs in left-to-right locales only can set false (for example the editor).
   */
  readonly useIsolating?: boolean;
}

export interface I18n {
  /** The fluent-vue plugin: `$t` and `$ta` in templates, `useI18n()` in components, the `v-t` directive. */
  readonly plugin: Plugin;
  /** Select an interface locale. The text of every mounted component changes. */
  setLocale(locale: DisplayLocale): void;
  /** The selected locale. Set it to select another locale (the same as setLocale). */
  readonly locale: Ref<string>;
  /** The text of a message outside components. A message that no locale has gives its ID. */
  format(id: string, args?: Record<string, unknown>): string;
  /**
   * Add resources to the bundles. The mounted components show the new texts. The runtime ignores a
   * resource with the locale and the namespace of a resource that it has already.
   */
  addResources(resources: readonly FtlResource[]): void;
  /**
   * Load text groups in the selected locale and in its fallback locale (option `load`). The promise
   * resolves when the texts are in the bundles, and it rejects when a load fails. The groups stay
   * required: changeLocale() loads them in the next locale. Without `load`, the promise resolves at once.
   */
  requireGroups(groups: readonly string[]): Promise<void>;
  /**
   * Load every required group in a locale, then select the locale. When a second call starts before the
   * first call ends, only the locale of the second call applies.
   */
  changeLocale(locale: DisplayLocale): Promise<void>;
}

/** The marks around a text that comes from the fallback locale (only with markFallback). */
export const FALLBACK_MARKS = ["⟦", "⟧"] as const;

/**
 * Fluent functions of every bundle. DURATION($ms, style: "short") formats a duration in milliseconds with
 * the unit words of the locale (format.ts), so that no message joins a number and a unit word.
 */
function functionsFor(locale: string): Record<string, FluentFunction> {
  const intlLocale = locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
  return {
    DURATION: ([value], named) => {
      const ms = value instanceof FluentNumber ? value.valueOf() : Number(value);
      const style = typeof named.style === "string" ? named.style : "short";
      const digits = named.fractionDigits instanceof FluentNumber ? named.fractionDigits.valueOf() : 0;
      return formatDurationMs(ms, intlLocale, {
        style: (["long", "short", "narrow"].includes(style) ? style : "short") as DurationStyle,
        fractionDigits: digits,
      });
    },
  };
}

/** Turn an argument value into a Fluent variable. A boolean becomes a string; other values are left out. */
function toVariable(value: unknown): FluentVariable | undefined {
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    return value;
  }
  if (value instanceof FluentType) {
    return value as FluentVariable; // FluentNumber, FluentDateTime or FluentNone.
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function toArgs(args: Record<string, unknown> | undefined): Record<string, FluentVariable> | undefined {
  if (args === undefined) {
    return undefined;
  }
  const out: Record<string, FluentVariable> = {};
  for (const [name, value] of Object.entries(args)) {
    const variable = toVariable(value);
    if (variable !== undefined) {
      out[name] = variable;
    }
  }
  return out;
}

/** A bundle of the fallback locale: it reports and marks the messages that the selected locale lacks. */
class FallbackBundle extends FluentBundle {
  constructor(
    locale: string,
    private readonly selected: () => string,
    private readonly report: (id: string, locale: string) => void,
    private readonly mark: boolean,
    useIsolating: boolean,
  ) {
    super(locale, { functions: functionsFor(locale), useIsolating });
  }

  override hasMessage(id: string): boolean {
    const has = super.hasMessage(id);
    if (has) {
      this.report(id, this.selected());
    }
    return has;
  }

  override formatPattern(...args: Parameters<FluentBundle["formatPattern"]>): string {
    const text = super.formatPattern(...args);
    return this.mark ? `${FALLBACK_MARKS[0]}${text}${FALLBACK_MARKS[1]}` : text;
  }
}

function defaultOnMissing(id: string, locale: string): void {
  console.warn(`[i18n] no message "${id}" in ${locale}`);
}

/** The key of a resource: its locale and its namespace. */
function resourceKey(resource: FtlResource): string {
  return `${resource.locale}\u0000${resource.namespace}`;
}

/** Create the Fluent runtime of the interface. */
export function createI18n(options: I18nOptions): I18n {
  const onMissing = options.onMissing ?? defaultOnMissing;
  const useIsolating = options.useIsolating ?? true;
  const reported = new Set<string>();
  const report = (id: string, locale: string): void => {
    const key = `${locale}\u0000${id}`;
    if (!reported.has(key)) {
      reported.add(key);
      onMissing(id, locale);
    }
  };
  const current = shallowRef<DisplayLocale>(options.locale);
  const bundles = new Map<string, FluentBundle>();
  const resources: FtlResource[] = [...options.resources];
  const resourceKeys = new Set(resources.map(resourceKey));

  const fill = (bundle: FluentBundle, locale: string, list: readonly FtlResource[] = resources): FluentBundle => {
    const sourceLocale = locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
    for (const resource of list.filter((item) => item.locale === sourceLocale)) {
      const source = locale === PSEUDO_LOCALE ? pseudoLocalize(resource.source) : resource.source;
      for (const error of bundle.addResource(new FluentResource(source))) {
        console.warn(`[i18n] ${resource.namespace} (${locale}): ${error.message}`);
      }
    }
    return bundle;
  };
  const bundleFor = (locale: string): FluentBundle => {
    let bundle = bundles.get(locale);
    if (bundle === undefined) {
      bundle = fill(new FluentBundle(locale, { functions: functionsFor(locale), useIsolating }), locale);
      bundles.set(locale, bundle);
    }
    return bundle;
  };
  const fallback = fill(
    new FallbackBundle(SOURCE_LOCALE, () => current.value, report, options.markFallback === true, useIsolating),
    SOURCE_LOCALE,
  );
  const chainFor = (locale: DisplayLocale): FluentBundle[] =>
    locale === SOURCE_LOCALE || locale === PSEUDO_LOCALE ? [bundleFor(locale)] : [bundleFor(locale), fallback];

  const fluent = createFluentVue({
    bundles: chainFor(current.value),
    warnMissing: (id: string) => {
      for (const bundle of chainFor(current.value)) {
        report(id, bundle.locales[0] ?? SOURCE_LOCALE);
      }
    },
    mapVariable: (value) => toVariable(value),
  });

  const setLocale = (locale: DisplayLocale): void => {
    if (!isDisplayLocale(locale)) {
      throw new RangeError(`unsupported interface locale: ${String(locale)}`);
    }
    if (locale !== current.value) {
      fluent.bundles = chainFor(locale);
      current.value = locale;
    }
  };

  const addResources = (list: readonly FtlResource[]): void => {
    const added = list.filter((resource) => {
      const key = resourceKey(resource);
      if (resourceKeys.has(key)) {
        return false;
      }
      resourceKeys.add(key);
      return true;
    });
    if (added.length === 0) {
      return;
    }
    resources.push(...added);
    for (const [locale, bundle] of bundles) {
      fill(bundle, locale, added);
    }
    fill(fallback, SOURCE_LOCALE, added);
    // A new array: fluent-vue keeps the bundles in a shallow ref, so the mounted components render again.
    fluent.bundles = chainFor(current.value);
  };

  // The loads of the groups, by locale and group. A failed load leaves the map, so a later call tries again.
  const loads = new Map<string, Promise<void>>();
  const required = new Set<string>();
  const loadGroup = (group: string, locale: UiLocale): Promise<void> => {
    const load = options.load;
    if (load === undefined) {
      return Promise.resolve();
    }
    const key = `${locale}\u0000${group}`;
    let pending = loads.get(key);
    if (pending === undefined) {
      pending = load(group, locale).then(addResources, (error: unknown) => {
        loads.delete(key);
        throw error;
      });
      loads.set(key, pending);
    }
    return pending;
  };
  const loadGroups = async (locale: DisplayLocale, groups: readonly string[]): Promise<void> => {
    await Promise.all(sourceLocales(locale).flatMap((source) => groups.map((group) => loadGroup(group, source))));
  };

  let lastChange = 0;
  const changeLocale = async (locale: DisplayLocale): Promise<void> => {
    if (!isDisplayLocale(locale)) {
      throw new RangeError(`unsupported interface locale: ${String(locale)}`);
    }
    lastChange += 1;
    const change = lastChange;
    // A navigation can require a group during the load. Load again until no group is new.
    let count = -1;
    while (count !== required.size) {
      count = required.size;
      await loadGroups(locale, [...required]);
    }
    if (change === lastChange) {
      setLocale(locale);
    }
  };

  return {
    plugin: { install: (app) => fluent.install(app) },
    setLocale,
    locale: computed({
      get: (): string => current.value,
      set: (value: string) => setLocale(value as DisplayLocale),
    }),
    format: (id, args) => fluent.format(id, toArgs(args)),
    addResources,
    requireGroups: async (groups) => {
      for (const group of groups) {
        required.add(group);
      }
      await loadGroups(current.value, groups);
    },
    changeLocale,
  };
}
