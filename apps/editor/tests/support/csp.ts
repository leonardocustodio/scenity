// SPDX-License-Identifier: Apache-2.0
/**
 * The CSP check of the end-to-end tests: `watchCsp`.
 */
import type { Page } from "@playwright/test";

/** Record the CSP violations of a page (the `securitypolicyviolation` event and console reports). */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const console: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to|TrustedScript|TrustedHTML|Trusted Type/i.test(text)) {
      console.push(text);
    }
  });
  await page.addInitScript(() => {
    const target = window as unknown as { __cspViolations: string[] };
    target.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.__cspViolations.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)}`,
      );
    });
  });
  return async () => {
    const events = await page
      .evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
      .catch(() => []);
    return [...events, ...console];
  };
}
