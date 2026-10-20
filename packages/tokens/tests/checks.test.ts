// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { HIGH_CONTRAST_MINIMUM, MINIMUM } from "../src/checks";
import { VARIANTS } from "../config/variants";
import { sharedChecks } from "./model";

describe.each(VARIANTS.map((v) => [v.id, v] as const))("variant %s", (id, variant) => {
  test("every text pair has at least 4.5:1 and every non-text pair 3:1 (7:1 and 4.5:1 in high contrast)", async () => {
    const { contrast } = await sharedChecks();
    const own = contrast.filter((r) => r.variant === id);
    expect(own.length).toBeGreaterThan(60);
    const minimum = variant.contrast === "more" ? HIGH_CONTRAST_MINIMUM : MINIMUM;
    for (const result of own) {
      expect(result.ratio, `${result.fg} on ${result.bg}`).toBeGreaterThanOrEqual(
        Math.max(minimum[result.kind], result.minimum ?? 0),
      );
    }
  });

  test("the text pairs include primary and secondary text on every surface", async () => {
    const { contrast } = await sharedChecks();
    const own = contrast.filter((r) => r.variant === id && r.kind === "text");
    for (const surface of ["base", "raised", "sunken", "overlay"]) {
      for (const text of ["primary", "secondary"]) {
        expect(own.some((r) => r.fg === `color.text.${text}` && r.bg === `color.surface.${surface}`)).toBe(true);
      }
    }
  });
});
