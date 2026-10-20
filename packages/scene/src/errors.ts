// SPDX-License-Identifier: Apache-2.0
/**
 * The errors of the reader, the registry and the checks. Each error names the JSON Pointer of the bad value.
 */
import type { z } from "zod";
import { formatPointer } from "./pointer";

/** One problem of a document, at a JSON Pointer path (`""` is the whole document). */
export interface DocError {
  readonly path: string;
  readonly message: string;
}

/** The errors of a failed zod parse, with each path under the base pointer. */
export function zodErrors(error: z.ZodError, base = ""): DocError[] {
  return error.issues.map((issue) => {
    const tokens = issue.path.map((token) => (typeof token === "symbol" ? String(token.description) : token));
    // An unknown key is a problem of the key: the path names it.
    const keys = issue.code === "unrecognized_keys" ? issue.keys : [];
    const extra = keys.length === 1 && keys[0] !== undefined ? [keys[0]] : [];
    return { path: base + formatPointer([...tokens, ...extra]), message: issue.message };
  });
}

/** The text of an error list, one error on each line, for a log or a refusal reason. */
export function formatErrors(errors: readonly DocError[]): string {
  return errors.map((error) => `${error.path || "/"}: ${error.message}`).join("\n");
}
