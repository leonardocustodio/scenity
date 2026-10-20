// SPDX-License-Identifier: Apache-2.0
/**
 * The token reference (dist/reference.json): every token with its value in each theme variant and the
 * results of the contrast and distinctness checks. The token page of the component gallery reads it.
 */

import type { ContrastResult, DistinctResult } from "./checks";

export type TokenTier = "primitive" | "semantic" | "component";

export interface TokenReferenceEntry {
  readonly name: string;
  readonly type: string;
  readonly tier: TokenTier;
  /** The CSS custom property, or null for a token that is not in tokens.css. */
  readonly css_var: string | null;
  /** True for a token whose change needs the approval of the owners of its domain. */
  readonly guarded: boolean;
  readonly themed: boolean;
  readonly description: string | null;
  /** The CSS value in each theme variant, by variant ID. */
  readonly values: Readonly<Record<string, string>>;
}

export interface TokenReference {
  readonly version: string;
  readonly variants: readonly {
    readonly id: string;
    readonly theme: string;
    readonly contrast: string;
    readonly scheme: string;
  }[];
  readonly tokens: readonly TokenReferenceEntry[];
  readonly contrast: readonly ContrastResult[];
  readonly distinct: readonly DistinctResult[];
}

/** Load the token reference. The bundler puts it in a separate chunk, so only the gallery loads it. */
export async function loadTokenReference(): Promise<TokenReference> {
  const module = (await import("../dist/reference.json")) as { default: unknown };
  return module.default as TokenReference;
}
