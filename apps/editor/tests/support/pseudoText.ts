// SPDX-License-Identifier: Apache-2.0
/**
 * The pseudo-locale check of the editor pages. With `locale=pseudo`, each text of the editor comes from the
 * pseudo-locale of `@scenity/i18n`: its letters are accented. The rule of the check:
 *
 * - The check reads each visible text node of the page, the `title`, `placeholder` and `aria-label` of each visible
 *   element, the options of each visible `<select>`, and the title of the document.
 * - A text passes when it has an accented letter of the pseudo-locale, when it is between the brackets of the
 *   pseudo-locale (a message of data values only, for example "[Front (1)]"), or when it has no two ASCII letters in a
 *   row (a number, a unit sign, a key sign such as "⌘", a symbol).
 * - A data value is not a text of the editor: an entity name, an asset ID, a file path, a rule ID, a field name of a
 *   component schema, a key chord. The page puts each data value that shows alone in an element with
 *   `translate="no"`, and the check does not read text inside such an element. A data value inside a message passes,
 *   because the message has accented letters.
 * - A text that a package gives in English (a rule detail of `@scenity/rules`, a result line of the layout tools of
 *   `@scenity/runtime-dev`) is in an element with `data-package-text`. The check does not read it. The spec counts
 *   these elements and puts the number in its report.
 */
import type { Page } from "@playwright/test";

/** A text of the page with no pseudo letter: where it is and its text. */
export interface PlainText {
  readonly where: string;
  readonly text: string;
}

/** The accented letters of the pseudo-locale (packages/i18n/src/pseudo.ts). */
const ACCENTED = "ȦƁƇḒḖƑƓĦĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐȧƀƈḓḗƒɠħīĵķŀḿƞǿƥɋřşŧŭṽẇẋẏẑ";

/** The texts of the page that break the rule of the pseudo-locale (see the file comment). */
export function plainTexts(page: Page): Promise<PlainText[]> {
  return page.evaluate((accented) => {
    const found: { where: string; text: string }[] = [];
    const letters = new RegExp(`[${accented}]`, "u");
    const pseudo = (text: string): boolean => letters.test(text);
    const message = (text: string): boolean => text.startsWith("[") && text.endsWith("]");
    const plain = (text: string): boolean => /[A-Za-z]{2}/.test(text) && !pseudo(text) && !message(text);
    // The nearest `translate` attribute decides (an option with translate="yes" in a data select is a text).
    const data = (element: Element): boolean =>
      element.closest("[translate]")?.getAttribute("translate") === "no" ||
      element.closest("[data-package-text]") !== null ||
      element.closest("script, style, noscript, template, canvas") !== null;
    const shown = (element: Element): boolean => element.checkVisibility({ checkVisibilityCSS: true });
    const label = (element: Element): string => {
      const testId = element.closest("[data-testid]")?.getAttribute("data-testid");
      return `${element.tagName.toLowerCase()}${testId === undefined || testId === null ? "" : ` in ${testId}`}`;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? "";
      if (parent === null || text === "" || data(parent) || parent.closest("select") !== null || !shown(parent)) {
        continue;
      }
      if (plain(text)) found.push({ where: label(parent), text });
    }
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (data(element) || !shown(element)) continue;
      for (const name of ["title", "placeholder", "aria-label"]) {
        const value = element.getAttribute(name);
        if (value !== null && plain(value)) found.push({ where: `${label(element)} [${name}]`, text: value });
      }
      if (element instanceof HTMLSelectElement) {
        for (const option of Array.from(element.options)) {
          const text = option.text.trim();
          if (!data(option) && plain(text)) found.push({ where: `${label(element)} option`, text });
        }
        for (const group of Array.from(element.querySelectorAll("optgroup"))) {
          const text = group.label;
          if (!data(group) && plain(text)) found.push({ where: `${label(element)} optgroup`, text });
        }
      }
    }
    if (plain(document.title)) found.push({ where: "document title", text: document.title });
    return found;
  }, ACCENTED);
}
