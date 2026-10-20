// SPDX-License-Identifier: Apache-2.0
/**
 * JSON Pointer (RFC 6901) for the ops and the errors. A pointer is `""` (the whole document) or a list of
 * tokens, each after a `/`. In a token, `~0` is `~` and `~1` is `/`.
 */
import { isObject, omitKeys } from "./json";

/** The text of one token, with `~` as `~0` and `/` as `~1`. */
export function escapeToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** The token from its text. */
export function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** The pointer of a list of tokens. */
export function formatPointer(tokens: readonly (string | number)[]): string {
  return tokens.map((token) => `/${escapeToken(String(token))}`).join("");
}

/** The tokens of a pointer, or undefined when the text is not a pointer. */
export function parsePointer(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const tokens = pointer.slice(1).split("/");
  if (tokens.some((token) => /~(?![01])/.test(token))) return undefined;
  return tokens.map(unescapeToken);
}

/** The index of an array token, or undefined when the token is not a decimal index in 0..length-1. */
export function arrayIndex(token: string, length: number): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
  const index = Number(token);
  return index < length ? index : undefined;
}

/** The value at the tokens, or undefined when no value is there. */
export function getAt(root: unknown, tokens: readonly string[]): unknown {
  let node: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(node)) {
      const index = arrayIndex(token, node.length);
      if (index === undefined) return undefined;
      node = node[index];
    } else if (isObject(node)) {
      if (!Object.hasOwn(node, token)) return undefined;
      node = node[token];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * A copy of the root with the value at the tokens. The copy shares each branch that does not change. The value
 * `undefined` removes an object key. The container of the last token must exist. An array index must be in range.
 * The result is the new root, or a string that tells why the change is not possible.
 */
export function setAt(root: unknown, tokens: readonly string[], value: unknown): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value;
  if (Array.isArray(root)) {
    const index = arrayIndex(head, root.length);
    if (index === undefined) return new PointerError(`no array item ${head}`);
    if (rest.length === 0 && value === undefined) return new PointerError("an array item cannot be removed by set");
    const child = setAt(root[index], rest, value);
    if (child instanceof PointerError) return child;
    const copy: unknown[] = [...(root as unknown[])];
    copy[index] = child;
    return copy;
  }
  if (!isObject(root)) return new PointerError(`no container for ${head}`);
  if (rest.length > 0 && !Object.hasOwn(root, head)) return new PointerError(`no value at ${head}`);
  const child = rest.length === 0 ? value : setAt(root[head], rest, value);
  if (child instanceof PointerError) return child;
  return child === undefined ? omitKeys(root, [head]) : { ...root, [head]: child };
}

/** The reason of a refused `setAt`. */
export class PointerError {
  constructor(readonly reason: string) {}
}
