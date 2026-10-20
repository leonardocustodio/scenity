// SPDX-License-Identifier: Apache-2.0
// Test helpers of the ui component tests: render with the Fluent resources of the ui package, as the app does.
import { createI18n, type DisplayLocale } from "@scenity/i18n";
import { render, type RenderOptions, type RenderResult } from "@testing-library/vue";
import type { Component, Plugin } from "vue";
import { UI_RESOURCES } from "../src/i18n";

export function makeI18n(locale: DisplayLocale = "en-US") {
  return createI18n({
    locale,
    resources: UI_RESOURCES,
    onMissing: (id) => {
      throw new Error(`missing message ${id}`);
    },
  });
}

export function renderUi<C extends Component>(
  component: C,
  options: RenderOptions<C> & { locale?: DisplayLocale; plugins?: Plugin[] } = {},
): RenderResult {
  const { locale, plugins = [], ...rest } = options;
  const i18n = makeI18n(locale);
  return render(component, {
    ...rest,
    global: { ...rest.global, plugins: [i18n.plugin, ...plugins, ...(rest.global?.plugins ?? [])] },
  });
}

/** Remove the Unicode isolation marks that Fluent puts around each placeable. */
export function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/[⁨⁩]/g, "");
}

/** A name matcher for getByRole that ignores the isolation marks. */
export function named(expected: string | RegExp): (name: string) => boolean {
  return (name) => (typeof expected === "string" ? plain(name) === expected : expected.test(plain(name)));
}
