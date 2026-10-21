// SPDX-License-Identifier: Apache-2.0
/**
 * The launch token of the host: 32 random bytes per start, or the value of the
 * environment variable `SCENITY_WORKBENCH_TOKEN` (the tests, the shell).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_ENV, isToken } from "./protocol";

/** Make the launch token: the value of the environment variable, or 32 new random bytes as hex. */
export function makeToken(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env[TOKEN_ENV];
  if (value === undefined || value === "") return randomBytes(32).toString("hex");
  if (!isToken(value)) throw new Error(`${TOKEN_ENV} must be 64 lowercase hex characters.`);
  return value;
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/**
 * True when the given text is the token. The compare takes the same time for each value: the function compares the
 * SHA-256 digests of the two values, so the length of the given text does not change the time.
 */
export function sameToken(given: string | null | undefined, token: string): boolean {
  if (typeof given !== "string") return false;
  return timingSafeEqual(digest(given), digest(token));
}
