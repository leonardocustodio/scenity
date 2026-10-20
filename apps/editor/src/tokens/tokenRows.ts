// SPDX-License-Identifier: Apache-2.0
/**
 * The rows of the token page of the studio: the tokens of the studio from the token reference
 * of @scenity/tokens (`dist/reference.json`), with the value of each theme variant and the result of their checks.
 */

/** One token of the reference. */
export interface ReferenceToken {
  readonly name: string;
  readonly type: string;
  readonly css_var: string;
  readonly values: Readonly<Record<string, string>>;
}

/** One check result of the reference (a contrast pair or a distinct pair). */
interface CheckResult {
  readonly variant: string;
  readonly pass: boolean;
  readonly fg?: string;
  readonly a?: string;
  readonly b?: string;
}

/** The parts of the token reference that the page reads. */
export interface TokenReference {
  readonly variants: readonly { readonly id: string; readonly theme: string; readonly contrast: string }[];
  readonly tokens: readonly ReferenceToken[];
  readonly contrast: readonly CheckResult[];
  readonly distinct: readonly CheckResult[];
}

/** One row of the page. */
export interface TokenRow {
  readonly name: string;
  readonly cssVar: string;
  readonly kind: "colour" | "size";
  /** The value of each variant, in the order of `variants` of the reference. */
  readonly values: readonly string[];
  /** The number of checks of the token and the number that failed. */
  readonly checks: number;
  readonly failed: number;
}

/** A token of the studio: the colour roles (`color.studio.*`) and the sizes (`studio.*`). */
export function isStudioToken(name: string): boolean {
  return name.startsWith("color.studio.") || name.startsWith("studio.");
}

function checksOf(reference: TokenReference, name: string): readonly CheckResult[] {
  return [
    ...reference.contrast.filter((check) => check.fg === name),
    ...reference.distinct.filter((check) => check.a === name || check.b === name),
  ];
}

/** The rows of the studio tokens, in name order. */
export function studioTokenRows(reference: TokenReference): TokenRow[] {
  return reference.tokens
    .filter((token) => isStudioToken(token.name))
    .map((token) => {
      const checks = checksOf(reference, token.name);
      return {
        name: token.name,
        cssVar: token.css_var,
        kind: token.type === "color" ? ("colour" as const) : ("size" as const),
        values: reference.variants.map((variant) => token.values[variant.id] ?? ""),
        checks: checks.length,
        failed: checks.filter((check) => !check.pass).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
